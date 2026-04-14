// Cloudflare Turnstile server-side verification.
// In production, TURNSTILE_SECRET_KEY is required. In development only, a missing
// key falls back to Cloudflare's always-pass test secret with a one-time warning.

const TURNSTILE_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA'

let warnedDevFallback = false

function resolveSecret(): string {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (secret) return secret

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'TURNSTILE_SECRET_KEY is required in production. Refusing to fall back to Cloudflare always-pass test key.',
    )
  }

  if (!warnedDevFallback) {
    console.warn(
      '[turnstile] TURNSTILE_SECRET_KEY unset — using Cloudflare always-pass test key (development only).',
    )
    warnedDevFallback = true
  }
  return ALWAYS_PASS_SECRET
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: 'Missing Turnstile token' }

  const secret = resolveSecret()

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.append('remoteip', remoteIp)

  try {
    const res = await fetch(TURNSTILE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) {
      return { ok: false, error: `Turnstile endpoint returned ${res.status}` }
    }

    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) return { ok: true }

    return {
      ok: false,
      error: `Turnstile rejected: ${(data['error-codes'] ?? []).join(', ') || 'unknown'}`,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Turnstile network error' }
  }
}
