import type { Env } from './index'
import { sha256, verifyHMAC, isTimestampValid } from './hmac'
import { getPropertyConfig, getPreviousSigningSecret, validateOrigin, rejectOrigin } from './origin'
import { logWorkerError } from './worker-errors'
import type { Sql } from './db'
import { isZeroStorage } from './storage-mode'
import { isBridgeConfigured, postToBridge } from './zero-storage-bridge'

interface ConsentEventPayload {
  org_id: string
  property_id: string
  banner_id: string
  banner_version: number
  event_type: string
  purposes_accepted?: string[]
  purposes_rejected?: string[]
  signature?: string
  timestamp?: string
}

const VALID_EVENT_TYPES = [
  'consent_given',
  'consent_withdrawn',
  'purpose_updated',
  'banner_dismissed',
]

// ADR-1014 Sprint 3.2 — trace-id round-trip headers. Both keys are
// always set in CORS_HEADERS_WITH_TRACE so the browser sees the value
// even on a CORS-fenced response (the actual response uses
// withTraceId() which extends CORS_HEADERS).
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }
const TRACE_ID_HEADER = 'X-CS-Trace-Id'
// Allow the browser to read the trace-id off cross-origin responses.
const TRACE_EXPOSE_HEADERS = { 'Access-Control-Expose-Headers': TRACE_ID_HEADER }

/**
 * ADR-1014 Sprint 3.2 — derive an opt-in opaque trace identifier.
 *
 * If the caller supplies `X-CS-Trace-Id` we trust + propagate it (after
 * trimming + length-bounding to 64 chars to keep junk out of the index).
 * Otherwise we generate a 16-char hex id — short enough to read in
 * a CLI tally line, long enough that random collisions across a single
 * org's daily volume are vanishing (2^64 ≈ 1.8e19 keyspace).
 *
 * The Worker MUST NOT validate format beyond length: partner harnesses
 * send ULIDs, UUIDs, OpenTelemetry trace ids, or whatever they wire
 * through their own infra. The column is text-typed for that reason.
 */
function deriveTraceId(request: Request): string {
  const inbound = request.headers.get(TRACE_ID_HEADER)
  if (inbound) {
    const trimmed = inbound.trim()
    if (trimmed) return trimmed.slice(0, 64)
  }
  // crypto.randomUUID is bound on Workers + Node 20 LTS + recent browsers;
  // collapse to 16 hex chars for the generated form.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

function withTraceId(traceId: string, init?: ResponseInit): ResponseInit {
  return {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...TRACE_EXPOSE_HEADERS,
      [TRACE_ID_HEADER]: traceId,
      ...(init?.headers as Record<string, string> | undefined),
    },
  }
}

export async function handleConsentEvent(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  sql: Sql | null,
): Promise<Response> {
  // Derive the trace id BEFORE any early return so even a 400/403/404
  // exit echoes a trace id for harness correlation. Generated trace
  // ids are not persisted on those exit paths (no row written), but
  // the harness can still log + grep on them.
  const traceId = deriveTraceId(request)
  let body: ConsentEventPayload

  try {
    body = (await request.json()) as ConsentEventPayload
  } catch {
    return new Response('Invalid JSON', withTraceId(traceId, { status: 400 }))
  }

  // Payload validation
  if (!body.org_id || !body.property_id || !body.banner_id || !body.event_type) {
    return new Response(
      'Missing required fields: org_id, property_id, banner_id, event_type',
      withTraceId(traceId, { status: 400 }),
    )
  }

  if (!VALID_EVENT_TYPES.includes(body.event_type)) {
    return new Response(
      `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
      withTraceId(traceId, { status: 400 }),
    )
  }

  // Step 1: Origin validation
  const propConfig = await getPropertyConfig(body.property_id, env, sql)
  if (!propConfig) {
    return new Response('Unknown property', withTraceId(traceId, { status: 404 }))
  }

  const originResult = validateOrigin(request, propConfig.allowed_origins)
  if (originResult.status === 'rejected') {
    ctx.waitUntil(
      logWorkerError(env, sql, {
        org_id: body.org_id,
        property_id: body.property_id,
        endpoint: '/v1/events',
        status_code: 403,
        upstream_error: `origin_mismatch: ${originResult.origin}`,
      }),
    )
    // rejectOrigin() builds its own Response — clone its body and merge
    // our trace-id header so the harness still gets the correlation id
    // on rejected origins.
    const rejection = rejectOrigin(originResult.origin)
    return new Response(rejection.body, withTraceId(traceId, { status: rejection.status }))
  }

  // Step 2: Authentication. Two accepted modes:
  //   (a) hmac-verified — server-to-server caller posts signature + timestamp
  //       derived from event_signing_secret. Origin may be absent.
  //   (b) origin-only   — browser caller posts without signature. Requires a
  //       valid origin in the property's allowed_origins list.
  // Missing both leaves the request unauthenticated → 403.
  let originVerified: 'origin-only' | 'hmac-verified'

  if (body.signature && body.timestamp) {
    if (!isTimestampValid(body.timestamp)) {
      ctx.waitUntil(
        logWorkerError(env, sql, {
          org_id: body.org_id,
          property_id: body.property_id,
          endpoint: '/v1/events',
          status_code: 403,
          upstream_error: `hmac_timestamp_drift: ${body.timestamp}`,
        }),
      )
      return new Response(
        'Timestamp expired (±5 minutes)',
        withTraceId(traceId, { status: 403 }),
      )
    }

    let hmacValid = await verifyHMAC(
      body.org_id,
      body.property_id,
      body.timestamp,
      body.signature,
      propConfig.event_signing_secret,
    )

    if (!hmacValid) {
      const prevSecret = await getPreviousSigningSecret(body.property_id, env)
      if (prevSecret) {
        hmacValid = await verifyHMAC(
          body.org_id,
          body.property_id,
          body.timestamp,
          body.signature,
          prevSecret,
        )
      }
    }

    if (!hmacValid) {
      ctx.waitUntil(
        logWorkerError(env, sql, {
          org_id: body.org_id,
          property_id: body.property_id,
          endpoint: '/v1/events',
          status_code: 403,
          upstream_error: 'hmac_signature_mismatch',
        }),
      )
      return new Response('Invalid signature', withTraceId(traceId, { status: 403 }))
    }
    originVerified = 'hmac-verified'
  } else {
    if (originResult.status !== 'valid') {
      ctx.waitUntil(
        logWorkerError(env, sql, {
          org_id: body.org_id,
          property_id: body.property_id,
          endpoint: '/v1/events',
          status_code: 403,
          upstream_error: 'origin_missing: unsigned request without Origin/Referer',
        }),
      )
      return new Response(
        'Origin required for unsigned events',
        withTraceId(traceId, { status: 403 }),
      )
    }
    originVerified = 'origin-only'
  }

  // Step 3: Truncate IP, hash user agent
  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  const ipTruncated = ip.split('.').slice(0, 3).join('.') + '.0'
  const userAgent = request.headers.get('User-Agent') ?? ''
  const fingerprint = await sha256(`${userAgent}:${ipTruncated}:${body.org_id}`)
  const uaHash = await sha256(userAgent)

  const event = {
    org_id: body.org_id,
    property_id: body.property_id,
    banner_id: body.banner_id,
    banner_version: body.banner_version ?? 1,
    session_fingerprint: fingerprint,
    event_type: body.event_type,
    purposes_accepted: body.purposes_accepted ?? [],
    purposes_rejected: body.purposes_rejected ?? [],
    ip_truncated: ipTruncated,
    user_agent_hash: uaHash,
    origin_verified: originVerified,
    // ADR-1014 Sprint 3.2 — opt-in trace correlation, persisted for
    // banner → Worker → buffer → delivery → R2 hop stitching.
    trace_id: traceId,
  }

  // Step 4: Write path depends on the org's storage_mode.
  // ADR-1003 Sprint 1.2 — zero_storage orgs bypass consent_events
  // INSERT entirely. The full canonical payload is POSTed to the
  // Next.js bridge (ctx.waitUntil so the customer's banner gets 202
  // immediately), which uploads to the customer's R2 bucket. Nothing
  // lands in consent_events / consent_artefacts / delivery_buffer
  // on our side. If the bridge isn't configured (Miniflare harness,
  // misconfigured prod), we fall through to the INSERT path — safer
  // than silently dropping.
  if (isBridgeConfigured(env)) {
    const zero = await isZeroStorage(env, body.org_id).catch(() => false)
    if (zero) {
      ctx.waitUntil(
        postToBridge(env, {
          kind: 'consent_event',
          org_id: body.org_id,
          event_fingerprint: event.session_fingerprint,
          timestamp: new Date().toISOString(),
          payload: {
            property_id: event.property_id,
            banner_id: event.banner_id,
            banner_version: event.banner_version,
            session_fingerprint: event.session_fingerprint,
            event_type: event.event_type,
            purposes_accepted: event.purposes_accepted,
            purposes_rejected: event.purposes_rejected,
            ip_truncated: event.ip_truncated,
            user_agent_hash: event.user_agent_hash,
            origin_verified: event.origin_verified,
          },
        }).then(async (result) => {
          if (!result.sent) {
            await logWorkerError(env, sql, {
              org_id: body.org_id,
              property_id: body.property_id,
              endpoint: '/v1/events',
              status_code: result.status ?? 0,
              upstream_error:
                `zero_storage_bridge_${result.reason}: ` + (result.detail ?? ''),
            })
          }
        }),
      )
      return new Response(null, withTraceId(traceId, { status: 202 }))
    }
  }

  // Standard / Insulated path: INSERT into consent_events via
  // cs_worker role. Hyperdrive SQL when bound; REST fallback otherwise
  // (Miniflare harness).
  const writeResult = sql
    ? await insertConsentEventSql(event, sql)
    : await insertConsentEventRest(event, env)

  if (!writeResult.ok) {
    console.error('Buffer write failed:', writeResult.error)
    ctx.waitUntil(
      logWorkerError(env, sql, {
        org_id: body.org_id,
        property_id: body.property_id,
        endpoint: '/v1/events',
        status_code: writeResult.status,
        upstream_error: writeResult.error,
      }),
    )
  }

  return new Response(null, withTraceId(traceId, { status: 202 }))
}

// Exported for unit-test reachability — worker/tests/trace-id.test.ts.
export const __testing = { deriveTraceId, TRACE_ID_HEADER, withTraceId }

type WriteResult = { ok: true } | { ok: false; status: number; error: string }

async function insertConsentEventSql(
  event: ConsentEventRow,
  sql: Sql,
): Promise<WriteResult> {
  try {
    await sql`
      insert into public.consent_events (
        org_id, property_id, banner_id, banner_version,
        session_fingerprint, event_type,
        purposes_accepted, purposes_rejected,
        ip_truncated, user_agent_hash, origin_verified,
        trace_id
      ) values (
        ${event.org_id}::uuid,
        ${event.property_id}::uuid,
        ${event.banner_id}::uuid,
        ${event.banner_version}::int,
        ${event.session_fingerprint},
        ${event.event_type},
        ${sql.json(event.purposes_accepted)},
        ${sql.json(event.purposes_rejected)},
        ${event.ip_truncated},
        ${event.user_agent_hash},
        ${event.origin_verified},
        ${event.trace_id}
      )
    `
    return { ok: true }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return {
      ok: false,
      status: 500,
      error: `hyperdrive_insert_failed: ${err.code ?? ''} ${err.message ?? ''}`.trim(),
    }
  }
  // No sql.end() — per Sprint 4.2, sql is the per-isolate singleton.
}

async function insertConsentEventRest(
  event: ConsentEventRow,
  env: Env,
): Promise<WriteResult> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/consent_events`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_WORKER_KEY ?? '',
      Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(event),
  })
  if (res.ok) return { ok: true }
  return { ok: false, status: res.status, error: await res.text() }
}

interface ConsentEventRow {
  org_id: string
  property_id: string
  banner_id: string
  banner_version: number
  session_fingerprint: string
  event_type: string
  purposes_accepted: string[]
  purposes_rejected: string[]
  ip_truncated: string
  user_agent_hash: string
  origin_verified: 'origin-only' | 'hmac-verified'
  /** ADR-1014 Sprint 3.2 — opt-in trace correlation. */
  trace_id: string
}
