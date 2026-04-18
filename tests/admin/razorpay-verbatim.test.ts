import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from './helpers'

// ADR-0050 Sprint 2.1 chunk 3 — verbatim Razorpay webhook preservation.
//
// Tests the rpc_razorpay_webhook_insert_verbatim + stamp_processed pair
// directly (unit-level). Verification reads route through
// admin.billing_webhook_event_detail (platform_operator+); the billing
// schema is not PostgREST-exposed by design, so no service.schema('billing')
// paths here. The insert/stamp RPCs themselves live in public.* and are
// anon-callable (webhook handler's role).
//
// Dev rows accumulate under the per-run suffix. Cleanup uses a
// service-role direct DELETE via raw SQL-less path — we simply accept
// the rows as dev fixture state (keyed by `verbatimtest-<ts>` prefix).

const service = getAdminServiceClient()
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

let owner: AdminTestUser
const runSuffix = `verbatimtest-${Date.now()}`

function payloadFor(type: string, extra: Record<string, unknown> = {}) {
  return {
    event: type,
    payload: extra,
    entity: 'event',
  }
}

async function readEvent(eventId: string): Promise<{
  event_type: string
  signature_verified: boolean
  signature: string
  account_id: string | null
  processed_at: string | null
  processed_outcome: string | null
} | null> {
  const { data, error } = await owner.client
    .schema('admin')
    .rpc('billing_webhook_event_detail', { p_event_id: eventId })
  if (error) return null
  return data as {
    event_type: string
    signature_verified: boolean
    signature: string
    account_id: string | null
    processed_at: string | null
    processed_outcome: string | null
  }
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
})

afterAll(async () => {
  if (owner) await cleanupAdminTestUser(owner)
})

describe('ADR-0050 Sprint 2.1 chunk 3 — razorpay webhook verbatim', () => {
  it('first insert lands a row with signature_verified=true', async () => {
    const eventId = `${runSuffix}-first`
    const p = payloadFor('dispute.created', {
      payment: { entity: { id: 'pay_test_1', status: 'captured' } },
    })

    const { data, error } = await anon.rpc(
      'rpc_razorpay_webhook_insert_verbatim',
      {
        p_event_id: eventId,
        p_event_type: p.event,
        p_signature: 'sig_test_fixture',
        p_payload: p,
      },
    )
    expect(error).toBeNull()
    const env = data as { id: string; duplicate: boolean }
    expect(env.duplicate).toBe(false)

    const row = await readEvent(eventId)
    expect(row).not.toBeNull()
    expect(row!.event_type).toBe('dispute.created')
    expect(row!.signature_verified).toBe(true)
    expect(row!.signature).toBe('sig_test_fixture')
    expect(row!.processed_at).toBeNull()
  })

  it('duplicate event_id returns duplicate=true, does not overwrite', async () => {
    const eventId = `${runSuffix}-dup`
    const p = payloadFor('dispute.created')

    const first = await anon.rpc('rpc_razorpay_webhook_insert_verbatim', {
      p_event_id: eventId,
      p_event_type: p.event,
      p_signature: 'first',
      p_payload: p,
    })
    expect(first.error).toBeNull()
    expect((first.data as { duplicate: boolean }).duplicate).toBe(false)

    const second = await anon.rpc('rpc_razorpay_webhook_insert_verbatim', {
      p_event_id: eventId,
      p_event_type: p.event,
      p_signature: 'second-attempt',
      p_payload: p,
    })
    expect(second.error).toBeNull()
    expect((second.data as { duplicate: boolean }).duplicate).toBe(true)

    const row = await readEvent(eventId)
    expect(row).not.toBeNull()
    expect(row!.signature).toBe('first')
  })

  it('account_id resolves from subscription.id when matching row exists', async () => {
    const subId = `sub_verbatim_${runSuffix}`
    const { data: acct } = await service
      .schema('public')
      .from('accounts')
      .select('id, razorpay_subscription_id')
      .limit(1)
      .single()
    if (!acct) return // no accounts in dev — skip

    const prevSub = acct.razorpay_subscription_id
    await service
      .schema('public')
      .from('accounts')
      .update({ razorpay_subscription_id: subId })
      .eq('id', acct.id)

    const eventId = `${runSuffix}-subresolve`
    const p = {
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: { id: subId, plan_id: 'plan_x', status: 'active' },
        },
      },
    }
    const { data, error } = await anon.rpc(
      'rpc_razorpay_webhook_insert_verbatim',
      {
        p_event_id: eventId,
        p_event_type: p.event,
        p_signature: 'sig',
        p_payload: p,
      },
    )
    expect(error).toBeNull()
    expect((data as { account_id: string }).account_id).toBe(acct.id)

    // Revert.
    await service
      .schema('public')
      .from('accounts')
      .update({ razorpay_subscription_id: prevSub })
      .eq('id', acct.id)
  })

  it('stamp_processed sets processed_at + outcome; idempotent', async () => {
    const eventId = `${runSuffix}-stamp`
    await anon.rpc('rpc_razorpay_webhook_insert_verbatim', {
      p_event_id: eventId,
      p_event_type: 'subscription.activated',
      p_signature: 'sig',
      p_payload: { event: 'subscription.activated', payload: {} },
    })

    const first = await anon.rpc('rpc_razorpay_webhook_stamp_processed', {
      p_event_id: eventId,
      p_outcome: 'ok',
    })
    expect(first.error).toBeNull()

    const row1 = await readEvent(eventId)
    expect(row1!.processed_at).not.toBeNull()
    expect(row1!.processed_outcome).toBe('ok')
    const firstStampedAt = row1!.processed_at!

    // Second stamp is a no-op (processed_at already set).
    await anon.rpc('rpc_razorpay_webhook_stamp_processed', {
      p_event_id: eventId,
      p_outcome: 'retry',
    })
    const row2 = await readEvent(eventId)
    expect(row2!.processed_at).toBe(firstStampedAt)
    expect(row2!.processed_outcome).toBe('ok')
  })

  it('empty event_id raises', async () => {
    const { error } = await anon.rpc('rpc_razorpay_webhook_insert_verbatim', {
      p_event_id: '',
      p_event_type: 'subscription.charged',
      p_signature: 'sig',
      p_payload: { event: 'subscription.charged', payload: {} },
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/p_event_id required/i)
  })

  it('missing event raises in detail RPC', async () => {
    const { error } = await owner.client
      .schema('admin')
      .rpc('billing_webhook_event_detail', {
        p_event_id: `${runSuffix}-nonexistent`,
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not found/i)
  })
})
