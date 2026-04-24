import type { Env } from './index'
import { sha256, verifyHMAC, isTimestampValid } from './hmac'
import { getPropertyConfig, getPreviousSigningSecret, validateOrigin, rejectOrigin } from './origin'
import { logWorkerError } from './worker-errors'
import type { Sql } from './db'
import { isZeroStorage } from './storage-mode'
import { isBridgeConfigured, postToBridge } from './zero-storage-bridge'

interface ObservationPayload {
  org_id: string
  property_id: string
  session_fingerprint?: string
  consent_state: Record<string, boolean>
  trackers_detected: unknown[]
  violations?: unknown[]
  page_url?: string
  signature?: string
  timestamp?: string
}

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

export async function handleObservation(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  sql: Sql | null,
): Promise<Response> {
  let body: ObservationPayload

  try {
    body = (await request.json()) as ObservationPayload
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  if (!body.org_id || !body.property_id || !body.consent_state || !body.trackers_detected) {
    return new Response(
      'Missing required fields: org_id, property_id, consent_state, trackers_detected',
      { status: 400, headers: CORS_HEADERS },
    )
  }

  // Step 1: Origin validation
  const propConfig = await getPropertyConfig(body.property_id, env, sql)
  if (!propConfig) {
    return new Response('Unknown property', { status: 404, headers: CORS_HEADERS })
  }

  const originResult = validateOrigin(request, propConfig.allowed_origins)
  if (originResult.status === 'rejected') {
    ctx.waitUntil(
      logWorkerError(env, sql, {
        org_id: body.org_id,
        property_id: body.property_id,
        endpoint: '/v1/observations',
        status_code: 403,
        upstream_error: `origin_mismatch: ${originResult.origin}`,
      }),
    )
    return rejectOrigin(originResult.origin)
  }

  // See events.ts — same two accepted authentication modes.
  let originVerified: 'origin-only' | 'hmac-verified'

  if (body.signature && body.timestamp) {
    if (!isTimestampValid(body.timestamp)) {
      ctx.waitUntil(
        logWorkerError(env, sql, {
          org_id: body.org_id,
          property_id: body.property_id,
          endpoint: '/v1/observations',
          status_code: 403,
          upstream_error: `hmac_timestamp_drift: ${body.timestamp}`,
        }),
      )
      return new Response('Timestamp expired (±5 minutes)', { status: 403, headers: CORS_HEADERS })
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
          endpoint: '/v1/observations',
          status_code: 403,
          upstream_error: 'hmac_signature_mismatch',
        }),
      )
      return new Response('Invalid signature', { status: 403, headers: CORS_HEADERS })
    }
    originVerified = 'hmac-verified'
  } else {
    if (originResult.status !== 'valid') {
      ctx.waitUntil(
        logWorkerError(env, sql, {
          org_id: body.org_id,
          property_id: body.property_id,
          endpoint: '/v1/observations',
          status_code: 403,
          upstream_error: 'origin_missing: unsigned request without Origin/Referer',
        }),
      )
      return new Response('Origin required for unsigned observations', {
        status: 403,
        headers: CORS_HEADERS,
      })
    }
    originVerified = 'origin-only'
  }

  const pageUrlHash = body.page_url ? await sha256(body.page_url) : null

  const observation = {
    org_id: body.org_id,
    property_id: body.property_id,
    session_fingerprint: body.session_fingerprint ?? 'unknown',
    consent_state: body.consent_state,
    trackers_detected: body.trackers_detected,
    violations: body.violations ?? [],
    page_url_hash: pageUrlHash,
    origin_verified: originVerified,
  }

  // ADR-1003 Sprint 1.2 — zero_storage branch: bypass the INSERT and
  // post to the Next.js bridge. Falls through to INSERT when the
  // bridge isn't configured, to preserve correctness in dev.
  if (isBridgeConfigured(env)) {
    const zero = await isZeroStorage(env, body.org_id).catch(() => false)
    if (zero) {
      ctx.waitUntil(
        postToBridge(env, {
          kind: 'tracker_observation',
          org_id: body.org_id,
          event_fingerprint: observation.session_fingerprint,
          timestamp: new Date().toISOString(),
          payload: {
            property_id: observation.property_id,
            session_fingerprint: observation.session_fingerprint,
            consent_state: observation.consent_state,
            trackers_detected: observation.trackers_detected,
            violations: observation.violations,
            page_url_hash: observation.page_url_hash,
            origin_verified: observation.origin_verified,
          },
        }).then(async (result) => {
          if (!result.sent) {
            await logWorkerError(env, sql, {
              org_id: body.org_id,
              property_id: body.property_id,
              endpoint: '/v1/observations',
              status_code: result.status ?? 0,
              upstream_error:
                `zero_storage_bridge_${result.reason}: ` + (result.detail ?? ''),
            })
          }
        }),
      )
      return new Response(null, { status: 202, headers: CORS_HEADERS })
    }
  }

  // ADR-1010 Phase 3 Sprint 3.2 — Hyperdrive-backed INSERT; REST
  // fallback for the Miniflare harness.
  const writeResult = sql
    ? await insertObservationSql(observation, sql)
    : await insertObservationRest(observation, env)

  if (!writeResult.ok) {
    console.error('Observation write failed:', writeResult.error)
    ctx.waitUntil(
      logWorkerError(env, sql, {
        org_id: body.org_id,
        property_id: body.property_id,
        endpoint: '/v1/observations',
        status_code: writeResult.status,
        upstream_error: writeResult.error,
      }),
    )
  }

  return new Response(null, { status: 202, headers: CORS_HEADERS })
}

type WriteResult = { ok: true } | { ok: false; status: number; error: string }

interface ObservationRow {
  org_id: string
  property_id: string
  session_fingerprint: string
  consent_state: Record<string, boolean>
  trackers_detected: unknown[]
  violations: unknown[]
  page_url_hash: string | null
  origin_verified: 'origin-only' | 'hmac-verified'
}

async function insertObservationSql(
  row: ObservationRow,
  sql: Sql,
): Promise<WriteResult> {
  try {
    await sql`
      insert into public.tracker_observations (
        org_id, property_id, session_fingerprint,
        consent_state, trackers_detected, violations,
        page_url_hash, origin_verified
      ) values (
        ${row.org_id}::uuid,
        ${row.property_id}::uuid,
        ${row.session_fingerprint},
        ${sql.json(row.consent_state as Parameters<typeof sql.json>[0])},
        ${sql.json(row.trackers_detected as Parameters<typeof sql.json>[0])},
        ${sql.json(row.violations as Parameters<typeof sql.json>[0])},
        ${row.page_url_hash},
        ${row.origin_verified}
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

async function insertObservationRest(
  row: ObservationRow,
  env: Env,
): Promise<WriteResult> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/tracker_observations`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_WORKER_KEY ?? '',
      Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  })
  if (res.ok) return { ok: true }
  return { ok: false, status: res.status, error: await res.text() }
}
