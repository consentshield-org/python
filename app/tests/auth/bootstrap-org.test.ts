// ADR-0042 — unit tests for ensureOrgBootstrap idempotency guard.
//
// Mocks only the tiny surface of SupabaseClient that ensureOrgBootstrap
// touches: .from('org_memberships').select().eq().limit().maybeSingle()
// and .rpc('rpc_signup_bootstrap_org', params).

import { describe, it, expect, vi } from 'vitest'
import { ensureOrgBootstrap } from '@/lib/auth/bootstrap-org'
import type { SupabaseClient, User } from '@supabase/supabase-js'

interface MembersQueryResult {
  data: { org_id: string } | null
  error: null
}

interface RpcResult {
  error: { message: string } | null
}

function makeUser(meta: Record<string, unknown> = {}): User {
  return {
    id: 'user-1',
    user_metadata: meta,
  } as unknown as User
}

function makeSupabase(opts: {
  members: MembersQueryResult
  rpc?: RpcResult
  spyRpc?: ReturnType<typeof vi.fn>
}): SupabaseClient {
  const rpcFn = opts.spyRpc ?? vi.fn().mockResolvedValue(opts.rpc ?? { error: null })
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          limit: (_n: number) => ({
            maybeSingle: async () => opts.members,
          }),
        }),
      }),
    }),
    rpc: rpcFn,
  } as unknown as SupabaseClient
}

describe('ADR-0042 — ensureOrgBootstrap', () => {
  it('existing membership → skipped (no RPC call; regression guard)', async () => {
    const rpcSpy = vi.fn()
    const supa = makeSupabase({
      members: { data: { org_id: 'org-existing' }, error: null },
      spyRpc: rpcSpy,
    })

    const result = await ensureOrgBootstrap(supa, makeUser({ org_name: 'Later Created' }))
    expect(result).toEqual({ action: 'skipped', reason: 'existing_member' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('no existing membership + no org_name metadata → skipped (dashboard empty state)', async () => {
    const rpcSpy = vi.fn()
    const supa = makeSupabase({
      members: { data: null, error: null },
      spyRpc: rpcSpy,
    })

    const result = await ensureOrgBootstrap(supa, makeUser({}))
    expect(result).toEqual({ action: 'skipped', reason: 'no_metadata' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('no existing membership + org_name metadata → bootstrapped (RPC called exactly once)', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ error: null })
    const supa = makeSupabase({
      members: { data: null, error: null },
      spyRpc: rpcSpy,
    })

    const result = await ensureOrgBootstrap(
      supa,
      makeUser({ org_name: 'Acme', industry: 'bfsi' }),
    )
    expect(result).toEqual({ action: 'bootstrapped' })
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('rpc_signup_bootstrap_org', {
      p_org_name: 'Acme',
      p_industry: 'bfsi',
    })
  })

  it('bootstrap RPC fails → returns failed discriminator with error message', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ error: { message: 'duplicate key' } })
    const supa = makeSupabase({
      members: { data: null, error: null },
      spyRpc: rpcSpy,
    })

    const result = await ensureOrgBootstrap(supa, makeUser({ org_name: 'Acme' }))
    expect(result).toEqual({ action: 'failed', error: 'duplicate key' })
  })
})
