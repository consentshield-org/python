// ADR-1025 Phase 3 Sprint 3.2 — internal migration worker.
//
// Bearer-authed POST endpoint. Processes ONE chunk of the given
// migration_id, then — if more work remains — fires the next dispatch
// via public.dispatch_migrate_storage so the chunk chain continues
// with near-zero dead time. The safety-net cron re-kicks any migration
// whose last_activity_at falls behind by > 2 minutes.
//
// Callers:
//   * AFTER INSERT trigger on public.storage_migrations
//   * pg_cron safety-net (storage-migration-retry, */1 * * * *)
//   * admin.storage_migrate RPC (operator-triggered)
//   * this route itself, via the tail-recursive next-chunk dispatch
//
// Auth reuses STORAGE_PROVISION_SECRET — same shared bearer as the
// provision-storage route. Vault-seeded as cs_provision_storage_secret.

import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import { processMigrationChunk } from '@/lib/storage/migrate-org'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SECRET = process.env.STORAGE_PROVISION_SECRET ?? ''

export async function POST(request: Request) {
  if (!SECRET) {
    return NextResponse.json(
      { error: 'STORAGE_PROVISION_SECRET not configured' },
      { status: 500 },
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ') || auth.slice(7).trim() !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { migration_id?: string }
  try {
    body = (await request.json()) as { migration_id?: string }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const migrationId = body.migration_id
  if (!migrationId || typeof migrationId !== 'string') {
    return NextResponse.json(
      { error: 'migration_id required' },
      { status: 400 },
    )
  }

  const pg = csOrchestrator()
  const result = await processMigrationChunk(pg, migrationId)

  // If more work remains, self-schedule the next chunk. The dispatch
  // fires via pg_net; we don't await the HTTP call — the chunk chain
  // is intentionally fire-and-forget so this invocation returns fast.
  if (result.status === 'in_flight') {
    try {
      await pg`select public.dispatch_migrate_storage(${migrationId})`
    } catch {
      // Swallow — the cron safety-net picks up stuck rows within 2 min.
    }
  }

  return NextResponse.json({
    status: result.status,
    mode: result.mode,
    objects_copied: result.objects_copied,
    objects_total: result.objects_total,
    error: result.error,
  })
}
