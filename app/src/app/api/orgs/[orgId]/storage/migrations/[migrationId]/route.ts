// ADR-1025 Phase 3 Sprint 3.2 — migration status polling endpoint.
//
// Authenticated-user read-only GET. Reads via the existing org_select
// RLS policy on public.storage_migrations — no additional grants needed.
// Returns counters + state + error_text so the BYOK form's live
// progress panel can render.

import { NextResponse } from 'next/server'
import {
  OrgAccessDeniedError,
  requireOrgAccess,
} from '@/lib/auth/require-org-role'

export const dynamic = 'force-dynamic'

interface MigrationStatusResponse {
  id: string
  state: 'queued' | 'copying' | 'completed' | 'failed'
  mode: 'forward_only' | 'copy_existing'
  objects_total: number | null
  objects_copied: number
  started_at: string
  completed_at: string | null
  error_text: string | null
}

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ orgId: string; migrationId: string }> },
) {
  const { orgId, migrationId } = await params

  let authCtx: Awaited<ReturnType<typeof requireOrgAccess>>
  try {
    authCtx = await requireOrgAccess(orgId, ['org_admin', 'admin', 'viewer'])
  } catch (err) {
    if (err instanceof OrgAccessDeniedError) {
      const status = err.reason === 'unauthenticated' ? 401 : 403
      return NextResponse.json({ error: err.reason }, { status })
    }
    throw err
  }

  const { data, error } = await authCtx.supabase
    .from('storage_migrations')
    .select(
      'id, state, mode, objects_total, objects_copied, started_at, completed_at, error_text',
    )
    .eq('id', migrationId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const response: MigrationStatusResponse = {
    id: data.id as string,
    state: data.state as MigrationStatusResponse['state'],
    mode: data.mode as MigrationStatusResponse['mode'],
    objects_total: (data.objects_total as number | null) ?? null,
    objects_copied: (data.objects_copied as number) ?? 0,
    started_at: data.started_at as string,
    completed_at: (data.completed_at as string | null) ?? null,
    error_text: (data.error_text as string | null) ?? null,
  }
  return NextResponse.json(response)
}
