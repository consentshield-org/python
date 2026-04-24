// ADR-1003 Sprint 1.2 + 1.3 + 1.4 — zero-storage event bridge.
//
// The Worker POSTs every consent_event / tracker_observation for a
// zero_storage org to /api/internal/zero-storage-event. This module
// does the work of landing the payload in customer R2 and (Sprint
// 1.3) seeding a TTL-bounded validity row in consent_artefact_index
// so /v1/consent/verify can answer "did this org consent to purpose
// X" without pulling from customer storage on every call.
//
// Sprint 1.4 addition — Mode B (POST /v1/consent/record) callers may
// supply `identifier_hash` + `identifier_type` in the payload. The
// bridge writes those into consent_artefact_index so /v1/consent/verify
// can match by identifier on zero_storage Mode B events. Worker-path
// (Mode A) continues to omit both (the browser event is anonymous) —
// index rows land with NULL identifier_hash, same as before Sprint 1.4.
//
// Load-bearing guarantee:
//   · The canonical-serialised event payload reaches the customer's
//     R2 bucket. The admin.set_organisation_storage_mode precondition
//     (Sprint 1.2 migration) guarantees a verified
//     export_configurations row exists; without it the RPC rejects
//     the mode flip.
//   · No row lands in consent_events / consent_artefacts /
//     delivery_buffer / audit_log for the org_id.
//
// Best-effort (Sprint 1.3):
//   · After a successful R2 upload of a `consent_event`, one
//     consent_artefact_index row per accepted purpose, with a 24h
//     expires_at. Deterministic artefact_id ("zs-<fingerprint>-
//     <purpose_code>") + ON CONFLICT DO NOTHING make Worker retries
//     idempotent. INSERT failure is swallowed and surfaced via
//     `indexed` in the result — R2 upload remains the durability
//     guarantee. After 24h, /v1/consent/verify will return
//     "not_found" for the event until the Sprint 3.1 refresh-from-R2
//     path lands.
//
// Runs under cs_orchestrator (has bypassrls + SELECT on
// export_configurations via ADR-1025 Sprint 2.1 grants; Sprint 1.3
// migration adds INSERT on consent_artefact_index).

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
  // Sprint 1.3 — number of consent_artefact_index rows INSERTed
  // after a successful upload. 0 when the event was a
  // tracker_observation, when purposes_accepted was empty, when
  // index lookup found no matching purpose_definitions, or when
  // the INSERT path itself failed (best-effort; never blocks the
  // R2 outcome). `indexError` carries the swallowed message for
  // observability.
  indexed?: number
  indexError?: string
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

  // Sprint 1.3 — best-effort consent_artefact_index seeding.
  // R2 upload is the durability guarantee; index writes are
  // a hot-path read cache for /v1/consent/verify. INSERT failure
  // is intentionally swallowed.
  let indexed = 0
  let indexError: string | undefined
  try {
    indexed = await indexAcceptedPurposes(pg, req)
  } catch (err) {
    indexError = errorMessage(err)
  }

  return {
    outcome: 'uploaded',
    orgId: req.org_id,
    bucket: cfg.bucket_name ?? undefined,
    objectKey,
    durationMs: now() - started,
    indexed,
    indexError,
  }
}

// Hard-coded TTL — long enough that the typical session-revocation
// window is covered, short enough that the table doesn't grow
// unbounded for high-volume zero_storage orgs. Sprint 3.1 will add
// a refresh-from-R2 path that re-seeds expired rows on demand.
const ZERO_STORAGE_INDEX_TTL_HOURS = 24

interface PurposeRow {
  purpose_code: string
  framework: string
}

async function indexAcceptedPurposes(
  pg: Pg,
  req: BridgeRequest,
): Promise<number> {
  if (req.kind !== 'consent_event') return 0

  const purposesRaw = req.payload['purposes_accepted']
  if (!Array.isArray(purposesRaw) || purposesRaw.length === 0) return 0
  const purposes = purposesRaw.filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )
  if (purposes.length === 0) return 0

  const propertyIdRaw = req.payload['property_id']
  const propertyId =
    typeof propertyIdRaw === 'string' && propertyIdRaw.length > 0
      ? propertyIdRaw
      : null
  if (!propertyId) return 0

  // Sprint 1.4 — Mode B payloads carry identifier_hash + identifier_type.
  // Mode A (Worker) payloads don't; fall through to NULL.
  const identifierHashRaw = req.payload['identifier_hash']
  const identifierHash =
    typeof identifierHashRaw === 'string' && identifierHashRaw.length > 0
      ? identifierHashRaw
      : null
  const identifierTypeRaw = req.payload['identifier_type']
  const identifierType =
    typeof identifierTypeRaw === 'string' && identifierTypeRaw.length > 0
      ? identifierTypeRaw
      : null

  // Resolve framework per purpose_code from purpose_definitions.
  // Skip unknown codes — a banner referencing a deleted purpose
  // would otherwise produce orphan index rows. cs_orchestrator
  // bypasses RLS so the org_id filter is the only tenant guard.
  const frameworkRows = (await pg`
    select purpose_code, framework
      from public.purpose_definitions
     where org_id = ${req.org_id}
       and purpose_code = any(${purposes}::text[])
  `) as unknown as PurposeRow[]

  if (frameworkRows.length === 0) return 0

  let inserted = 0
  for (const row of frameworkRows) {
    const artefactId = `zs-${req.event_fingerprint}-${row.purpose_code}`
    const result = (await pg`
      insert into public.consent_artefact_index (
        org_id, property_id, artefact_id, consent_event_id,
        identifier_hash, identifier_type,
        validity_state, framework, purpose_code, expires_at
      ) values (
        ${req.org_id}::uuid,
        ${propertyId}::uuid,
        ${artefactId},
        null,
        ${identifierHash},
        ${identifierType},
        'active',
        ${row.framework},
        ${row.purpose_code},
        now() + (${ZERO_STORAGE_INDEX_TTL_HOURS} || ' hours')::interval
      )
      on conflict (org_id, artefact_id) do nothing
      returning artefact_id
    `) as unknown as Array<{ artefact_id: string }>
    if (result.length > 0) inserted += 1
  }
  return inserted
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
