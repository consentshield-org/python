import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Customer-app proxy.
//
// Rule 12 (CLAUDE.md) — Identity isolation: admin identities
// (`app_metadata.is_admin === true`) MUST NOT reach any customer-app
// surface. This proxy rejects any session carrying that claim with a
// 403 + hint at the admin origin. Non-admin authed users follow the
// standard /dashboard gate.

const ADMIN_ORIGIN =
  process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? 'https://admin.consentshield.in'

export async function proxy(request: NextRequest) {
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

  const { pathname } = request.nextUrl

  // Rule 12 — reject admin identities on every customer surface the
  // proxy sees. A signed-in admin who navigates here gets a crisp 403
  // pointing at the admin origin instead of landing on a dashboard
  // shell they have no RLS visibility into.
  if (user?.app_metadata?.is_admin === true) {
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Not available for operator accounts</title>` +
        `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:80px auto;color:#0F2D5B">` +
        `<h1 style="font-size:20px">Operator accounts can't use the customer app</h1>` +
        `<p style="font-size:14px;color:#475569">This sign-in is for a ConsentShield operator. The customer dashboard isn't available for operator identities.</p>` +
        `<p style="font-size:14px;color:#475569">Go to <a href="${escapeHtml(ADMIN_ORIGIN)}" style="color:#0D7A6B">${escapeHtml(ADMIN_ORIGIN)}</a> instead.</p>` +
        `</div>`,
      { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/signup'],
}
