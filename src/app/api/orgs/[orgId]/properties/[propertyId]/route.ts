import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; propertyId: string }> },
) {
  const { orgId, propertyId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('web_properties')
    .select('*')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .single()

  if (error) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ property: data })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; propertyId: string }> },
) {
  const { orgId, propertyId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const updates: Record<string, unknown> = {}

  if (typeof body.name === 'string') updates.name = body.name
  if (typeof body.url === 'string') updates.url = body.url
  if (Array.isArray(body.allowed_origins)) {
    for (const origin of body.allowed_origins) {
      try {
        new URL(origin)
      } catch {
        return NextResponse.json(
          { error: `Invalid origin URL: ${origin}` },
          { status: 400 },
        )
      }
    }
    updates.allowed_origins = body.allowed_origins
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('web_properties')
    .update(updates)
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ property: data })
}
