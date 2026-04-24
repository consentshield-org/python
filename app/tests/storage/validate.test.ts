// ADR-1003 Sprint 2.1 — scope-down probe orchestration tests.
//
// All real sigv4 + fetch calls are stubbed. We pin the orchestration
// contract: which checks run, their outcome mapping, remediation
// copy for each over-scoped permission, and the early-out on a
// failed PUT.

import { describe, it, expect, vi } from 'vitest'
import { runScopeDownProbe } from '@/lib/storage/validate'

const CONFIG = {
  provider: 'customer_r2' as const,
  endpoint: 'https://accountid.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'compliance',
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
}

function okPut() {
  return vi.fn().mockResolvedValue({ status: 200, etag: '"x"' })
}

function denied() {
  return vi.fn().mockResolvedValue({ status: 403 })
}

function allowed() {
  return vi.fn().mockResolvedValue({ status: 200 })
}

describe('runScopeDownProbe', () => {
  it('happy path — write-only credential accepted', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: denied(),
      probeGetObject: denied(),
      probeListObjectsV2: denied(),
      probeDeleteObject: denied(),
    })
    expect(result.ok).toBe(true)
    expect(result.remediation).toBeUndefined()
    expect(result.probeId).toMatch(/^cs-probe-[0-9a-f]{24}$/)
    expect(result.orphanObjectKey).toBe(`${result.probeId}.txt`)
    for (const key of ['put', 'head', 'get', 'list', 'delete'] as const) {
      expect(result.checks[key].outcome).toBe('expected')
    }
    expect(result.checks.put.status).toBe(200)
    expect(result.checks.head.status).toBe(403)
  })

  it('early-out when PUT fails — other probes are not invoked', async () => {
    const put = vi.fn().mockRejectedValue(new Error('AccessDenied'))
    const head = denied()
    const get = denied()
    const list = denied()
    const del = denied()
    const result = await runScopeDownProbe(CONFIG, {
      putObject: put,
      probeHeadObject: head,
      probeGetObject: get,
      probeListObjectsV2: list,
      probeDeleteObject: del,
    })
    expect(result.ok).toBe(false)
    expect(result.checks.put.outcome).toBe('under_scoped')
    expect(result.checks.put.status).toBeNull()
    expect(result.checks.put.error).toMatch(/AccessDenied/)
    expect(head).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(result.remediation).toMatch(/s3:PutObject/)
    expect(result.remediation).toMatch(/write-only/)
  })

  it('over-scoped GET (read allowed) → remediation names s3:GetObject', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: denied(),
      probeGetObject: allowed(), // over-scoped
      probeListObjectsV2: denied(),
      probeDeleteObject: denied(),
    })
    expect(result.ok).toBe(false)
    expect(result.checks.get.outcome).toBe('over_scoped')
    expect(result.checks.head.outcome).toBe('expected')
    expect(result.remediation).toMatch(/s3:GetObject/)
    expect(result.remediation).not.toMatch(/s3:PutObject/)
  })

  it('over-scoped HEAD also triggers s3:GetObject remediation (AWS IAM fold)', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: allowed(), // over-scoped via HEAD
      probeGetObject: denied(),
      probeListObjectsV2: denied(),
      probeDeleteObject: denied(),
    })
    expect(result.ok).toBe(false)
    expect(result.checks.head.outcome).toBe('over_scoped')
    expect(result.remediation).toMatch(/s3:GetObject/)
  })

  it('over-scoped LIST → remediation names s3:ListBucket', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: denied(),
      probeGetObject: denied(),
      probeListObjectsV2: allowed(), // over-scoped
      probeDeleteObject: denied(),
    })
    expect(result.ok).toBe(false)
    expect(result.checks.list.outcome).toBe('over_scoped')
    expect(result.remediation).toMatch(/s3:ListBucket/)
  })

  it('over-scoped DELETE → remediation names s3:DeleteObject', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: denied(),
      probeGetObject: denied(),
      probeListObjectsV2: denied(),
      probeDeleteObject: allowed(), // over-scoped
    })
    expect(result.ok).toBe(false)
    expect(result.checks.delete.outcome).toBe('over_scoped')
    expect(result.remediation).toMatch(/s3:DeleteObject/)
  })

  it('admin-grade credential (all allowed) lists all three over-scoped actions', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: allowed(),
      probeGetObject: allowed(),
      probeListObjectsV2: allowed(),
      probeDeleteObject: allowed(),
    })
    expect(result.ok).toBe(false)
    expect(result.remediation).toMatch(/s3:GetObject/)
    expect(result.remediation).toMatch(/s3:ListBucket/)
    expect(result.remediation).toMatch(/s3:DeleteObject/)
  })

  it('network error on HEAD surfaces as outcome=error (inconclusive, fails overall)', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
      probeGetObject: denied(),
      probeListObjectsV2: denied(),
      probeDeleteObject: denied(),
    })
    expect(result.ok).toBe(false)
    expect(result.checks.head.outcome).toBe('error')
    expect(result.checks.head.error).toMatch(/ECONNRESET/)
    expect(result.remediation).toMatch(/transport errors/)
  })

  it('5xx on a deny-expected probe maps to outcome=error, not expected', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: denied(),
      probeGetObject: vi.fn().mockResolvedValue({ status: 503 }),
      probeListObjectsV2: denied(),
      probeDeleteObject: denied(),
    })
    expect(result.ok).toBe(false)
    expect(result.checks.get.outcome).toBe('error')
    expect(result.checks.get.status).toBe(503)
    expect(result.remediation).toMatch(/transport errors/)
  })

  it('probeId is deterministic when randomBytesFn is injected', async () => {
    const result = await runScopeDownProbe(CONFIG, {
      putObject: okPut(),
      probeHeadObject: denied(),
      probeGetObject: denied(),
      probeListObjectsV2: denied(),
      probeDeleteObject: denied(),
      randomBytesFn: () => Buffer.from('000102030405060708090a0b', 'hex'),
    })
    expect(result.probeId).toBe('cs-probe-000102030405060708090a0b')
    expect(result.orphanObjectKey).toBe('cs-probe-000102030405060708090a0b.txt')
  })
})
