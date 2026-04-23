// ADR-1014 Phase 3 Sprint 3.5 — DEPA artefact full-lifecycle composition test.
//
// Walks ONE artefact through the complete state machine end-to-end via the
// library helpers that wrap the cs_api pool:
//
//   recordConsent()        → active   (rpc_consent_record)
//   verifyConsent()        → granted
//   revokeArtefact()       → revoked  (rpc_artefact_revoke)
//   verifyConsent()        → revoked
//   revokeArtefact()       → idempotent_replay:true  (no duplicate revocation row)
//   enforce_artefact_expiry() on a SIBLING active artefact with past expiry
//                          → expired
//   verifyConsent() on it  → expired
//   revokeArtefact() on it → artefact_terminal_state:expired
//
// Companion coverage (each owns a specific slice):
//   - tests/integration/consent-revoke.test.ts — branch-by-branch revoke
//     behaviour (10 cases: cross-org, reason_code_missing, unknown_actor_type,
//     already-replaced terminal-state, etc.)
//   - tests/depa/revocation-pipeline.test.ts — cascade precision
//     (deletion_receipts fan-out + data-scope subsetting + replacement-chain
//     freeze + sibling-artefact isolation)
//   - tests/depa/expiry-pipeline.test.ts — enforce_artefact_expiry fan-out +
//     delivery_buffer staging + send_expiry_alerts idempotency
//
// This file owns the FULL-LIFECYCLE proof (Sprint 3.5's "record → active →
// revoke → revoked → expiry-window elapsed → expired" positive) + the
// specific Sprint 3.5 negatives (double-revoke idempotent, revoke-after-
// expire terminal-state).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordConsent } from '../../app/src/lib/consent/record'
import { revokeArtefact } from '../../app/src/lib/consent/revoke'
import { verifyConsent } from '../../app/src/lib/consent/verify'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

const admin = getServiceClient()

interface Fixtures {
  purposeDefinitionId: string
  purposeCode: string
  propertyId: string
}

let org: TestOrg
let keyId: string
let f: Fixtures

async function seedFixtures(testOrg: TestOrg): Promise<Fixtures> {
  const purposeCode = 'lifecycle_test'
  const { data: purpose, error: pErr } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: testOrg.orgId,
      purpose_code: purposeCode,
      display_name: 'Lifecycle Test',
      description: 'Purpose used by artefact-lifecycle test to walk the state machine',
      data_scope: ['email_address'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  if (pErr) throw new Error(`seed purpose: ${pErr.message}`)

  const { data: prop, error: propErr } = await admin
    .from('web_properties')
    .insert({
      org_id: testOrg.orgId,
      name: 'Lifecycle Test Site',
      url: 'https://lifecycle-test.example.invalid',
    })
    .select('id')
    .single()
  if (propErr) throw new Error(`seed property: ${propErr.message}`)

  return {
    purposeDefinitionId: purpose.id as string,
    purposeCode,
    propertyId: prop.id as string,
  }
}

async function seedActiveArtefact(identifier: string): Promise<{ artefactId: string }> {
  const r = await recordConsent({
    keyId,
    orgId: org.orgId,
    propertyId: f.propertyId,
    identifier,
    identifierType: 'email',
    acceptedPurposeIds: [f.purposeDefinitionId],
    capturedAt: new Date().toISOString(),
  })
  if (!r.ok) throw new Error(`recordConsent: ${r.error.kind}`)
  const artefactId = r.data.artefact_ids[0]!.artefact_id
  return { artefactId }
}

beforeAll(async () => {
  org = await createTestOrg('artefactLifecycle')
  f = await seedFixtures(org)
  keyId = (await seedApiKey(org)).keyId
}, 90_000)

afterAll(async () => {
  if (org) await cleanupTestOrg(org)
}, 60_000)

describe('DEPA artefact full lifecycle — record → revoke → expire (Sprint 3.5)', () => {
  it('walks one artefact through every state and asserts verify() reports the right status at each step', async () => {
    const email = `lifecycle-${Date.now()}-${Math.random()}@t.test.consentshield.in`

    // ─── Step 1: record → active ─────────────────────────────────
    const { artefactId } = await seedActiveArtefact(email)
    // `generate_artefact_id()` emits `cs_art_` + time-derived + random,
    // base32-ish so uppercase is possible.
    expect(artefactId).toMatch(/^cs_art_[0-9A-Za-z]+$/)

    const verifyActive = await verifyConsent({
      keyId,
      orgId: org.orgId,
      propertyId: f.propertyId,
      identifier: email,
      identifierType: 'email',
      purposeCode: f.purposeCode,
    })
    expect(verifyActive.ok).toBe(true)
    if (!verifyActive.ok) throw new Error('unreachable')
    expect(verifyActive.data.status).toBe('granted')
    expect(verifyActive.data.active_artefact_id).toBe(artefactId)
    expect(verifyActive.data.revoked_at).toBeNull()
    expect(verifyActive.data.revocation_record_id).toBeNull()

    // ─── Step 2: revoke → revoked ────────────────────────────────
    const revoke1 = await revokeArtefact({
      keyId,
      orgId: org.orgId,
      artefactId,
      reasonCode: 'user_request',
      actorType: 'user',
    })
    expect(revoke1.ok).toBe(true)
    if (!revoke1.ok) throw new Error('unreachable')
    expect(revoke1.data.status).toBe('revoked')
    expect(revoke1.data.idempotent_replay).toBe(false)
    expect(revoke1.data.revocation_record_id).toMatch(/^[0-9a-f-]{36}$/)
    const firstRevocationId = revoke1.data.revocation_record_id

    const verifyRevoked = await verifyConsent({
      keyId,
      orgId: org.orgId,
      propertyId: f.propertyId,
      identifier: email,
      identifierType: 'email',
      purposeCode: f.purposeCode,
    })
    expect(verifyRevoked.ok).toBe(true)
    if (!verifyRevoked.ok) throw new Error('unreachable')
    expect(verifyRevoked.data.status).toBe('revoked')
    expect(verifyRevoked.data.revoked_at).toBeTruthy()
    expect(verifyRevoked.data.revocation_record_id).toBe(firstRevocationId)

    // ─── Step 3: double-revoke → idempotent_replay:true, no new row ─
    const revoke2 = await revokeArtefact({
      keyId,
      orgId: org.orgId,
      artefactId,
      reasonCode: 'user_request_again',
      actorType: 'user',
    })
    expect(revoke2.ok).toBe(true)
    if (!revoke2.ok) throw new Error('unreachable')
    expect(revoke2.data.status).toBe('revoked')
    expect(revoke2.data.idempotent_replay).toBe(true)
    expect(revoke2.data.revocation_record_id).toBe(firstRevocationId)

    // Only ONE artefact_revocations row exists for this artefact.
    const { data: revRows } = await admin
      .from('artefact_revocations')
      .select('id')
      .eq('artefact_id', artefactId)
      .eq('org_id', org.orgId)
    expect(revRows!.length).toBe(1)

    // ─── Step 4: third revoke still idempotent ──────────────────
    const revoke3 = await revokeArtefact({
      keyId,
      orgId: org.orgId,
      artefactId,
      reasonCode: 'x',
      actorType: 'system',
    })
    expect(revoke3.ok).toBe(true)
    if (!revoke3.ok) throw new Error('unreachable')
    expect(revoke3.data.idempotent_replay).toBe(true)

    const { data: revRowsAfter3 } = await admin
      .from('artefact_revocations')
      .select('id')
      .eq('artefact_id', artefactId)
    expect(revRowsAfter3!.length).toBe(1)
  })

  it('expiry window elapsed → enforce_artefact_expiry flips a separate active artefact to expired', async () => {
    // Fresh identifier so we get a second, independent active artefact for
    // the expire-path — the one from the previous test is already revoked.
    const email = `expire-${Date.now()}-${Math.random()}@t.test.consentshield.in`
    const { artefactId } = await seedActiveArtefact(email)

    // Force expires_at into the past so enforce_artefact_expiry will flip it.
    await admin
      .from('consent_artefacts')
      .update({ expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .eq('artefact_id', artefactId)

    // Cron simulation — enforce_artefact_expiry is granted to authenticated +
    // cs_orchestrator; service_role can invoke it directly.
    const { error: enfErr } = await admin.rpc('enforce_artefact_expiry')
    expect(enfErr).toBeNull()

    // Per enforce_artefact_expiry (migration 20260422000001), expiry DELETEs
    // the consent_artefact_index row rather than flipping validity_state.
    // verifyConsent keys off the index, so post-expiry it returns
    // `never_consented` — "there is no live consent". The authoritative
    // `consent_artefacts` row is preserved with `status='expired'` for audit.
    //
    // The `expired` status value from verifyConsent only surfaces in the
    // narrow race window between `expires_at < now()` and the next
    // enforce_artefact_expiry tick (the RPC checks `expires_at <
    // evaluated_at` on active index rows).
    const verifyAfterExpire = await verifyConsent({
      keyId,
      orgId: org.orgId,
      propertyId: f.propertyId,
      identifier: email,
      identifierType: 'email',
      purposeCode: f.purposeCode,
    })
    expect(verifyAfterExpire.ok).toBe(true)
    if (!verifyAfterExpire.ok) throw new Error('unreachable')
    expect(verifyAfterExpire.data.status).toBe('never_consented')
    expect(verifyAfterExpire.data.active_artefact_id).toBeNull()

    // Artefact row itself is preserved with status=expired.
    const { data: artRow } = await admin
      .from('consent_artefacts')
      .select('status')
      .eq('artefact_id', artefactId)
      .single()
    expect(artRow!.status).toBe('expired')

    // Index row is gone (the cascade deleted it).
    const { data: idxRows } = await admin
      .from('consent_artefact_index')
      .select('id')
      .eq('artefact_id', artefactId)
    expect(idxRows!.length).toBe(0)
  })

  it('revoke on an expired artefact returns artefact_terminal_state:expired', async () => {
    // Seed + expire in one shot.
    const email = `revoke-after-expire-${Date.now()}-${Math.random()}@t.test.consentshield.in`
    const { artefactId } = await seedActiveArtefact(email)
    await admin
      .from('consent_artefacts')
      .update({ expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .eq('artefact_id', artefactId)
    await admin.rpc('enforce_artefact_expiry')

    const result = await revokeArtefact({
      keyId,
      orgId: org.orgId,
      artefactId,
      reasonCode: 'too_late',
      actorType: 'user',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.kind).toBe('artefact_terminal_state')
    if (result.error.kind !== 'artefact_terminal_state') throw new Error('narrow')
    expect(result.error.detail).toMatch(/expired/)

    // No revocation row written.
    const { data: revRows } = await admin
      .from('artefact_revocations')
      .select('id')
      .eq('artefact_id', artefactId)
    expect(revRows!.length).toBe(0)
  })

  it('verify on a never-consented identifier returns never_consented', async () => {
    const email = `never-${Date.now()}@t.test.consentshield.in`
    const r = await verifyConsent({
      keyId,
      orgId: org.orgId,
      propertyId: f.propertyId,
      identifier: email,
      identifierType: 'email',
      purposeCode: f.purposeCode,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.data.status).toBe('never_consented')
    expect(r.data.active_artefact_id).toBeNull()
  })
})
