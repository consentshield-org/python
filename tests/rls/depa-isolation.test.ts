// ADR-0020 Sprint 1.1 — DEPA RLS isolation tests.
//
// Mirrors tests/rls/isolation.test.ts for the six new DEPA tables.
// Runs under `bun run test:rls` alongside the customer-side RLS suite
// and the admin-foundation suite.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  getAnonClient,
  TestOrg,
} from './helpers'

let orgA: TestOrg
let orgB: TestOrg
let orgBPurposeId: string
let orgBArtefactArtefactId: string

beforeAll(async () => {
  orgA = await createTestOrg('depaA')
  orgB = await createTestOrg('depaB')

  const admin = getServiceClient()

  // Seed purpose_definition for Org B
  const { data: pd, error: pdErr } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: orgB.orgId,
      purpose_code: 'marketing',
      display_name: 'Marketing',
      description: 'Marketing communications',
      data_scope: ['email_address'],
      framework: 'dpdp',
    })
    .select('id')
    .single()
  if (pdErr) throw new Error(`seed purpose_definitions failed: ${pdErr.message}`)
  orgBPurposeId = pd.id

  // Seed property + banner + consent_event so we can create a consent_artefact.
  const { data: prop, error: propErr } = await admin
    .from('web_properties')
    .insert({ org_id: orgB.orgId, name: 'Org B Site', url: 'https://b.example.com' })
    .select('id')
    .single()
  if (propErr) throw new Error(`seed web_properties failed: ${propErr.message}`)

  const { data: banner, error: bannerErr } = await admin
    .from('consent_banners')
    .insert({
      org_id: orgB.orgId,
      property_id: prop.id,
      version: 1,
      is_active: true,
      headline: 'Test banner',
      body_copy: 'Accept to continue.',
      purposes: [],
    })
    .select('id')
    .single()
  if (bannerErr) throw new Error(`seed consent_banners failed: ${bannerErr.message}`)

  const { data: ev, error: evErr } = await admin
    .from('consent_events')
    .insert({
      org_id: orgB.orgId,
      property_id: prop.id,
      banner_id: banner.id,
      banner_version: 1,
      session_fingerprint: 'depa-test-fp',
      event_type: 'consent_given',
    })
    .select('id')
    .single()
  if (evErr) throw new Error(`seed consent_events failed: ${evErr.message}`)

  // Seed consent_artefact for Org B (service role bypasses RLS + grants)
  const { data: art, error: artErr } = await admin
    .from('consent_artefacts')
    .insert({
      org_id: orgB.orgId,
      property_id: prop.id,
      banner_id: banner.id,
      banner_version: 1,
      consent_event_id: ev.id,
      session_fingerprint: 'depa-test-fp',
      purpose_definition_id: orgBPurposeId,
      purpose_code: 'marketing',
      data_scope: ['email_address'],
      framework: 'dpdp',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('artefact_id')
    .single()
  if (artErr) throw new Error(`seed consent_artefacts failed: ${artErr.message}`)
  orgBArtefactArtefactId = art.artefact_id
}, 60000)

afterAll(async () => {
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30000)

// ═══════════════════════════════════════════════════════════
// SELECT isolation — User A never sees Org B's DEPA rows
// ═══════════════════════════════════════════════════════════

describe('DEPA SELECT isolation', () => {
  it('User A cannot SELECT Org B purpose_definitions', async () => {
    const { data } = await orgA.client.from('purpose_definitions').select('id').eq('org_id', orgB.orgId)
    expect(data).toEqual([])
  })

  it('User A cannot SELECT Org B consent_artefacts', async () => {
    const { data } = await orgA.client.from('consent_artefacts').select('artefact_id').eq('org_id', orgB.orgId)
    expect(data).toEqual([])
  })

  it('User A cannot SELECT Org B artefact_revocations', async () => {
    const { data } = await orgA.client.from('artefact_revocations').select('id').eq('org_id', orgB.orgId)
    expect(data).toEqual([])
  })

  it('User A cannot SELECT Org B consent_expiry_queue', async () => {
    const { data } = await orgA.client.from('consent_expiry_queue').select('id').eq('org_id', orgB.orgId)
    expect(data).toEqual([])
  })

  it('User A cannot SELECT Org B depa_compliance_metrics', async () => {
    const { data } = await orgA.client.from('depa_compliance_metrics').select('id').eq('org_id', orgB.orgId)
    expect(data).toEqual([])
  })

  it('Anon cannot SELECT any DEPA table', async () => {
    const anon = getAnonClient()
    for (const table of [
      'purpose_definitions',
      'purpose_connector_mappings',
      'consent_artefacts',
      'artefact_revocations',
      'consent_expiry_queue',
      'depa_compliance_metrics',
    ]) {
      const { data, error } = await anon.from(table).select('id').limit(1)
      // Either data is empty (RLS filters) or error with permission/JWT message.
      if (data) expect(data.length).toBe(0)
      else expect(error).toBeTruthy()
    }
  })
})

// ═══════════════════════════════════════════════════════════
// Admin gate on purpose_definitions INSERT
// ═══════════════════════════════════════════════════════════

describe('DEPA admin-gated writes', () => {
  it('Admin of Org A CAN INSERT purpose_definitions for own org', async () => {
    const { error } = await orgA.client
      .from('purpose_definitions')
      .insert({
        org_id: orgA.orgId,
        purpose_code: 'analytics',
        display_name: 'Analytics',
        description: 'Product analytics',
        data_scope: ['user_identifier'],
        framework: 'dpdp',
      })
    expect(error).toBeNull()
  })

  it('User A cannot INSERT purpose_definitions into Org B', async () => {
    const { error } = await orgA.client
      .from('purpose_definitions')
      .insert({
        org_id: orgB.orgId,
        purpose_code: 'spoof',
        display_name: 'Spoof',
        description: 'Cross-tenant spoof attempt',
        data_scope: ['email_address'],
        framework: 'dpdp',
      })
    expect(error).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════
// artefact_revocations append-only + BEFORE trigger org validation
// ═══════════════════════════════════════════════════════════

describe('artefact_revocations append-only', () => {
  it('User A cannot INSERT revocation referencing Org B artefact (BEFORE trigger rejects)', async () => {
    const { error } = await orgA.client
      .from('artefact_revocations')
      .insert({
        org_id: orgA.orgId,
        artefact_id: orgBArtefactArtefactId,
        reason: 'user_withdrawal',
        revoked_by_type: 'data_principal',
      })
    expect(error).toBeTruthy()
  })

  it('User A cannot INSERT revocation with Org B as org_id (RLS rejects)', async () => {
    const { error } = await orgA.client
      .from('artefact_revocations')
      .insert({
        org_id: orgB.orgId,
        artefact_id: orgBArtefactArtefactId,
        reason: 'user_withdrawal',
        revoked_by_type: 'data_principal',
      })
    expect(error).toBeTruthy()
  })

  it('User A cannot UPDATE own-org revocation (no UPDATE policy — append-only)', async () => {
    // Seed a revocation for Org A (user A is org_admin) via an INSERT the
    // RLS policy allows. First create a matching artefact.
    const admin = getServiceClient()
    const { data: prop } = await admin
      .from('web_properties')
      .insert({ org_id: orgA.orgId, name: 'A Site', url: 'https://a.example.com' })
      .select('id')
      .single()
    const { data: banner } = await admin
      .from('consent_banners')
      .insert({
        org_id: orgA.orgId,
        property_id: prop!.id,
        version: 1,
        is_active: true,
        headline: 'A',
        body_copy: 'A',
        purposes: [],
      })
      .select('id')
      .single()
    const { data: ev } = await admin
      .from('consent_events')
      .insert({
        org_id: orgA.orgId,
        property_id: prop!.id,
        banner_id: banner!.id,
        banner_version: 1,
        session_fingerprint: 'a-fp',
        event_type: 'consent_given',
      })
      .select('id')
      .single()
    const { data: pdA } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: orgA.orgId,
        purpose_code: 'revoke-target',
        display_name: 'R',
        description: 'R',
        data_scope: ['email_address'],
        framework: 'dpdp',
      })
      .select('id')
      .single()
    const { data: art } = await admin
      .from('consent_artefacts')
      .insert({
        org_id: orgA.orgId,
        property_id: prop!.id,
        banner_id: banner!.id,
        banner_version: 1,
        consent_event_id: ev!.id,
        session_fingerprint: 'a-fp',
        purpose_definition_id: pdA!.id,
        purpose_code: 'revoke-target',
        data_scope: ['email_address'],
        framework: 'dpdp',
        expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
      })
      .select('artefact_id')
      .single()

    // User A inserts the revocation through the RLS-allowed path.
    const { data: rev, error: insertErr } = await orgA.client
      .from('artefact_revocations')
      .insert({
        org_id: orgA.orgId,
        artefact_id: art!.artefact_id,
        reason: 'user_withdrawal',
        revoked_by_type: 'organisation',
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    // Attempt to UPDATE — must fail (no UPDATE policy for any role on
    // artefact_revocations, append-only).
    const { error: updateErr } = await orgA.client
      .from('artefact_revocations')
      .update({ notes: 'tampered' })
      .eq('id', rev!.id)
    // PostgREST returns no error on a no-op update when RLS filters to
    // zero rows; we require either an error OR the row to remain
    // untouched (notes still null).
    if (!updateErr) {
      const { data: after } = await orgA.client
        .from('artefact_revocations')
        .select('notes')
        .eq('id', rev!.id)
        .single()
      expect(after?.notes).toBeNull()
    }

    // Attempt to DELETE — must fail the same way.
    const { error: deleteErr } = await orgA.client
      .from('artefact_revocations')
      .delete()
      .eq('id', rev!.id)
    if (!deleteErr) {
      const { data: stillThere } = await orgA.client
        .from('artefact_revocations')
        .select('id')
        .eq('id', rev!.id)
      expect(stillThere?.length).toBe(1)
    }
  })
})

// ═══════════════════════════════════════════════════════════
// purpose_connector_mappings admin-gated writes
// ═══════════════════════════════════════════════════════════

describe('purpose_connector_mappings RLS', () => {
  it('User A cannot SELECT Org B purpose_connector_mappings', async () => {
    const { data } = await orgA.client
      .from('purpose_connector_mappings')
      .select('id')
      .eq('org_id', orgB.orgId)
    expect(data).toEqual([])
  })
})
