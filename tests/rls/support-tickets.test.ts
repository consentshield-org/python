// ADR-0032 Sprint 2.1 — customer-side support access isolation.
//
// Verifies the three public.* RPCs introduced in migration
// 20260421000001_customer_support_access.sql scope correctly:
//
//   list_org_support_tickets            — caller sees only their org's tickets
//   list_support_ticket_messages(id)    — caller cannot read messages of another org's ticket
//   add_customer_support_message(id, b) — caller cannot add a message to another org's ticket
//
// Plus a positive case: caller can read + reply to their own org's ticket.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  type TestOrg,
} from './helpers'

describe('ADR-0032 support ticket isolation', () => {
  let orgA: TestOrg
  let orgB: TestOrg
  let ticketA: string
  let ticketB: string

  beforeAll(async () => {
    orgA = await createTestOrg('supA')
    orgB = await createTestOrg('supB')

    const service = getServiceClient()

    // Seed one ticket + one admin message for each org, using the
    // service-role client (bypasses RLS) via the admin schema directly.
    const { data: a, error: aErr } = await service
      .schema('admin')
      .from('support_tickets')
      .insert({
        org_id: orgA.orgId,
        subject: 'A ticket',
        reporter_email: orgA.email,
      })
      .select('id')
      .single()
    if (aErr) throw aErr
    ticketA = a.id

    const { data: b, error: bErr } = await service
      .schema('admin')
      .from('support_tickets')
      .insert({
        org_id: orgB.orgId,
        subject: 'B ticket',
        reporter_email: orgB.email,
      })
      .select('id')
      .single()
    if (bErr) throw bErr
    ticketB = b.id

    // Seed one admin-authored message on each ticket.
    await service.schema('admin').from('support_ticket_messages').insert([
      { ticket_id: ticketA, author_kind: 'admin', body: 'hello A' },
      { ticket_id: ticketB, author_kind: 'admin', body: 'hello B' },
    ])
  }, 60000)

  afterAll(async () => {
    if (orgA) await cleanupTestOrg(orgA)
    if (orgB) await cleanupTestOrg(orgB)
  })

  it('list_org_support_tickets returns only caller org tickets', async () => {
    const { data: aList, error: aErr } = await orgA.client.rpc(
      'list_org_support_tickets',
    )
    expect(aErr).toBeNull()
    const aSubjects = (aList ?? []).map((t: { subject: string }) => t.subject)
    expect(aSubjects).toContain('A ticket')
    expect(aSubjects).not.toContain('B ticket')

    const { data: bList, error: bErr } = await orgB.client.rpc(
      'list_org_support_tickets',
    )
    expect(bErr).toBeNull()
    const bSubjects = (bList ?? []).map((t: { subject: string }) => t.subject)
    expect(bSubjects).toContain('B ticket')
    expect(bSubjects).not.toContain('A ticket')
  })

  it('list_support_ticket_messages blocks cross-tenant reads', async () => {
    // Own ticket OK
    const { data: ownMsgs, error: ownErr } = await orgA.client.rpc(
      'list_support_ticket_messages',
      { p_ticket_id: ticketA },
    )
    expect(ownErr).toBeNull()
    expect((ownMsgs ?? []).length).toBeGreaterThan(0)

    // Cross-tenant should be rejected by the RPC
    const { data: foreign, error: foreignErr } = await orgA.client.rpc(
      'list_support_ticket_messages',
      { p_ticket_id: ticketB },
    )
    expect(foreign).toBeNull()
    expect(foreignErr?.message ?? '').toMatch(/forbidden|ticket does not belong/i)
  })

  it('add_customer_support_message blocks cross-tenant writes', async () => {
    // Own ticket OK
    const { data: ownMsgId, error: ownErr } = await orgA.client.rpc(
      'add_customer_support_message',
      { p_ticket_id: ticketA, p_body: 'customer reply' },
    )
    expect(ownErr).toBeNull()
    expect(ownMsgId).toBeTruthy()

    // Cross-tenant rejected
    const { error: crossErr } = await orgA.client.rpc(
      'add_customer_support_message',
      { p_ticket_id: ticketB, p_body: 'sneaky' },
    )
    expect(crossErr?.message ?? '').toMatch(/forbidden|ticket does not belong/i)
  })

  it('list_support_ticket_messages hides is_internal=true from customer', async () => {
    const service = getServiceClient()

    // Seed an internal note on ticket A via service-role.
    const INTERNAL_BODY = 'INTERNAL_MARKER_should_not_leak_to_customer'
    const { error: seedErr } = await service
      .schema('admin')
      .from('support_ticket_messages')
      .insert({
        ticket_id: ticketA,
        author_kind: 'admin',
        body: INTERNAL_BODY,
        is_internal: true,
      })
    expect(seedErr).toBeNull()

    // Customer-side read should NOT see the internal note.
    const { data: visible, error: listErr } = await orgA.client.rpc(
      'list_support_ticket_messages',
      { p_ticket_id: ticketA },
    )
    expect(listErr).toBeNull()
    const bodies = (visible ?? []).map((m: { body: string }) => m.body)
    expect(bodies).not.toContain(INTERNAL_BODY)

    // Admin-side read (service-role bypasses RLS) SHOULD see it.
    const { data: admin, error: adminErr } = await service
      .schema('admin')
      .from('support_ticket_messages')
      .select('body, is_internal')
      .eq('ticket_id', ticketA)
      .eq('is_internal', true)
    expect(adminErr).toBeNull()
    expect((admin ?? []).some((m) => m.body === INTERNAL_BODY)).toBe(true)
  })
})
