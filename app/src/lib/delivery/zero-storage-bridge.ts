// ADR-1003 Sprint 1.2 — zero-storage event bridge.
//
// The Worker POSTs every consent_event / tracker_observation for a
// zero_storage org to /api/internal/zero-storage-event. This module
// does the work of landing the payload in customer R2.
//
// What we promise RIGHT NOW (Sprint 1.2):
//   · The canonical-serialised event payload reaches the customer's
//     R2 bucket. Not losing events is the load-bearing guarantee.
//   · No row lands in consent_events / consent_artefacts /
//     delivery_buffer / audit_log for the org_id. The
//     admin.set_organisation_storage_mode precondition (Sprint 1.2
//     migration) guarantees a verified export_configurations row
//     exists; without it the RPC rejects the mode flip.
//
// What we DON'T yet promise (Sprint 1.3):
//   · consent_artefact_index rows with a TTL so /v1/consent/verify
//     can answer "did this org consent to purpose X" without pulling
//     from customer storage on every call. Until Sprint 1.3 lands,
//     verify reads for zero_storage orgs will return "not found" — a
//     feature gap, NOT data loss.
//
// Runs under cs_orchestrator (has bypassrls + SELECT on
// export_configurations via ADR-1025 Sprint 2.1 grants).

import type postgres from 'postgres'
import { canonicalJson } from '@/lib/delivery/canonical-json'
import { endpointForProvider } from '@/lib/storage/endpoint'
import { decryptCredentials, deriveOrgKey } from '@/lib/storage/org-crypto'
import { putObject as putObjectReal } from '@/lib/storage/sigv4'

type Pg = ReturnType<typeof postgres>

export type BridgeKind = 'consent_event' | 'tracker_observation'

export type BridgeOutcome =
  | 'uploaded'
  | 'mode_not_zero_storage'
  | 'no_export_config'
  | 'unverified_export_config'
  | 'decrypt_failed'
  | 'endpoint_failed'
  | 'upload_failed'

export interface BridgeRequest {
  kind: BridgeKind
  org_id: string
  // Worker provides a stable fingerprint per event — same value as
  // the consent_events.session_fingerprint would be. We use it as
  // the R2 object key suffix so the Worker can retry without
  // duplicating objects (idempotent PUT).
  event_fingerprint: string
  timestamp: string // ISO-8601
  payload: Record<string, unknown>
}

export interface BridgeResult {
  outcome: BridgeOutcome
  orgId: string
  bucket?: string
  objectKey?: string
  durationMs: number
  error?: string
}

export interface BridgeDeps {
  putObject?: typeof putObjectReal
  now?: () => number
}

interface ConfigRow {
  bucket_name: string | null
  path_prefix: string | null
  region: string | null
  storage_provider: string | null
  write_credential_enc: Buffer | null
  is_verified: boolean | null
}

export async function processZeroStorageEvent(
  pg: Pg,
  req: BridgeRequest,
  deps: BridgeDeps = {},
): Promise<BridgeResult> {
  const now = deps.now ?? (() => Date.now())
  const doPut = deps.putObject ?? putObjectReal
  const started = now()

  // Defensive: confirm the org really is zero_storage. The Worker
  // already checked via KV, but KV propagation is eventually
  // consistent and an admin might have just flipped the mode. We
  // refuse rather than write-through — otherwise a rogue or
  // stale-KV Worker could bypass the mode gate.
  const modeRows = (await pg`
    select coalesce(storage_mode, 'standard') as mode
      from public.organisations
     where id = ${req.org_id}
     limit 1
  `) as unknown as Array<{ mode: string }>
  const mode = modeRows[0]?.mode ?? 'standard'
  if (mode !== 'zero_storage') {
    return {
      outcome: 'mode_not_zero_storage',
      orgId: req.org_id,
      durationMs: now() - started,
      error: `mode=${mode}`,
    }
  }

  const cfgRows = (await pg`
    select bucket_name, path_prefix, region, storage_provider,
           write_credential_enc, is_verified
      from public.export_configurations
     where org_id = ${req.org_id}
     limit 1
  `) as unknown as ConfigRow[]
  const cfg = cfgRows[0]

  if (!cfg || cfg.write_credential_enc === null) {
    return {
      outcome: 'no_export_config',
      orgId: req.org_id,
      durationMs: now() - started,
      error: 'no_export_config',
    }
  }
  if (cfg.is_verified !== true) {
    return {
      outcome: 'unverified_export_config',
      orgId: req.org_id,
      bucket: cfg.bucket_name ?? undefined,
      durationMs: now() - started,
      error: 'unverified_export_config',
    }
  }

  let endpoint: string
  try {
    endpoint = endpointForProvider(
      cfg.storage_provider ?? 'cs_managed_r2',
      cfg.region,
    )
  } catch (err) {
    return {
      outcome: 'endpoint_failed',
      orgId: req.org_id,
      bucket: cfg.bucket_name ?? undefined,
      durationMs: now() - started,
      error: errorMessage(err),
    }
  }

  let accessKeyId: string
  let secretAccessKey: string
  try {
    const orgKey = await deriveOrgKey(pg, req.org_id)
    const creds = await decryptCredentials(pg, cfg.write_credential_enc, orgKey)
    accessKeyId = creds.access_key_id
    secretAccessKey = creds.secret_access_key
  } catch {
    return {
      outcome: 'decrypt_failed',
      orgId: req.org_id,
      bucket: cfg.bucket_name ?? undefined,
      durationMs: now() - started,
      error: 'decrypt_failed',
    }
  }

  const body = Buffer.from(canonicalJson(req.payload), 'utf8')
  const objectKey = objectKeyForZeroStorage(cfg.path_prefix, req)

  try {
    await doPut({
      endpoint,
      region: cfg.region ?? 'auto',
      bucket: cfg.bucket_name!,
      key: objectKey,
      accessKeyId,
      secretAccessKey,
      body,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        'cs-org-id': req.org_id,
        'cs-kind': req.kind,
        'cs-event-fingerprint': req.event_fingerprint,
        'cs-timestamp': req.timestamp,
      },
    })
  } catch (err) {
    return {
      outcome: 'upload_failed',
      orgId: req.org_id,
      bucket: cfg.bucket_name ?? undefined,
      objectKey,
      durationMs: now() - started,
      error: errorMessage(err),
    }
  }

  return {
    outcome: 'uploaded',
    orgId: req.org_id,
    bucket: cfg.bucket_name ?? undefined,
    objectKey,
    durationMs: now() - started,
  }
}

// Object key layout: <prefix>zero_storage/<kind>/<YYYY>/<MM>/<DD>/
// <fingerprint>.json. Fingerprint is client-supplied so PUT is
// idempotent on Worker retries.
function objectKeyForZeroStorage(
  pathPrefix: string | null,
  req: BridgeRequest,
): string {
  const prefix = pathPrefix ?? ''
  const d = new Date(req.timestamp)
  const usable = Number.isNaN(d.getTime()) ? new Date() : d
  const yyyy = usable.getUTCFullYear().toString().padStart(4, '0')
  const mm = String(usable.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(usable.getUTCDate()).padStart(2, '0')
  return `${prefix}zero_storage/${req.kind}/${yyyy}/${mm}/${dd}/${req.event_fingerprint}.json`
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
