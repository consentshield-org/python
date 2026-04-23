import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0043 — The customer app is auth-only. The root path is an
// auth-aware redirect, not a landing page. Marketing lives on
// www.consentshield.in (separate workstream).
//
// ADR-1018 Sprint 1.5 — when the request lands via the
// status.consentshield.in alias, redirect to the public status page
// instead of routing into auth. The alias is added in the Vercel
// project; DNS CNAME points status → cname.vercel-dns.com. Other
// paths under the status host stay live (login etc. would still work
// if anyone typed them) — operationally harmless and not worth a
// separate guard.

export const dynamic = 'force-dynamic'

const STATUS_HOST = 'status.consentshield.in'

export default async function Home() {
  const h = await headers()
  const host = h.get('host')?.toLowerCase()
  if (host === STATUS_HOST) {
    redirect('/status')
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  redirect(user ? '/dashboard' : '/login')
}
