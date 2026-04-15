import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Single post-signup / post-email-confirmation landing path.
// - With ?code=... (email confirmation link): exchange for session.
// - Bootstrap the org if the user has none yet and carries org_name in
//   user_metadata (set by the signup form, see ADR-0013).
// - Always redirect to /dashboard on success; /login?error=... on failure.

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  const supabase = await createServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_session`)
  }

  // Idempotency: skip bootstrap if the user is already a member of some org.
  const { data: existing } = await supabase
    .from('organisation_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!existing) {
    const meta = (user.user_metadata ?? {}) as { org_name?: string; industry?: string | null }
    if (meta.org_name) {
      const { error } = await supabase.rpc('rpc_signup_bootstrap_org', {
        p_org_name: meta.org_name,
        p_industry: meta.industry ?? null,
      })
      if (error) {
        return NextResponse.redirect(
          `${origin}/login?error=${encodeURIComponent('bootstrap_failed: ' + error.message)}`,
        )
      }
    }
    // If the user has no membership and no pending org_name metadata,
    // let /dashboard's own empty-state handle it — do not error here.
  }

  return NextResponse.redirect(`${origin}/dashboard`)
}
