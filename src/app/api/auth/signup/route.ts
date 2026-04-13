import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { userId, orgName, industry } = await request.json()

  if (!userId || !orgName) {
    return NextResponse.json({ error: 'userId and orgName are required' }, { status: 400 })
  }

  // Create org
  const { data: org, error: orgError } = await supabase
    .from('organisations')
    .insert({ name: orgName, industry })
    .select()
    .single()

  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 })
  }

  // Link user as admin
  const { error: memberError } = await supabase
    .from('organisation_members')
    .insert({ org_id: org.id, user_id: userId, role: 'admin' })

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  // Write to audit_log
  await supabase.from('audit_log').insert({
    org_id: org.id,
    actor_id: userId,
    event_type: 'org_created',
    entity_type: 'organisation',
    entity_id: org.id,
  })

  return NextResponse.json({ org })
}
