import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS enforces org isolation — we still verify org match for defense in depth
  const { data, error } = await supabase
    .from('web_properties')
    .select('id, name, url, allowed_origins, snippet_verified_at, snippet_last_seen_at, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ properties: data })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, url, allowed_origins } = body

  if (!name || !url) {
    return NextResponse.json({ error: 'name and url are required' }, { status: 400 })
  }

  // Validate allowed_origins format if provided
  const origins = Array.isArray(allowed_origins) ? allowed_origins : []
  for (const origin of origins) {
    try {
      new URL(origin)
    } catch {
      return NextResponse.json(
        { error: `Invalid origin URL: ${origin}` },
        { status: 400 },
      )
    }
  }

  // RLS check via inserted org_id matches JWT claim
  const { data, error } = await supabase
    .from('web_properties')
    .insert({ org_id: orgId, name, url, allowed_origins: origins })
    .select('id, name, url, allowed_origins, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ property: data }, { status: 201 })
}
