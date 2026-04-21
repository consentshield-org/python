import { describe, expect, it } from 'vitest'
import {
  buildDispatchEmail,
  type InvitationRole,
} from '../src/lib/invitations/dispatch-email'

// ADR-0044 Phase 2.5 — unit tests for the invite email template
// builder. The dispatcher route handler wraps this + Resend + a
// Supabase update, all of which are covered by end-to-end operator
// verification; this file pins the role-to-copy mapping that the
// template consumes.

const base = {
  invitedEmail: 'invitee@example.in',
  acceptUrl: 'https://app.consentshield.in/signup?invite=abc123',
  planCode: 'growth',
  defaultOrgName: 'Acme Technologies',
  expiresAt: '2026-05-15T00:00:00Z',
}

describe('buildDispatchEmail', () => {
  it('account-creating (new account, no existing)', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'account_owner',
      hasExistingAccount: false,
    })
    expect(e.subject).toMatch(/invited/i)
    expect(e.html).toContain('Acme Technologies')
    expect(e.html).toContain('growth')
    expect(e.html).toContain(base.acceptUrl)
    expect(e.text).toContain(base.acceptUrl)
  })

  // ADR-0058 Sprint 1.1 — origin-aware copy.
  it('marketing_intake (welcome voice)', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'account_owner',
      hasExistingAccount: false,
      origin: 'marketing_intake',
    })
    expect(e.subject).toMatch(/welcome/i)
    expect(e.html).toContain('Thanks for signing up')
    expect(e.html).toContain('Acme Technologies')
    expect(e.html).toContain('growth')
  })

  it('operator_intake (operator-provisioned voice)', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'account_owner',
      hasExistingAccount: false,
      origin: 'operator_intake',
    })
    expect(e.subject).toMatch(/account is ready/i)
    expect(e.html).toContain('operator has provisioned')
    expect(e.html).toContain('Acme Technologies')
  })

  it('default origin (back-compat = operator_invite copy)', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'account_owner',
      hasExistingAccount: false,
      // no `origin` passed — falls through to the old copy
    })
    expect(e.subject).toMatch(/invited/i)
    expect(e.subject).not.toMatch(/welcome/i)
  })

  it('add-account_owner (existing account)', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'account_owner',
      hasExistingAccount: true,
    })
    expect(e.subject).toMatch(/account owner/i)
    expect(e.html).toContain('account owner')
  })

  it('account_viewer', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'account_viewer',
      hasExistingAccount: true,
    })
    expect(e.subject).toMatch(/account/i)
    expect(e.html).toContain('read-only')
  })

  it.each<InvitationRole>(['org_admin', 'admin', 'viewer'])(
    'org-scoped role: %s',
    (role) => {
      const e = buildDispatchEmail({
        ...base,
        role,
        hasExistingAccount: true,
      })
      expect(e.subject).toMatch(/organisation|admin/i)
      expect(e.html).toContain(base.acceptUrl)
    },
  )

  it('text alternative strips HTML tags', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'org_admin',
      hasExistingAccount: true,
    })
    expect(e.text).not.toMatch(/<[^>]+>/)
  })

  it('includes expiry date in a human-readable form', () => {
    const e = buildDispatchEmail({
      ...base,
      role: 'viewer',
      hasExistingAccount: true,
    })
    // en-IN date format should surface 15 May 2026 or similar
    expect(e.html).toMatch(/2026/)
  })
})
