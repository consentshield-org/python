import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Admin proxy gate — runs on every admin-app request.
//
// Rule 24: reject any request whose Host header is not admin.consentshield.in
//   (or a Vercel preview host). Customer subdomains never reach here.
// Rule 21: reject any session lacking app_metadata.is_admin === true.
// Rule 21: reject any session whose aal != 'aal2' — hardware key required.
//
// Stub mode: when ADMIN_HARDWARE_KEY_ENFORCED=false (local dev only) the
// AAL2 check is skipped. Production MUST set ADMIN_HARDWARE_KEY_ENFORCED=true.
//
// See docs/admin/architecture/consentshield-admin-platform.md §3.

const PRODUCTION_HOST = 'admin.consentshield.in'

export async function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const host = request.headers.get('host') ?? ''

  // 1. Rule 24 — reject non-admin hosts
  const isProductionHost = host === PRODUCTION_HOST
  const isVercelPreview = host.endsWith('.vercel.app')
  const isLocalDev = host.startsWith('localhost:') || host.startsWith('127.0.0.1:')
  if (!isProductionHost && !isVercelPreview && !isLocalDev) {
    return new NextResponse('Not found', { status: 404 })
  }

  // 2. Public routes skip the session gate
  //    /monitoring is the Sentry tunnel route (next.config.ts tunnelRoute)
  //    — admin-app client errors need to reach it without going through
  //    the session gate, otherwise error reports get redirected to /login.
  if (
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/api/auth') ||
    url.pathname.startsWith('/monitoring')
  ) {
    return NextResponse.next()
  }

  // 3. Validate Supabase session
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 4. Rule 21 — is_admin claim required
  const isAdmin = user.app_metadata?.is_admin === true
  if (!isAdmin) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // 5. Rule 21 — AAL2 hardware key required (unless stub mode)
  const hardwareKeyEnforced = process.env.ADMIN_HARDWARE_KEY_ENFORCED !== 'false'
  if (hardwareKeyEnforced) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const aal = session?.user?.app_metadata?.aal ?? 'aal1'
    if (aal !== 'aal2') {
      return NextResponse.redirect(
        new URL('/login?reason=mfa_required', request.url),
      )
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
