// ADR-0025 Sprint 1.2 — DEPA score integration tests.
//
// Priority 10 §8 from consentshield-testing-strategy.md:
//   - Test 10.8:  compute_depa_score arithmetic (table-driven).
//   - Test 10.8b: refresh_depa_compliance_metrics round-trip.
//
// Tests hit hosted dev. Each case spins its own org + purpose/artefact
// populations, exercises the RPC, and hand-calculates the expected
// sub-scores for a ±0.1 tolerance assertion.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  TestOrg,
} from '../rls/helpers'

interface DepaScore {
  total: number
  coverage_score: number
  expiry_score: number
  freshness_score: number
  revocation_score: number
}

async function fetchScore(orgId: string): Promise<DepaScore> {
  const admin = getServiceClient()
  const { data, error } = await admin.rpc('compute_depa_score', { p_org_id: orgId })
  if (error) throw new Error(`compute_depa_score: ${error.message}`)
  const f = data as Record<string, unknown>
  return {
    total: Number(f.total ?? 0),
    coverage_score: Number(f.coverage_score ?? 0),
    expiry_score: Number(f.expiry_score ?? 0),
    freshness_score: Number(f.freshness_score ?? 0),
    revocation_score: Number(f.revocation_score ?? 0),
  }
}

async function seedPurpose(
  orgId: string,
  code: string,
  opts: { dataScope: string[]; expiryDays: number },
): Promise<string> {
  const admin = getServiceClient()
  const { data, error } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: orgId,
      purpose_code: code,
      display_name: code,
      description: code,
      data_scope: opts.dataScope,
      default_expiry_days: opts.expiryDays,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  if (error) throw new Error(`seed purpose ${code}: ${error.message}`)
  return data.id as string
}

async function seedArtefact(
  orgId: string,
  purposeDefId: string,
  opts: { propertyId: string; bannerId: string; expiresAt: string; fingerprint: string },
): Promise<{ id: string; artefact_id: string }> {
  const admin = getServiceClient()
  // Need a synthetic consent_event first; process-consent-event pipeline
  // would normally create the artefact, but tests can INSERT directly as
  // service_role with all FK columns populated. purpose_code + framework
  // are read from purpose_definitions.
  const { data: event, error: eErr } = await admin
    .from('consent_events')
    .insert({
      org_id: orgId,
      property_id: opts.propertyId,
      banner_id: opts.bannerId,
      banner_version: 1,
      session_fingerprint: opts.fingerprint,
      event_type: 'consent_given',
      purposes_accepted: [],
      purposes_rejected: [],
    })
    .select('id')
    .single()
  if (eErr) throw new Error(`seed consent_event: ${eErr.message}`)

  const { data: pd, error: pdErr } = await admin
    .from('purpose_definitions')
    .select('purpose_code, data_scope, framework')
    .eq('id', purposeDefId)
    .single()
  if (pdErr) throw new Error(`load purpose: ${pdErr.message}`)

  const { data, error } = await admin
    .from('consent_artefacts')
    .insert({
      org_id: orgId,
      property_id: opts.propertyId,
      banner_id: opts.bannerId,
      banner_version: 1,
      consent_event_id: event.id,
      session_fingerprint: opts.fingerprint,
      purpose_definition_id: purposeDefId,
      purpose_code: pd.purpose_code,
      data_scope: pd.data_scope,
      framework: pd.framework,
      expires_at: opts.expiresAt,
    })
    .select('id, artefact_id')
    .single()
  if (error) throw new Error(`seed artefact: ${error.message}`)
  return data as { id: string; artefact_id: string }
}

async function seedProperty(orgId: string, name: string): Promise<string> {
  const admin = getServiceClient()
  const { data, error } = await admin
    .from('web_properties')
    .insert({ org_id: orgId, name, url: `https://${name.toLowerCase()}.example.com` })
    .select('id')
    .single()
  if (error) throw new Error(`seed property: ${error.message}`)
  return data.id as string
}

async function seedBanner(orgId: string, propertyId: string): Promise<string> {
  const admin = getServiceClient()
  const { data, error } = await admin
    .from('consent_banners')
    .insert({
      org_id: orgId,
      property_id: propertyId,
      version: 1,
      is_active: true,
      headline: 'Score test',
      body_copy: 'body',
      purposes: [],
    })
    .select('id')
    .single()
  if (error) throw new Error(`seed banner: ${error.message}`)
  return data.id as string
}

// ═══════════════════════════════════════════════════════════
// Test 10.8 — compute_depa_score arithmetic
// ═══════════════════════════════════════════════════════════

describe('Test 10.8 — compute_depa_score arithmetic', () => {
  it('empty org returns 10/20 (freshness and revocation default to 5 when input empty)', async () => {
    const org = await createTestOrg('depa-score-empty')
    try {
      const s = await fetchScore(org.orgId)
      // coverage = 0 (no purposes)
      // expiry = 0 (no purposes)
      // freshness = 5 (count = 0 → returns 5)
      // revocation = 5 (count = 0 → returns 5)
      expect(s.coverage_score).toBe(0)
      expect(s.expiry_score).toBe(0)
      expect(s.freshness_score).toBe(5)
      expect(s.revocation_score).toBe(5)
      expect(s.total).toBe(10)
    } finally {
      await cleanupTestOrg(org)
    }
  }, 30_000)

  it('full-coverage org with non-default expiries scores coverage 5 + expiry 5', async () => {
    const org = await createTestOrg('depa-score-full-cov')
    try {
      await seedPurpose(org.orgId, 'marketing', {
        dataScope: ['email_address'],
        expiryDays: 180,
      })
      await seedPurpose(org.orgId, 'analytics', {
        dataScope: ['session_identifier'],
        expiryDays: 90,
      })
      const s = await fetchScore(org.orgId)
      expect(s.coverage_score).toBe(5)
      expect(s.expiry_score).toBe(5)
      // No artefacts yet → freshness default 5
      expect(s.freshness_score).toBe(5)
      // No revocations → revocation default 5
      expect(s.revocation_score).toBe(5)
      expect(s.total).toBe(20)
    } finally {
      await cleanupTestOrg(org)
    }
  }, 30_000)

  it('mixed freshness: one fresh, one near-expiry artefact → freshness 2.5', async () => {
    const org = await createTestOrg('depa-score-freshness')
    try {
      const pid = await seedPurpose(org.orgId, 'marketing', {
        dataScope: ['email_address'],
        expiryDays: 180,
      })
      const propertyId = await seedProperty(org.orgId, 'FreshnessTest')
      const bannerId = await seedBanner(org.orgId, propertyId)

      const far = new Date(Date.now() + 120 * 86_400_000).toISOString()
      const near = new Date(Date.now() + 60 * 86_400_000).toISOString()

      await seedArtefact(org.orgId, pid, {
        propertyId,
        bannerId,
        expiresAt: far,
        fingerprint: 'fresh-1',
      })
      await seedArtefact(org.orgId, pid, {
        propertyId,
        bannerId,
        expiresAt: near,
        fingerprint: 'near-1',
      })

      const s = await fetchScore(org.orgId)
      // 1 of 2 artefacts has expires_at > now + 90 days → 0.5 × 5 = 2.5
      expect(s.freshness_score).toBe(2.5)
    } finally {
      await cleanupTestOrg(org)
    }
  }, 30_000)

  it('default-expiry purpose (365 days) drops expiry_score to 0', async () => {
    const org = await createTestOrg('depa-score-default-expiry')
    try {
      await seedPurpose(org.orgId, 'marketing', {
        dataScope: ['email_address'],
        expiryDays: 365,
      })
      const s = await fetchScore(org.orgId)
      expect(s.coverage_score).toBe(5) // data_scope populated
      expect(s.expiry_score).toBe(0) // 365 is the default — not "explicitly set"
    } finally {
      await cleanupTestOrg(org)
    }
  }, 30_000)

  it('empty-data_scope purpose drops coverage_score to 0', async () => {
    const org = await createTestOrg('depa-score-empty-scope')
    try {
      await seedPurpose(org.orgId, 'marketing', {
        dataScope: [],
        expiryDays: 180,
      })
      const s = await fetchScore(org.orgId)
      expect(s.coverage_score).toBe(0) // no data_scope
      expect(s.expiry_score).toBe(5) // non-default expiry
    } finally {
      await cleanupTestOrg(org)
    }
  }, 30_000)
})

// ═══════════════════════════════════════════════════════════
// Test 10.8b — refresh_depa_compliance_metrics round-trip
// ═══════════════════════════════════════════════════════════

describe('Test 10.8b — refresh_depa_compliance_metrics', () => {
  let org: TestOrg
  beforeAll(async () => {
    org = await createTestOrg('depa-score-refresh')
    await seedPurpose(org.orgId, 'marketing', {
      dataScope: ['email_address'],
      expiryDays: 180,
    })
  }, 30_000)
  afterAll(async () => {
    if (org) await cleanupTestOrg(org)
  }, 30_000)

  it('refresh_depa_compliance_metrics() populates the cache row matching compute_depa_score', async () => {
    const admin = getServiceClient()

    const { error: rpcErr } = await admin.rpc('refresh_depa_compliance_metrics')
    if (rpcErr) throw new Error(`refresh rpc: ${rpcErr.message}`)

    const { data: cached, error: selErr } = await admin
      .from('depa_compliance_metrics')
      .select('total_score, coverage_score, expiry_score, freshness_score, revocation_score, computed_at')
      .eq('org_id', org.orgId)
      .single()
    if (selErr) throw new Error(`select cached: ${selErr.message}`)
    expect(cached).toBeTruthy()

    const expected = await fetchScore(org.orgId)
    expect(Number(cached.total_score)).toBeCloseTo(expected.total, 1)
    expect(Number(cached.coverage_score)).toBeCloseTo(expected.coverage_score, 1)
    expect(Number(cached.expiry_score)).toBeCloseTo(expected.expiry_score, 1)
    expect(Number(cached.freshness_score)).toBeCloseTo(expected.freshness_score, 1)
    expect(Number(cached.revocation_score)).toBeCloseTo(expected.revocation_score, 1)
    expect(cached.computed_at).toBeTruthy()
  }, 30_000)

  it('second refresh idempotently UPSERTs (on conflict updates computed_at)', async () => {
    const admin = getServiceClient()

    const { data: before } = await admin
      .from('depa_compliance_metrics')
      .select('computed_at')
      .eq('org_id', org.orgId)
      .single()
    const beforeAt = before!.computed_at as string

    // Small delay so computed_at can differ detectably.
    await new Promise((r) => setTimeout(r, 1_100))

    const { error } = await admin.rpc('refresh_depa_compliance_metrics')
    if (error) throw new Error(`second refresh: ${error.message}`)

    const { data: after, count } = await admin
      .from('depa_compliance_metrics')
      .select('computed_at', { count: 'exact' })
      .eq('org_id', org.orgId)

    expect(count).toBe(1) // still one row — UPSERT, not INSERT.
    expect(after?.[0].computed_at).not.toBe(beforeAt) // computed_at advanced.
  }, 30_000)
})
