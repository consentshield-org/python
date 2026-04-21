import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { verifyBearerToken, problemJson } from '@/lib/api/auth'
import { buildApiContextHeaders } from '@/lib/api/context'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { limitsForTier } from '@/lib/api/rate-limits'

// Customer-app proxy.
//
// Rule 12 (CLAUDE.md) — Identity isolation: admin identities
// (`app_metadata.is_admin === true`) MUST NOT reach any customer-app
// surface. When we see one, the cookie is a stale leftover from an
// earlier admin-app session in the same browser (dev), or an attempt
// to mix identities (prod — very unlikely). Either way, the fix is
// the same: sign the session out on the response and send the user
// to /login with a `reason` hint. The customer can sign in again as a
// customer; the operator can walk away.
//
// ADR-1001 Sprint 2.2 — Bearer gate for /api/v1/* (excluding
// /api/v1/deletion-receipts/* which uses its own HMAC callback scheme).

const PROBLEM_JSON_HEADERS = { 'Content-Type': 'application/problem+json' }

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /api/v1/* — Bearer token gate.
  // Deletion-receipts uses its own HMAC callback verification (ADR-0009);
  // pass it through without touching the Authorization header.
  if (pathname.startsWith('/api/v1/') && !pathname.startsWith('/api/v1/deletion-receipts/')) {
    const result = await verifyBearerToken(request.headers.get('authorization'))

    if (!result.ok) {
      if (result.status === 410) {
        return NextResponse.json(
          problemJson(410, 'Gone', 'This API key has been revoked'),
          { status: 410, headers: PROBLEM_JSON_HEADERS },
        )
      }
      const detail =
        result.reason === 'missing'
          ? 'Authorization header is required'
          : result.reason === 'malformed'
            ? 'Authorization header must be: Bearer cs_live_<token>'
            : 'Invalid or expired API key'
      return NextResponse.json(
        problemJson(401, 'Unauthorized', detail),
        {
          status: 401,
          headers: {
            ...PROBLEM_JSON_HEADERS,
            'WWW-Authenticate': 'Bearer realm="consentshield"',
          },
        },
      )
    }

    // Rate limit by key_id bucket.
    const limits = limitsForTier(result.context.rate_tier)
    const rl = await checkRateLimit(
      `api_key:${result.context.key_id}`,
      limits.perHour,
      60, // 1-hour window
    )
    if (!rl.allowed) {
      return NextResponse.json(
        problemJson(429, 'Too Many Requests', 'Rate limit exceeded for this API key', {
          retry_after: rl.retryInSeconds,
        }),
        {
          status: 429,
          headers: {
            ...PROBLEM_JSON_HEADERS,
            'Retry-After': String(rl.retryInSeconds),
            'X-RateLimit-Limit': String(limits.perHour),
          },
        },
      )
    }

    // Inject verified context + request start time for route-level logging.
    const injected = buildApiContextHeaders(request.headers, result.context)
    injected.set('x-cs-t', String(Date.now()))
    return NextResponse.next({ request: { headers: injected } })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Rule 12 — admin identities never reach the customer app. Sign the
  // session out AND explicitly clear every Supabase auth cookie the
  // browser is carrying. We don't rely on signOut()'s setAll-bridge
  // propagation alone because in middleware context that path is
  // flaky — cookie clears sometimes land on a response object that
  // isn't the one we return.
  if (user?.app_metadata?.is_admin === true) {
    await supabase.auth.signOut()
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = '?reason=operator_session_cleared'
    const redirect = NextResponse.redirect(loginUrl)
    // Every cookie on the incoming request whose name looks like a
    // Supabase auth token gets cleared on the response. Cookie names
    // can use either `-` or `_` as separators depending on the SDK
    // version + project-ref composition — match both. Chunked refresh
    // tokens land under `…auth-token.0` / `…auth_token_0` etc.
    for (const cookie of request.cookies.getAll()) {
      const name = cookie.name
      const isSupabase = name.startsWith('sb-') || name.startsWith('sb_')
      const looksAuthy =
        name.includes('auth-token') ||
        name.includes('auth_token') ||
        name.endsWith('-code-verifier') ||
        name.endsWith('_code_verifier')
      if (isSupabase && looksAuthy) {
        redirect.cookies.delete(name)
      }
    }
    // Carry across anything signOut's cookie bridge set (defence in
    // depth; usually empty after the explicit deletes above).
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  // Protected routes: anything under /dashboard
  if (pathname.startsWith('/dashboard') && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  // Authenticated users on login/signup → redirect to dashboard
  if ((pathname === '/login' || pathname === '/signup') && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/login',
    '/signup',
    '/onboarding',
    '/onboarding/:path*',
    '/api/v1/:path*',
  ],
}
