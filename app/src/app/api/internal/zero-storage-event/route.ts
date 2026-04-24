// ADR-1003 Sprint 1.2 — zero-storage event bridge endpoint.
//
// POST-only. Bearer-authed with WORKER_BRIDGE_SECRET — a new shared
// secret the Worker carries in env.WORKER_BRIDGE_SECRET and the
// Next.js app carries in process.env.WORKER_BRIDGE_SECRET. Separate
// from STORAGE_PROVISION_SECRET so rotating one doesn't affect the
// other (Worker ↔ Next.js trust boundary is distinct from the
// Supabase pg_cron ↔ Next.js trust boundary).
//
// Body shape: { kind, org_id, event_fingerprint, timestamp, payload }
// See zero-storage-bridge.ts for field semantics.

import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import {
  type BridgeKind,
  type BridgeRequest,
  processZeroStorageEvent,
} from '@/lib/delivery/zero-storage-bridge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const SECRET = process.env.WORKER_BRIDGE_SECRET ?? ''

const UUID_RE = /^[0-9a-f-]{36}$/i

function isBridgeKind(v: unknown): v is BridgeKind {
  return v === 'consent_event' || v === 'tracker_observation'
}

export async function POST(request: Request) {
  if (!SECRET) {
    return NextResponse.json(
      { error: 'WORKER_BRIDGE_SECRET not configured' },
      { status: 500 },
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ') || auth.slice(7).trim() !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Partial<BridgeRequest>
  try {
    body = (await request.json()) as Partial<BridgeRequest>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!isBridgeKind(body.kind)) {
    return NextResponse.json(
      { error: 'kind must be consent_event | tracker_observation' },
      { status: 400 },
    )
  }
  if (typeof body.org_id !== 'string' || !UUID_RE.test(body.org_id)) {
    return NextResponse.json(
      { error: 'org_id must be a uuid string' },
      { status: 400 },
    )
  }
  if (
    typeof body.event_fingerprint !== 'string' ||
    body.event_fingerprint.length < 8 ||
    body.event_fingerprint.length > 128
  ) {
    return NextResponse.json(
      { error: 'event_fingerprint must be an 8–128 char string' },
      { status: 400 },
    )
  }
  if (typeof body.timestamp !== 'string' || !body.timestamp) {
    return NextResponse.json(
      { error: 'timestamp must be an ISO-8601 string' },
      { status: 400 },
    )
  }
  if (
    typeof body.payload !== 'object' ||
    body.payload === null ||
    Array.isArray(body.payload)
  ) {
    return NextResponse.json(
      { error: 'payload must be a non-array object' },
      { status: 400 },
    )
  }

  const req: BridgeRequest = {
    kind: body.kind,
    org_id: body.org_id,
    event_fingerprint: body.event_fingerprint,
    timestamp: body.timestamp,
    payload: body.payload as Record<string, unknown>,
  }

  const pg = csOrchestrator()
  const result = await processZeroStorageEvent(pg, req)

  const statusCode =
    result.outcome === 'uploaded' ? 202
      : result.outcome === 'mode_not_zero_storage' ? 409
      : result.outcome === 'no_export_config' ? 409
      : result.outcome === 'unverified_export_config' ? 409
      : 502 // decrypt_failed / endpoint_failed / upload_failed

  return NextResponse.json(result, { status: statusCode })
}
