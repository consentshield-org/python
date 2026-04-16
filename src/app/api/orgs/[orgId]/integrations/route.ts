import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { encryptForOrg } from '@/lib/encryption/crypto'
import { checkPlanLimit } from '@/lib/billing/gate'

const VALID_CONNECTOR_TYPES = ['webhook', 'mailchimp', 'hubspot']

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

  const gate = await checkPlanLimit(supabase, orgId, 'deletion_connectors')
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
    api_key?: string
    audience_id?: string
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

  let configPayload: string

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
    configPayload = JSON.stringify({
      webhook_url: body.webhook_url,
      shared_secret: body.shared_secret ?? '',
    })
  } else if (body.connector_type === 'mailchimp') {
    if (!body.api_key || !body.audience_id) {
      return NextResponse.json(
        { error: 'api_key and audience_id are required for mailchimp connectors' },
        { status: 400 },
      )
    }
    if (!body.api_key.includes('-')) {
      return NextResponse.json(
        { error: 'Mailchimp api_key must include a server-prefix suffix (e.g. abc123-us21)' },
        { status: 400 },
      )
    }
    configPayload = JSON.stringify({
      api_key: body.api_key,
      audience_id: body.audience_id,
    })
  } else if (body.connector_type === 'hubspot') {
    if (!body.api_key) {
      return NextResponse.json(
        { error: 'api_key is required for hubspot connectors' },
        { status: 400 },
      )
    }
    configPayload = JSON.stringify({ api_key: body.api_key })
  } else {
    return NextResponse.json({ error: 'Unhandled connector_type' }, { status: 400 })
  }
  const encryptedConfig = await encryptForOrg(supabase, orgId, configPayload)

  // rpc_integration_connector_create (ADR-0009) enforces admin membership,
  // inserts the row, and writes audit_log — all atomically as cs_orchestrator.
  const { data, error } = await supabase.rpc('rpc_integration_connector_create', {
    p_org_id: orgId,
    p_connector_type: body.connector_type,
    p_display_name: body.display_name,
    p_encrypted_config: '\\x' + encryptedConfig.toString('hex'),
  })

  if (error) {
    const code = error.code
    if (code === '28000') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (code === '42501') {
      return NextResponse.json(
        { error: 'Only org admins can manage connectors' },
        { status: 403 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as {
    ok: boolean
    connector_id: string
    connector_type: string
    display_name: string
  }

  return NextResponse.json(
    {
      connector: {
        id: envelope.connector_id,
        connector_type: envelope.connector_type,
        display_name: envelope.display_name,
        status: 'active',
      },
    },
    { status: 201 },
  )
}
