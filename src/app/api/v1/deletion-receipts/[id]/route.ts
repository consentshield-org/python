import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyCallback } from '@/lib/rights/callback-signing'

// Public callback endpoint. Signature verified, no auth required.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  const sig = url.searchParams.get('sig')

  if (!sig || !verifyCallback(id, sig)) {
    return NextResponse.json({ error: 'Invalid or missing signature' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    request_id?: string
    status?: string
    records_deleted?: number
    systems_affected?: string[]
    completed_at?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: receipt } = await admin
    .from('deletion_receipts')
    .select('id, org_id, status')
    .eq('id', id)
    .single()

  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  // Idempotency: already confirmed
  if (receipt.status === 'confirmed' || receipt.status === 'completed') {
    return NextResponse.json({ ok: true, already_confirmed: true })
  }

  const validStatuses = ['completed', 'partial', 'failed']
  const reportedStatus = validStatuses.includes(body.status ?? '') ? body.status : 'completed'

  await admin
    .from('deletion_receipts')
    .update({
      status: reportedStatus === 'completed' ? 'confirmed' : reportedStatus,
      confirmed_at: body.completed_at ?? new Date().toISOString(),
      response_payload: {
        status: reportedStatus,
        records_deleted: body.records_deleted ?? 0,
        systems_affected: body.systems_affected ?? [],
      },
    })
    .eq('id', id)

  // Audit log
  await admin.from('audit_log').insert({
    org_id: receipt.org_id,
    event_type: 'deletion_confirmed',
    entity_type: 'deletion_receipt',
    entity_id: id,
    payload: {
      reported_status: reportedStatus,
      records_deleted: body.records_deleted ?? 0,
    },
  })

  return NextResponse.json({ ok: true, receipt_id: id })
}
