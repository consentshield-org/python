// ADR-0044 Phase 2.5 — invitation email templating.
// One HTML shell with a role-switch on subject line + CTA copy.
// Kept out of the route handler so it can be imported + unit-tested
// without standing up the full POST wiring.

export type InvitationRole =
  | 'account_owner'
  | 'account_viewer'
  | 'org_admin'
  | 'admin'
  | 'viewer'

export type InvitationOrigin =
  | 'operator_invite'
  | 'operator_intake'
  | 'marketing_intake'

export interface DispatchInput {
  role: InvitationRole
  invitedEmail: string
  acceptUrl: string
  planCode: string | null
  defaultOrgName: string | null
  expiresAt: string
  hasExistingAccount: boolean
  /** ADR-0058: origin defaults to operator_invite for back-compat. */
  origin?: InvitationOrigin
}

export interface DispatchEmail {
  subject: string
  html: string
  text: string
}

function brandHeader(): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
      <div style="margin-bottom:24px"><strong style="font-size:18px">ConsentShield</strong></div>
  `
}

function brandFooter(expiresAt: string): string {
  const expires = new Date(expiresAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `
      <p style="margin-top:32px;font-size:12px;color:#666">
        This invitation expires on <strong>${expires}</strong>. If you didn't expect
        this email, you can safely ignore it.
      </p>
      <p style="font-size:12px;color:#666">
        ConsentShield · India's DPDP compliance enforcement engine
      </p>
    </div>
  `
}

function ctaButton(url: string, label: string): string {
  return `
    <div style="margin:24px 0">
      <a href="${url}" style="display:inline-block;background:#0f766e;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">${label}</a>
    </div>
  `
}

function roleCopy(input: DispatchInput): { subject: string; heading: string; body: string } {
  const { role, planCode, defaultOrgName, hasExistingAccount, origin } = input
  switch (role) {
    case 'account_owner':
      if (!hasExistingAccount) {
        const orgBit = defaultOrgName
          ? ` for <strong>${defaultOrgName}</strong>`
          : ''
        const planBit = planCode ? ` on the <strong>${planCode}</strong> plan` : ''

        // ADR-0058: marketing self-serve gets a "welcome" voice; the
        // operator-issued intake reads as "your contracted account is
        // ready"; the legacy operator_invite branch (default) keeps the
        // original copy unchanged.
        if (origin === 'marketing_intake') {
          return {
            subject: 'Welcome to ConsentShield — continue your setup',
            heading: 'Continue your ConsentShield setup',
            body: `Thanks for signing up. Your ConsentShield workspace${orgBit}${planBit} is ready to configure. Click below to verify your email and walk the 7-step onboarding (about 5 minutes).`,
          }
        }
        if (origin === 'operator_intake') {
          return {
            subject: 'Your ConsentShield account is ready to set up',
            heading: 'Your ConsentShield account is ready',
            body: `A ConsentShield operator has provisioned your workspace${orgBit}${planBit}. Click below to verify your email and walk the 7-step onboarding (about 5 minutes).`,
          }
        }
        return {
          subject: 'You have been invited to ConsentShield',
          heading: 'Create your ConsentShield account',
          body: `You've been invited to set up a ConsentShield workspace${orgBit}${planBit}. Click the button below to verify your email and start onboarding.`,
        }
      }
      return {
        subject: 'You have been invited as a ConsentShield account owner',
        heading: 'Join as an account owner',
        body: `You've been invited to join a ConsentShield account as an <strong>account owner</strong>. Account owners have full control over billing and every organisation under the account.`,
      }
    case 'account_viewer':
      return {
        subject: 'You have been invited to a ConsentShield account',
        heading: 'Read-only access to a ConsentShield account',
        body: `You've been invited as an <strong>account viewer</strong> — read-only access across every organisation in the account.`,
      }
    case 'org_admin':
      return {
        subject: 'You have been invited as a ConsentShield org admin',
        heading: 'Join as an organisation admin',
        body: `You've been invited to administer a ConsentShield organisation. Org admins configure banners, manage members, and respond to rights requests within the organisation.`,
      }
    case 'admin':
      return {
        subject: 'You have been invited to a ConsentShield organisation',
        heading: 'Join as an admin',
        body: `You've been invited to a ConsentShield organisation with <strong>admin</strong> privileges — edit compliance configuration and respond to rights requests.`,
      }
    case 'viewer':
      return {
        subject: 'You have been invited to a ConsentShield organisation',
        heading: 'Read-only access to a ConsentShield organisation',
        body: `You've been invited as a <strong>viewer</strong> — read-only access to a ConsentShield organisation's compliance dashboard.`,
      }
  }
}

export function buildDispatchEmail(input: DispatchInput): DispatchEmail {
  const { subject, heading, body } = roleCopy(input)
  const html =
    brandHeader() +
    `<h2 style="font-size:20px;margin:0 0 12px">${heading}</h2>` +
    `<p style="font-size:14px;line-height:1.6;color:#333">${body}</p>` +
    ctaButton(input.acceptUrl, 'Accept invitation') +
    `<p style="font-size:12px;color:#666;word-break:break-all">Or copy this link: <a href="${input.acceptUrl}" style="color:#0f766e">${input.acceptUrl}</a></p>` +
    brandFooter(input.expiresAt)

  const text = [
    heading,
    '',
    body.replace(/<[^>]+>/g, ''),
    '',
    `Accept: ${input.acceptUrl}`,
    '',
    `Expires: ${new Date(input.expiresAt).toLocaleDateString('en-IN')}`,
  ].join('\n')

  return { subject, html, text }
}
