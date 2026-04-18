import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createServerClient } from '@/lib/supabase/server'
import { getOAuthProvider } from '@/lib/connectors/oauth/registry'

// ADR-0039 — start the OAuth handshake for a provider.
// GET /api/integrations/oauth/<provider>/connect

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params
  const providerConfig = getOAuthProvider(provider)
  if (!providerConfig) {
    return NextResponse.json(
      {
        error: 'oauth_not_configured',
        detail: `No provider "${provider}" found, or OAuth env vars unset on the server.`,
      },
      { status: 404 },
    )
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()
  if (!membership) return NextResponse.json({ error: 'No organisation' }, { status: 403 })
  if (membership.role !== 'org_admin') {
    return NextResponse.json({ error: 'org_admin role required' }, { status: 403 })
  }

  const state = randomBytes(24).toString('hex')
  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/integrations/oauth/${provider}/callback`

  const { error } = await supabase.from('oauth_states').insert({
    state,
    org_id: membership.org_id,
    user_id: user.id,
    provider,
    redirect_uri: redirectUri,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.redirect(providerConfig.authorize_url(state, redirectUri))
}
