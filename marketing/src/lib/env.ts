// Typed access to marketing-site environment variables with safe
// dev fallbacks. See marketing/.env.example for the full catalogue.

// Cloudflare Turnstile "always passes" test pair. Production secret
// comes from the Vercel project env; dev uses these so the contact
// form is interactive locally without provisioning.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA'

export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY

export const TURNSTILE_SECRET_KEY =
  process.env.TURNSTILE_SECRET_KEY || TURNSTILE_TEST_SECRET

export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''

export const CONTACT_INBOX =
  process.env.CONTACT_INBOX || 'hello@consentshield.in'

export const CONTACT_FROM =
  process.env.CONTACT_FROM || 'ConsentShield <hello@consentshield.in>'

// Indicates whether Resend is wired. When false, the contact route logs
// submissions server-side and returns 202 so local dev still exercises
// the success path.
export const RESEND_ENABLED = RESEND_API_KEY.length > 0

// ADR-0058 Sprint 1.2 — customer-app origin used for cross-origin POST
// from the marketing /signup form to /api/public/signup-intake. Dev
// default targets the local customer app; prod is set via Vercel env.
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
