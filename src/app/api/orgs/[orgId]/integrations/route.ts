import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { encryptForOrg } from '@/lib/encryption/crypto'
import { checkPlanLimit } from '@/lib/billing/gate'

const VALID_CONNECTOR_TYPES = ['webhook']

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

  // RLS enforces org isolation
  const { data, error } = await supabase
    .from('integration_connectors')
    .select('id, connector_type, display_name, status, last_health_check_at, last_error, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ connectors: data })
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

  // Verify admin role and plan gating
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only org admins can manage connectors' },
      { status: 403 },
    )
  }

  const gate = await checkPlanLimit(orgId, 'deletion_connectors')
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: `Your ${gate.plan} plan allows ${gate.limit} deletion connectors. Upgrade to add more.`,
        code: 'plan_limit_reached',
        limit: gate.limit,
        current: gate.current,
        plan: gate.plan,
      },
      { status: 402 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    connector_type?: string
    display_name?: string
    webhook_url?: string
    shared_secret?: string
  } | null

  if (!body?.connector_type || !body.display_name) {
    return NextResponse.json(
      { error: 'connector_type and display_name are required' },
      { status: 400 },
    )
  }

  if (!VALID_CONNECTOR_TYPES.includes(body.connector_type)) {
    return NextResponse.json(
      { error: `connector_type must be one of: ${VALID_CONNECTOR_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  if (body.connector_type === 'webhook') {
    if (!body.webhook_url) {
      return NextResponse.json(
        { error: 'webhook_url is required for webhook connectors' },
        { status: 400 },
      )
    }
    try {
      new URL(body.webhook_url)
    } catch {
      return NextResponse.json({ error: 'Invalid webhook_url' }, { status: 400 })
    }
  }

  // Encrypt the shared secret with the per-org derived key
  const configPayload = JSON.stringify({
    webhook_url: body.webhook_url,
    shared_secret: body.shared_secret ?? '',
  })
  const encryptedConfig = await encryptForOrg(orgId, configPayload)

  // integration_connectors has RLS allowing org insert; we use the user session client
  const { data, error } = await supabase
    .from('integration_connectors')
    .insert({
      org_id: orgId,
      connector_type: body.connector_type,
      display_name: body.display_name,
      config: encryptedConfig,
      status: 'active',
    })
    .select('id, connector_type, display_name, status, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log via service role
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  await admin.from('audit_log').insert({
    org_id: orgId,
    actor_id: user.id,
    event_type: 'connector_added',
    entity_type: 'integration_connector',
    entity_id: data.id,
    payload: { connector_type: body.connector_type, display_name: body.display_name },
  })

  return NextResponse.json({ connector: data }, { status: 201 })
}
