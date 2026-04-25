// ADR-1014 Phase 4 Sprint 4.3 — unit coverage for the pure synchronous
// helpers in app/src/lib/api/v1-helpers.ts:
//   - gateScopeOrProblem (scope-presence gate)
//   - requireOrgOrProblem (account-vs-org-key gate)
//
// readContext + respondV1 use next/headers + NextResponse and need a
// Next.js request context to behave; they're exercised by the Phase 3
// E2E suites that hit the live route handlers. Not unit-tested here.

import { describe, it, expect } from 'vitest'
import { gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import type { ApiKeyContext } from '@/lib/api/auth'

function ctx(over: Partial<ApiKeyContext> = {}): ApiKeyContext {
  return {
    key_id: 'kid',
    account_id: 'acc',
    org_id: 'org',
    scopes: [],
    rate_tier: 'starter',
    ...over,
  }
}

describe('gateScopeOrProblem', () => {
  it('returns null when the required scope is present', () => {
    expect(gateScopeOrProblem(ctx({ scopes: ['read'] }), 'read')).toBeNull()
  })

  it('returns null when scopes contain the required one among others', () => {
    expect(
      gateScopeOrProblem(ctx({ scopes: ['admin', 'read', 'write'] }), 'read'),
    ).toBeNull()
  })

  it('returns 403 problem when scopes are empty', () => {
    const r = gateScopeOrProblem(ctx({ scopes: [] }), 'read')
    expect(r).not.toBeNull()
    expect(r!.status).toBe(403)
    expect(r!.body.status).toBe(403)
    expect(r!.body.title).toBe('Forbidden')
  })

  it('returns 403 problem when scopes do not contain the required one', () => {
    const r = gateScopeOrProblem(ctx({ scopes: ['write'] }), 'read')
    expect(r).not.toBeNull()
    expect(r!.status).toBe(403)
    expect(r!.body.detail).toContain('read')
  })

  it('is case-sensitive on scope name (defends against case-folding mutants)', () => {
    expect(gateScopeOrProblem(ctx({ scopes: ['Read'] }), 'read')).not.toBeNull()
    expect(gateScopeOrProblem(ctx({ scopes: ['read'] }), 'Read')).not.toBeNull()
  })

  it('does NOT match when scope is a prefix of an authorised entry', () => {
    // Defends against a mutant that flips `.includes` to `.some(s => s.startsWith(...))`.
    expect(gateScopeOrProblem(ctx({ scopes: ['read.events'] }), 'read')).not.toBeNull()
  })

  it('does NOT match when required scope is a prefix of an authorised entry', () => {
    expect(gateScopeOrProblem(ctx({ scopes: ['read'] }), 'read.events')).not.toBeNull()
  })

  it('emits a body whose detail names the required scope verbatim', () => {
    const r = gateScopeOrProblem(ctx({ scopes: [] }), 'consent.write')
    expect(r!.body.detail).toContain('consent.write')
  })

  it('emits the canonical Forbidden type URL', () => {
    const r = gateScopeOrProblem(ctx({ scopes: [] }), 'read')
    expect(r!.body.type).toBe('https://consentshield.in/errors/forbidden')
  })
})

describe('requireOrgOrProblem', () => {
  it('returns null when org_id is present', () => {
    expect(requireOrgOrProblem(ctx({ org_id: 'org-uuid' }), '/v1/consent/record')).toBeNull()
  })

  it('returns 400 problem when org_id is null', () => {
    const r = requireOrgOrProblem(ctx({ org_id: null }), '/v1/consent/record')
    expect(r).not.toBeNull()
    expect(r!.status).toBe(400)
    expect(r!.body.status).toBe(400)
    expect(r!.body.title).toBe('Bad Request')
    expect(r!.body.detail).toContain('/v1/consent/record')
    expect(r!.body.detail).toContain('account-scoped')
  })

  it('treats empty-string org_id as missing too', () => {
    // The check is `!context.org_id` — empty string is falsy, so account-
    // scoped should also be the verdict for an empty value. Defends
    // against a mutant that changes `!context.org_id` to `context.org_id == null`
    // (which would let empty strings through as "present").
    const r = requireOrgOrProblem(ctx({ org_id: '' }), '/v1/audit')
    expect(r).not.toBeNull()
    expect(r!.status).toBe(400)
  })

  it('emits the canonical Bad-Request type URL', () => {
    const r = requireOrgOrProblem(ctx({ org_id: null }), '/v1/audit')
    expect(r!.body.type).toBe('https://consentshield.in/errors/bad-request')
  })

  it('detail line names the offending route verbatim', () => {
    const r = requireOrgOrProblem(ctx({ org_id: null }), '/v1/security/scans')
    expect(r!.body.detail).toContain('/v1/security/scans')
  })
})
