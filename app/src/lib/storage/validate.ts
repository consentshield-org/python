// ADR-1003 Phase 2 Sprint 2.1 — BYOK credential scope-down probe.
//
// A customer-supplied S3/R2 credential for ConsentShield MUST be
// write-only. Any extra capability is a liability:
//
//   · GetObject / ListObjectsV2 would let a compromised CS environment
//     exfiltrate historical records. Scope-down makes exfiltration
//     structurally impossible from our side.
//   · DeleteObject would let a compromised CS environment rewrite the
//     audit record. Keeping DELETE out of scope means every object CS
//     writes is immutable unless the customer themselves deletes it.
//
// This probe runs five checks against the supplied credential:
//
//   1. PutObject         — MUST succeed (2xx). If not, the credential
//                          can't actually do its job.
//   2. HeadObject        — MUST fail (4xx). Requires GetObject on S3;
//                          a write-only credential cannot HEAD.
//   3. GetObject         — MUST fail (4xx). Same as HEAD.
//   4. ListObjectsV2     — MUST fail (4xx). Listing proves the
//                          credential can discover object keys, which
//                          a write-only credential should not.
//   5. DeleteObject      — MUST fail (4xx). The immutability
//                          guarantee requires scope-out of DELETE.
//
// The orphan PUT object (cs-probe-*.txt) stays in the customer's
// bucket — we deliberately cannot delete it because DELETE is
// scope-out. Recommend a lifecycle rule expiring cs-probe-* objects
// after 1 day.
//
// Rule 11: the credential lives in local scope only. We never log,
// cache, or persist it here. The byok-validate route keeps it in a
// narrow lexical scope and GC disposes of it after probe return.

import { randomBytes } from 'node:crypto'
import {
  probeDeleteObject,
  probeGetObject,
  probeHeadObject,
  probeListObjectsV2,
  putObject,
} from './sigv4'

export interface ScopeDownConfig {
  provider: 'customer_r2' | 'customer_s3'
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export type CheckKey = 'put' | 'head' | 'get' | 'list' | 'delete'

export type CheckOutcome =
  | 'expected'     // observed status matches expectation (pass)
  | 'over_scoped'  // expected deny, got allow (fail)
  | 'under_scoped' // expected allow, got deny / error (fail)
  | 'error'        // transport / network error (fail, inconclusive)

export interface ProbeCheck {
  expected: 'allow' | 'deny'
  status: number | null
  outcome: CheckOutcome
  error?: string
}

export interface ScopeDownProbeResult {
  ok: boolean
  probeId: string
  durationMs: number
  checks: Record<CheckKey, ProbeCheck>
  // One or two short operator-facing sentences describing what to
  // change. Populated whenever ok=false. Safe for UI display;
  // contains no credential values.
  remediation?: string
  // The PUT object's key. Stays in the customer's bucket (we
  // cannot delete it). Surface to the user so they know it's
  // there.
  orphanObjectKey?: string
}

export interface ScopeDownDeps {
  putObject?: typeof putObject
  probeHeadObject?: typeof probeHeadObject
  probeGetObject?: typeof probeGetObject
  probeListObjectsV2?: typeof probeListObjectsV2
  probeDeleteObject?: typeof probeDeleteObject
  now?: () => number
  randomBytesFn?: (n: number) => Buffer
}

export async function runScopeDownProbe(
  config: ScopeDownConfig,
  deps: ScopeDownDeps = {},
): Promise<ScopeDownProbeResult> {
  const now = deps.now ?? (() => Date.now())
  const rb = deps.randomBytesFn ?? randomBytes
  const doPut = deps.putObject ?? putObject
  const doHead = deps.probeHeadObject ?? probeHeadObject
  const doGet = deps.probeGetObject ?? probeGetObject
  const doList = deps.probeListObjectsV2 ?? probeListObjectsV2
  const doDelete = deps.probeDeleteObject ?? probeDeleteObject

  const probeId = 'cs-probe-' + rb(12).toString('hex')
  const key = probeId + '.txt'
  const started = now()
  const sigv4Opts = {
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    key,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  }

  // Probe 1 — PUT. If it fails the rest can't even run meaningfully
  // (no object to probe against). Return early with a put-specific
  // remediation.
  let putCheck: ProbeCheck
  try {
    const res = await doPut({
      ...sigv4Opts,
      body: Buffer.from(
        JSON.stringify({
          probe_id: probeId,
          kind: 'cs-probe-scope-down',
          timestamp: new Date(now()).toISOString(),
          cs_version: '1',
        }),
        'utf8',
      ),
      contentType: 'application/json; charset=utf-8',
    })
    putCheck = {
      expected: 'allow',
      status: res.status,
      outcome: res.status >= 200 && res.status < 300 ? 'expected' : 'under_scoped',
    }
  } catch (err) {
    putCheck = {
      expected: 'allow',
      status: null,
      outcome: 'under_scoped',
      error: errorMessage(err),
    }
  }

  if (putCheck.outcome !== 'expected') {
    return {
      ok: false,
      probeId,
      durationMs: now() - started,
      checks: {
        put: putCheck,
        head: skippedCheck('deny'),
        get: skippedCheck('deny'),
        list: skippedCheck('deny'),
        delete: skippedCheck('deny'),
      },
      remediation:
        'Your credential cannot write to this bucket. Grant "s3:PutObject" ' +
        '(AWS) or "Object Write" (Cloudflare R2 token) on the bucket and ' +
        'retry. ConsentShield needs write-only access to land consent ' +
        'events + audit exports.',
    }
  }

  // Probes 2–5 run in parallel — each is independent and we want the
  // total wall-clock to be dominated by one network round-trip rather
  // than four.
  const [headRes, getRes, listRes, deleteRes] = await Promise.all([
    denyProbe(() => doHead(sigv4Opts)),
    denyProbe(() => doGet(sigv4Opts)),
    denyProbe(() =>
      doList({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      }),
    ),
    denyProbe(() => doDelete(sigv4Opts)),
  ])

  const checks: Record<CheckKey, ProbeCheck> = {
    put: putCheck,
    head: headRes,
    get: getRes,
    list: listRes,
    delete: deleteRes,
  }

  const overScoped = (
    Object.entries(checks) as Array<[CheckKey, ProbeCheck]>
  ).filter(([, c]) => c.outcome === 'over_scoped')

  const ok = overScoped.length === 0 &&
    headRes.outcome === 'expected' &&
    getRes.outcome === 'expected' &&
    listRes.outcome === 'expected' &&
    deleteRes.outcome === 'expected'

  return {
    ok,
    probeId,
    durationMs: now() - started,
    checks,
    remediation: ok ? undefined : buildRemediation(checks),
    orphanObjectKey: key,
  }
}

async function denyProbe(
  runner: () => Promise<{ status: number }>,
): Promise<ProbeCheck> {
  try {
    const res = await runner()
    return {
      expected: 'deny',
      status: res.status,
      outcome:
        res.status >= 200 && res.status < 300
          ? 'over_scoped'
          : res.status >= 400 && res.status < 500
            ? 'expected'
            : 'error',
      ...(res.status >= 500 ? { error: `server_error_${res.status}` } : {}),
    }
  } catch (err) {
    return {
      expected: 'deny',
      status: null,
      outcome: 'error',
      error: errorMessage(err),
    }
  }
}

function skippedCheck(expected: 'allow' | 'deny'): ProbeCheck {
  return {
    expected,
    status: null,
    outcome: 'error',
    error: 'skipped: prior check failed',
  }
}

function buildRemediation(checks: Record<CheckKey, ProbeCheck>): string {
  const overScoped: string[] = []
  const errors: string[] = []

  if (checks.get.outcome === 'over_scoped' || checks.head.outcome === 'over_scoped') {
    overScoped.push('s3:GetObject')
  }
  if (checks.list.outcome === 'over_scoped') {
    overScoped.push('s3:ListBucket')
  }
  if (checks.delete.outcome === 'over_scoped') {
    overScoped.push('s3:DeleteObject')
  }

  for (const [key, c] of Object.entries(checks) as Array<[CheckKey, ProbeCheck]>) {
    if (c.outcome === 'error' && c.error && c.error !== 'skipped: prior check failed') {
      errors.push(`${key} probe error: ${c.error}`)
    }
  }

  const parts: string[] = []
  if (overScoped.length > 0) {
    parts.push(
      'Your credential is over-scoped. Remove ' +
        overScoped.join(' + ') +
        ' from the policy. ConsentShield needs write-only access — ' +
        'read and delete permissions weaken the audit-record ' +
        'immutability guarantee.',
    )
  }
  if (errors.length > 0) {
    parts.push(
      `Some checks returned transport errors: ${errors.join('; ')}. ` +
        'Retry after confirming the endpoint and region are reachable.',
    )
  }
  if (parts.length === 0) {
    parts.push('Scope-down probe failed. Review the per-check results below.')
  }
  return parts.join(' ')
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
