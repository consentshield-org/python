import type { Env } from './index'
import { sha256, verifyHMAC, isTimestampValid } from './hmac'
import { getPropertyConfig, validateOrigin, rejectOrigin } from './origin'

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

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

export async function handleConsentEvent(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let body: ConsentEventPayload

  try {
    body = (await request.json()) as ConsentEventPayload
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  // Payload validation
  if (!body.org_id || !body.property_id || !body.banner_id || !body.event_type) {
    return new Response('Missing required fields: org_id, property_id, banner_id, event_type', {
      status: 400,
      headers: CORS_HEADERS,
    })
  }

  if (!VALID_EVENT_TYPES.includes(body.event_type)) {
    return new Response(`Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`, {
      status: 400,
      headers: CORS_HEADERS,
    })
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
  }

  // Step 4: Write to consent_events buffer via cs_worker role
  const bufferRes = await fetch(`${env.SUPABASE_URL}/rest/v1/consent_events`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_WORKER_KEY,
      Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(event),
  })

  if (!bufferRes.ok) {
    console.error('Buffer write failed:', await bufferRes.text())
  }

  return new Response(null, { status: 202, headers: CORS_HEADERS })
}
