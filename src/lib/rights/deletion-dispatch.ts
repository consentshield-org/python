// Deletion orchestration — dispatches deletion requests to webhook connectors
// and creates immutable receipts in deletion_receipts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, createHmac } from 'node:crypto'
import { decryptForOrg } from '@/lib/encryption/crypto'
import { buildCallbackUrl } from './callback-signing'

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

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

/**
 * Dispatch a deletion request to all active webhook connectors for an org.
 * Creates deletion_receipts rows (pending), POSTs signed payloads, updates status.
 */
export async function dispatchDeletion(params: {
  orgId: string
  triggerType: 'erasure_request' | 'retention_expired' | 'consent_withdrawn'
  triggerId: string
  dataPrincipalEmail: string
}): Promise<DispatchResult[]> {
  const admin = service()
  const { orgId, triggerType, triggerId, dataPrincipalEmail } = params

  // Fetch active connectors for this org
  const { data: connectors, error: connError } = await admin
    .from('integration_connectors')
    .select('id, connector_type, display_name, config')
    .eq('org_id', orgId)
    .eq('status', 'active')

  if (connError) throw new Error(connError.message)

  const activeConnectors = (connectors ?? []) as Connector[]
  const identifierHash = createHash('sha256').update(dataPrincipalEmail.toLowerCase()).digest('hex')

  const results: DispatchResult[] = []

  for (const conn of activeConnectors) {
    // Create the receipt row first — gives us a receipt_id to embed in the callback URL
    const { data: receipt, error: receiptError } = await admin
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

    // Decrypt the connector config to get webhook_url + shared_secret
    let webhookUrl: string
    let sharedSecret: string
    try {
      const plaintext = await decryptForOrg(orgId, conn.config)
      const cfg = JSON.parse(plaintext) as { webhook_url: string; shared_secret: string }
      webhookUrl = cfg.webhook_url
      sharedSecret = cfg.shared_secret ?? ''
    } catch (e) {
      await markReceiptFailed(admin, receipt.id, `Config decrypt failed: ${e instanceof Error ? e.message : 'unknown'}`)
      results.push({
        connector_id: conn.id,
        display_name: conn.display_name,
        receipt_id: receipt.id,
        status: 'failed',
        error: 'Failed to decrypt connector config',
      })
      continue
    }

    const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const payload = {
      event: 'deletion_request',
      request_id: triggerId,
      receipt_id: receipt.id,
      data_principal: {
        identifier: dataPrincipalEmail,
        identifier_type: 'email',
      },
      reason: triggerType,
      callback_url: buildCallbackUrl(receipt.id),
      deadline,
    }
    const rawBody = JSON.stringify(payload)
    const signatureHeader = sharedSecret
      ? createHmac('sha256', sharedSecret).update(rawBody).digest('hex')
      : undefined

    // Save request payload (PII-redacted — only the hash, not the email)
    const redactedPayload = {
      ...payload,
      data_principal: { identifier_hash: identifierHash, identifier_type: 'email' },
    }

    await admin
      .from('deletion_receipts')
      .update({
        request_payload: redactedPayload,
        requested_at: new Date().toISOString(),
      })
      .eq('id', receipt.id)

    // POST to the webhook
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (signatureHeader) headers['X-ConsentShield-Signature'] = signatureHeader

      const dispatchRes = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: AbortSignal.timeout(10000),
      })

      if (!dispatchRes.ok) {
        await admin
          .from('deletion_receipts')
          .update({
            status: 'dispatch_failed',
            failure_reason: `HTTP ${dispatchRes.status}: ${await dispatchRes.text().catch(() => '')}`,
            retry_count: 1,
          })
          .eq('id', receipt.id)

        results.push({
          connector_id: conn.id,
          display_name: conn.display_name,
          receipt_id: receipt.id,
          status: 'dispatch_failed',
          error: `HTTP ${dispatchRes.status}`,
        })
        continue
      }

      // Dispatch succeeded — wait for callback
      await admin
        .from('deletion_receipts')
        .update({ status: 'awaiting_callback' })
        .eq('id', receipt.id)

      results.push({
        connector_id: conn.id,
        display_name: conn.display_name,
        receipt_id: receipt.id,
        status: 'awaiting_callback',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      await admin
        .from('deletion_receipts')
        .update({ status: 'dispatch_failed', failure_reason: msg, retry_count: 1 })
        .eq('id', receipt.id)

      results.push({
        connector_id: conn.id,
        display_name: conn.display_name,
        receipt_id: receipt.id,
        status: 'dispatch_failed',
        error: msg,
      })
    }
  }

  // Audit log
  await admin.from('audit_log').insert({
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

async function markReceiptFailed(
  admin: SupabaseClient,
  receiptId: string,
  reason: string,
): Promise<void> {
  await admin
    .from('deletion_receipts')
    .update({ status: 'failed', failure_reason: reason })
    .eq('id', receiptId)
}
