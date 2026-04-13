import type { Env } from './index'
import { sha256, verifyHMAC, isTimestampValid } from './hmac'
import { getPropertyConfig, validateOrigin, rejectOrigin } from './origin'

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
  const propConfig = await getPropertyConfig(body.property_id, env)
  if (!propConfig) {
    return new Response('Unknown property', { status: 404, headers: CORS_HEADERS })
  }

  const originResult = validateOrigin(request, propConfig.allowed_origins)
  if (originResult.status === 'rejected') {
    return rejectOrigin(originResult.origin)
  }

  // Step 2: HMAC verification
  if (!body.signature || !body.timestamp) {
    return new Response('Missing required fields: signature, timestamp', {
      status: 403,
      headers: CORS_HEADERS,
    })
  }

  if (!isTimestampValid(body.timestamp)) {
    return new Response('Timestamp expired (±5 minutes)', { status: 403, headers: CORS_HEADERS })
  }

  const hmacValid = await verifyHMAC(
    body.org_id,
    body.property_id,
    body.timestamp,
    body.signature,
    propConfig.event_signing_secret,
  )
  if (!hmacValid) {
    return new Response('Invalid signature', { status: 403, headers: CORS_HEADERS })
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
  }

  const bufferRes = await fetch(`${env.SUPABASE_URL}/rest/v1/tracker_observations`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_WORKER_KEY,
      Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(observation),
  })

  if (!bufferRes.ok) {
    console.error('Observation write failed:', await bufferRes.text())
  }

  return new Response(null, { status: 202, headers: CORS_HEADERS })
}
