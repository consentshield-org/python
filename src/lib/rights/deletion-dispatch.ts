// Deletion orchestration — dispatches erasure to connectors and records
// immutable receipts in deletion_receipts.
//
// ADR-0007 shipped the generic webhook connector. ADR-0018 adds per-provider
// direct-API dispatchers (Mailchimp, HubSpot) — no customer-owned webhook
// required. Caller supplies the SupabaseClient (authenticated user's client
// in the request path; cs_delivery from an Edge Function).

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash, createHmac } from 'node:crypto'
import { decryptForOrg } from '@/lib/encryption/crypto'
import { buildCallbackUrl } from './callback-signing'

interface Connector {
  id: string
  connector_type: string
  display_name: string
  config: string | Buffer
}

export interface DispatchResult {
  connector_id: string
  display_name: string
  receipt_id: string
  status: string
  error?: string
}

type ReceiptState = 'awaiting_callback' | 'confirmed' | 'dispatch_failed'

interface DispatchOutcome {
  state: ReceiptState
  failure_reason?: string
  request_payload: Record<string, unknown>
}

export async function dispatchDeletion(params: {
  supabase: SupabaseClient
  orgId: string
  triggerType: 'erasure_request' | 'retention_expired' | 'consent_withdrawn'
  triggerId: string
  dataPrincipalEmail: string
}): Promise<DispatchResult[]> {
  const { supabase, orgId, triggerType, triggerId, dataPrincipalEmail } = params

  const { data: connectors, error: connError } = await supabase
    .from('integration_connectors')
    .select('id, connector_type, display_name, config')
    .eq('org_id', orgId)
    .eq('status', 'active')

  if (connError) throw new Error(connError.message)

  const activeConnectors = (connectors ?? []) as Connector[]
  const identifierHash = createHash('sha256').update(dataPrincipalEmail.toLowerCase()).digest('hex')

  const results: DispatchResult[] = []

  for (const conn of activeConnectors) {
    const { data: receipt, error: receiptError } = await supabase
      .from('deletion_receipts')
      .insert({
        org_id: orgId,
        trigger_type: triggerType,
        trigger_id: triggerId,
        connector_id: conn.id,
        target_system: conn.display_name,
        identifier_hash: identifierHash,
        status: 'pending',
      })
      .select('id')
      .single()

    if (receiptError || !receipt) {
      results.push({
        connector_id: conn.id,
        display_name: conn.display_name,
        receipt_id: '',
        status: 'error',
        error: receiptError?.message ?? 'Failed to create receipt',
      })
      continue
    }

    let config: Record<string, unknown>
    try {
      const plaintext = await decryptForOrg(supabase, orgId, conn.config)
      config = JSON.parse(plaintext) as Record<string, unknown>
    } catch (e) {
      const reason = `Config decrypt failed: ${e instanceof Error ? e.message : 'unknown'}`
      await markReceipt(supabase, receipt.id, { state: 'dispatch_failed', failure_reason: reason, request_payload: {} })
      results.push({
        connector_id: conn.id,
        display_name: conn.display_name,
        receipt_id: receipt.id,
        status: 'dispatch_failed',
        error: reason,
      })
      continue
    }

    const outcome = await dispatchByType(
      conn.connector_type,
      config,
      {
        triggerId,
        triggerType,
        receiptId: receipt.id,
        dataPrincipalEmail,
        identifierHash,
      },
    )

    await supabase
      .from('deletion_receipts')
      .update({
        request_payload: outcome.request_payload,
        requested_at: new Date().toISOString(),
      })
      .eq('id', receipt.id)

    await markReceipt(supabase, receipt.id, outcome)

    results.push({
      connector_id: conn.id,
      display_name: conn.display_name,
      receipt_id: receipt.id,
      status: outcome.state,
      error: outcome.failure_reason,
    })
  }

  await supabase.from('audit_log').insert({
    org_id: orgId,
    event_type: 'deletion_dispatched',
    entity_type: 'rights_request',
    entity_id: triggerId,
    payload: {
      trigger_type: triggerType,
      connectors_count: activeConnectors.length,
      receipts: results.map((r) => ({ id: r.receipt_id, status: r.status })),
    },
  })

  return results
}

interface DispatchContext {
  triggerId: string
  triggerType: string
  receiptId: string
  dataPrincipalEmail: string
  identifierHash: string
}

async function dispatchByType(
  connectorType: string,
  config: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  switch (connectorType) {
    case 'webhook':    return dispatchWebhook(config, ctx)
    case 'mailchimp':  return dispatchMailchimp(config, ctx)
    case 'hubspot':    return dispatchHubspot(config, ctx)
    default:
      return {
        state: 'dispatch_failed',
        failure_reason: `Unknown connector_type: ${connectorType}`,
        request_payload: { connector_type: connectorType },
      }
  }
}

async function dispatchWebhook(
  config: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  const webhookUrl = String(config.webhook_url ?? '')
  const sharedSecret = String(config.shared_secret ?? '')

  if (!webhookUrl) {
    return {
      state: 'dispatch_failed',
      failure_reason: 'webhook_url missing from connector config',
      request_payload: {},
    }
  }

  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const payload = {
    event: 'deletion_request',
    request_id: ctx.triggerId,
    receipt_id: ctx.receiptId,
    data_principal: { identifier: ctx.dataPrincipalEmail, identifier_type: 'email' },
    reason: ctx.triggerType,
    callback_url: buildCallbackUrl(ctx.receiptId),
    deadline,
  }
  const rawBody = JSON.stringify(payload)
  const signature = sharedSecret
    ? createHmac('sha256', sharedSecret).update(rawBody).digest('hex')
    : undefined

  const redactedPayload = {
    ...payload,
    data_principal: { identifier_hash: ctx.identifierHash, identifier_type: 'email' },
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (signature) headers['X-ConsentShield-Signature'] = signature

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      return {
        state: 'dispatch_failed',
        failure_reason: `HTTP ${res.status}: ${await res.text().catch(() => '')}`,
        request_payload: redactedPayload,
      }
    }
    return { state: 'awaiting_callback', request_payload: redactedPayload }
  } catch (e) {
    return {
      state: 'dispatch_failed',
      failure_reason: e instanceof Error ? e.message : 'Network error',
      request_payload: redactedPayload,
    }
  }
}

async function dispatchMailchimp(
  config: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  const apiKey = String(config.api_key ?? '')
  const audienceId = String(config.audience_id ?? '')
  const [, serverPrefix] = apiKey.split('-')

  if (!apiKey || !audienceId || !serverPrefix) {
    return {
      state: 'dispatch_failed',
      failure_reason: 'Mailchimp config missing api_key or audience_id (or api_key has no server prefix)',
      request_payload: { connector_type: 'mailchimp' },
    }
  }

  const memberHash = createHash('md5')
    .update(ctx.dataPrincipalEmail.toLowerCase())
    .digest('hex')
  const url = `https://${serverPrefix}.api.mailchimp.com/3.0/lists/${audienceId}/members/${memberHash}`
  const request_payload: Record<string, unknown> = {
    connector_type: 'mailchimp',
    method: 'DELETE',
    url_template: `https://{server_prefix}.api.mailchimp.com/3.0/lists/{audience_id}/members/{md5_email_hash}`,
    identifier_hash: ctx.identifierHash,
  }

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`anystring:${apiKey}`).toString('base64'),
      },
      signal: AbortSignal.timeout(10_000),
    })

    // 204 = archived / deleted; 404 = member already absent — both acceptable.
    if (res.ok || res.status === 404) {
      return { state: 'confirmed', request_payload }
    }
    const body = await res.text().catch(() => '')
    return {
      state: 'dispatch_failed',
      failure_reason: `Mailchimp HTTP ${res.status}: ${body.slice(0, 500)}`,
      request_payload,
    }
  } catch (e) {
    return {
      state: 'dispatch_failed',
      failure_reason: e instanceof Error ? e.message : 'Network error',
      request_payload,
    }
  }
}

async function dispatchHubspot(
  config: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  const apiKey = String(config.api_key ?? '')
  if (!apiKey) {
    return {
      state: 'dispatch_failed',
      failure_reason: 'HubSpot config missing api_key',
      request_payload: { connector_type: 'hubspot' },
    }
  }

  const email = encodeURIComponent(ctx.dataPrincipalEmail)
  const url = `https://api.hubapi.com/crm/v3/objects/contacts/${email}?idProperty=email`
  const request_payload: Record<string, unknown> = {
    connector_type: 'hubspot',
    method: 'DELETE',
    url_template: `https://api.hubapi.com/crm/v3/objects/contacts/{email}?idProperty=email`,
    identifier_hash: ctx.identifierHash,
  }

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (res.ok || res.status === 404) {
      return { state: 'confirmed', request_payload }
    }
    const body = await res.text().catch(() => '')
    return {
      state: 'dispatch_failed',
      failure_reason: `HubSpot HTTP ${res.status}: ${body.slice(0, 500)}`,
      request_payload,
    }
  } catch (e) {
    return {
      state: 'dispatch_failed',
      failure_reason: e instanceof Error ? e.message : 'Network error',
      request_payload,
    }
  }
}

async function markReceipt(
  supabase: SupabaseClient,
  receiptId: string,
  outcome: DispatchOutcome,
): Promise<void> {
  const update: Record<string, unknown> = { status: outcome.state }
  if (outcome.state === 'confirmed') {
    update.confirmed_at = new Date().toISOString()
  }
  if (outcome.state === 'dispatch_failed') {
    update.failure_reason = outcome.failure_reason ?? 'unknown'
    update.retry_count = 1
  }
  await supabase.from('deletion_receipts').update(update).eq('id', receiptId)
}
