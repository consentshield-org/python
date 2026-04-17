import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0043 — The customer app is auth-only. The root path is an
// auth-aware redirect, not a landing page. Marketing lives on
// www.consentshield.in (separate workstream).

export const dynamic = 'force-dynamic'

export default async function Home() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  redirect(user ? '/dashboard' : '/login')
}
