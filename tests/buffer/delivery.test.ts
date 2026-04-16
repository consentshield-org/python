import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

let admin: SupabaseClient
let orgId: string
const cleanupIds: string[] = []

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data, error } = await admin
    .from('organisations')
    .insert({ name: `Buffer Test Org ${Date.now()}` })
    .select('id')
    .single()
  if (error) throw new Error(`org: ${error.message}`)
  orgId = data!.id
}, 30000)

afterAll(async () => {
  for (const id of cleanupIds) {
    await admin.from('audit_log').delete().eq('id', id)
  }
  if (orgId) await admin.from('organisations').delete().eq('id', orgId)
}, 30000)

async function seedAuditRow(overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('audit_log')
    .insert({ org_id: orgId, event_type: 'buffer_test', ...overrides })
    .select('id')
    .single()
  if (error) throw new Error(`seed: ${error.message}`)
  cleanupIds.push(data!.id)
  return data!.id as string
}

describe('sweep_delivered_buffers()', () => {
  it('deletes rows with delivered_at > 5 min ago', async () => {
    const id = await seedAuditRow()
    const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    await admin.from('audit_log').update({ delivered_at: sixMinAgo }).eq('id', id)

    await admin.rpc('sweep_delivered_buffers')

    const { data } = await admin.from('audit_log').select('id').eq('id', id)
    expect(data).toHaveLength(0)
  })

  it('leaves rows with delivered_at < 5 min ago', async () => {
    const id = await seedAuditRow()
    await admin.from('audit_log').update({ delivered_at: new Date().toISOString() }).eq('id', id)

    await admin.rpc('sweep_delivered_buffers')

    const { data } = await admin.from('audit_log').select('id').eq('id', id)
    expect(data).toHaveLength(1)
    await admin.from('audit_log').delete().eq('id', id)
  })

  it('leaves undelivered rows untouched', async () => {
    const id = await seedAuditRow()

    await admin.rpc('sweep_delivered_buffers')

    const { data } = await admin.from('audit_log').select('id').eq('id', id)
    expect(data).toHaveLength(1)
    await admin.from('audit_log').delete().eq('id', id)
  })
})

describe('detect_stuck_buffers()', () => {
  it('reports rows older than 1 hour with no delivered_at', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const id = await seedAuditRow({ created_at: twoHoursAgo })

    const { data, error } = await admin.rpc('detect_stuck_buffers')
    expect(error).toBeNull()

    const auditRow = (data as { buffer_table: string; stuck_count: number }[])
      .find((r) => r.buffer_table === 'audit_log')
    expect(auditRow).toBeTruthy()
    expect(auditRow!.stuck_count).toBeGreaterThanOrEqual(1)

    await admin.from('audit_log').delete().eq('id', id)
  })

  it('does not increase stuck count for a freshly-inserted row', async () => {
    const { data: before } = await admin.rpc('detect_stuck_buffers')
    const countBefore = (before as { buffer_table: string; stuck_count: number }[])
      .find((r) => r.buffer_table === 'audit_log')?.stuck_count ?? 0

    const id = await seedAuditRow()

    const { data: after } = await admin.rpc('detect_stuck_buffers')
    const countAfter = (after as { buffer_table: string; stuck_count: number }[])
      .find((r) => r.buffer_table === 'audit_log')?.stuck_count ?? 0

    expect(countAfter).toBe(countBefore)
    await admin.from('audit_log').delete().eq('id', id)
  })
})

describe('mark_delivered_and_delete()', () => {
  it('atomically marks delivered_at and then deletes the row', async () => {
    const id = await seedAuditRow()

    const { error } = await admin.rpc('mark_delivered_and_delete', {
      p_table_name: 'audit_log',
      p_row_id: id,
    })
    expect(error).toBeNull()

    const { data } = await admin.from('audit_log').select('id').eq('id', id)
    expect(data).toHaveLength(0)
  })
})
