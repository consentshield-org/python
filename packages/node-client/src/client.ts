// ADR-1006 Phase 1 Sprint 1.1 — ConsentShieldClient class.
//
// Public surface kicked off in Sprint 1.1 (constructor + auth + transport).
// Per-endpoint methods land in Sprint 1.2 (verify, verifyBatch),
// Sprint 1.3 (record, revoke, deletion, artefact CRUD), and Sprint 1.4
// (publication + integration examples).

import { HttpClient, type FetchImpl } from './http'
import {
  verify as verifyImpl,
  verifyBatch as verifyBatchImpl,
  type FailOpenCallback,
  type VerifyInput,
  type VerifyBatchInput,
} from './verify'
import { recordConsent as recordImpl, type RecordConsentInput } from './record'
import { revokeArtefact as revokeImpl, type RevokeArtefactInput } from './revoke'
import {
  getArtefact as getArtefactImpl,
  iterateArtefacts as iterateArtefactsImpl,
  listArtefacts as listArtefactsImpl,
  type ListArtefactsInput,
} from './artefacts'
import {
  iterateEvents as iterateEventsImpl,
  listEvents as listEventsImpl,
  type ListEventsInput,
} from './events'
import {
  iterateDeletionReceipts as iterateDeletionReceiptsImpl,
  listDeletionReceipts as listDeletionReceiptsImpl,
  triggerDeletion as triggerDeletionImpl,
  type ListDeletionReceiptsInput,
  type TriggerDeletionInput,
} from './deletion'
import {
  createRightsRequest as createRightsRequestImpl,
  iterateRightsRequests as iterateRightsRequestsImpl,
  listRightsRequests as listRightsRequestsImpl,
  type CreateRightsRequestInput,
  type ListRightsRequestsInput,
} from './rights'
import {
  iterateAuditLog as iterateAuditLogImpl,
  listAuditLog as listAuditLogImpl,
  type ListAuditLogInput,
} from './audit'
import type {
  ArtefactDetail,
  ArtefactListEnvelope,
  ArtefactListItem,
  AuditLogEnvelope,
  AuditLogItem,
  DeletionReceiptRow,
  DeletionReceiptsEnvelope,
  DeletionTriggerEnvelope,
  EventListEnvelope,
  EventListItem,
  OpenFailureEnvelope,
  RecordEnvelope,
  RevokeEnvelope,
  RightsRequestCreatedEnvelope,
  RightsRequestItem,
  RightsRequestListEnvelope,
  VerifyBatchEnvelope,
  VerifyEnvelope,
} from './types'

/**
 * Configuration for a `ConsentShieldClient` instance.
 *
 * Defaults are tuned for the v2 whitepaper §5.4 compliance posture: a
 * 2-second per-request timeout (so a slow ConsentShield never blocks
 * the customer's hot path past the consent-decision budget), and
 * fail-CLOSED behaviour on `verify` failure (so a network blip never
 * lets withdrawn consent silently fall through).
 */
export interface ConsentShieldClientOptions {
  /** Bearer key issued via the admin console. MUST start with `cs_live_`. */
  apiKey: string
  /** API origin. Default: `https://app.consentshield.in`. No trailing /v1 — added internally. */
  baseUrl?: string
  /** Per-request timeout in ms. Default: 2 000. Compliance posture — do NOT raise above 5 000 without an audit-trail rationale. */
  timeoutMs?: number
  /** Retry attempts on 5xx + transport error. Default: 3. Set 0 to disable retries entirely. */
  maxRetries?: number
  /**
   * Compliance switch — Sprint 1.2 wires this through. When `false` (the
   * SDK default), a `verify` call that times out / 5xx-fails / transport-
   * fails throws `ConsentVerifyError` and the calling code MUST treat
   * the data principal as "consent NOT verified". When `true`, the SDK
   * returns a `{ status: 'open_failure', reason }` shape and writes an
   * audit record via `/v1/audit`. Equivalent to setting
   * `CONSENT_VERIFY_FAIL_OPEN=true` in the environment.
   */
  failOpen?: boolean
  /**
   * Audit-trail callback fired once per fail-open verify outcome (after
   * the OpenFailureEnvelope is built, before it is returned). Default
   * implementation: structured `console.warn`. Production wiring: send
   * to Sentry, your structured logger, or a custom `/v1/audit` POST so
   * the compliance override is recorded deliberately.
   *
   * Fire-and-forget — promise return is NOT awaited; throws inside the
   * callback are caught + emitted via `console.error` and never break
   * the verify call site.
   */
  onFailOpen?: FailOpenCallback
  /** Override for testing — defaults to global fetch. */
  fetchImpl?: FetchImpl
  /** Override for testing — defaults to setTimeout. */
  sleepImpl?: (ms: number) => Promise<void>
}

const API_KEY_PREFIX = 'cs_live_'
const DEFAULT_BASE_URL = 'https://app.consentshield.in'
const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_MAX_RETRIES = 3

const ENV_FAIL_OPEN = 'CONSENT_VERIFY_FAIL_OPEN'

function readEnvFailOpen(): boolean {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[ENV_FAIL_OPEN]
  return raw === 'true' || raw === '1'
}

/**
 * Top-level entry point for the ConsentShield Node SDK.
 *
 * @example
 * ```ts
 * import { ConsentShieldClient } from '@consentshield/node'
 *
 * const client = new ConsentShieldClient({ apiKey: process.env.CS_API_KEY! })
 *
 * // Sprint 1.2 (planned):
 * // const ok = await client.verify({ propertyId, dataPrincipalIdentifier, purposeCode })
 * ```
 */
export class ConsentShieldClient {
  /** @internal — exposed for SDK-internal method modules in Sprint 1.2+. */
  readonly http: HttpClient

  /** Final resolved baseUrl after defaults + trim. Useful for test assertions. */
  readonly baseUrl: string

  /** Resolved timeoutMs (default 2 000). Read-only after construction. */
  readonly timeoutMs: number

  /** Resolved maxRetries (default 3). Read-only after construction. */
  readonly maxRetries: number

  /** Resolved failOpen flag — env var honoured when option is undefined. */
  readonly failOpen: boolean

  /** Resolved onFailOpen callback — defaults to a structured console.warn. */
  readonly onFailOpen: FailOpenCallback

  constructor(opts: ConsentShieldClientOptions) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError(
        '@consentshield/node: ConsentShieldClient requires an options object',
      )
    }
    if (typeof opts.apiKey !== 'string' || !opts.apiKey.startsWith(API_KEY_PREFIX)) {
      throw new TypeError(
        '@consentshield/node: apiKey must be a string starting with "cs_live_". ' +
          'Issue keys via the admin console; never hard-code keys in source.',
      )
    }
    if (opts.timeoutMs !== undefined && (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0)) {
      throw new TypeError(
        '@consentshield/node: timeoutMs must be a positive finite number',
      )
    }
    if (
      opts.maxRetries !== undefined &&
      (!Number.isInteger(opts.maxRetries) || opts.maxRetries < 0)
    ) {
      throw new TypeError(
        '@consentshield/node: maxRetries must be a non-negative integer',
      )
    }

    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
    this.failOpen = opts.failOpen ?? readEnvFailOpen()
    this.onFailOpen = opts.onFailOpen ?? defaultFailOpenCallback

    this.http = new HttpClient({
      baseUrl: this.baseUrl,
      apiKey: opts.apiKey,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      fetchImpl: opts.fetchImpl,
      sleepImpl: opts.sleepImpl,
    })
  }

  /**
   * Liveness probe. Returns `true` when `/v1/_ping` responds 200; throws
   * `ConsentShieldApiError` / `ConsentShieldTimeoutError` /
   * `ConsentShieldNetworkError` otherwise. Useful for deploy-time health
   * checks of the Bearer key + base URL.
   *
   * Goes against `/v1/_ping` — see `app/src/app/api/v1/_ping/route.ts`.
   */
  async ping(): Promise<true> {
    await this.http.request<unknown>({ method: 'GET', path: '/_ping' })
    return true
  }

  /**
   * GET `/v1/consent/verify` — single-identifier consent check.
   *
   * Behaviour table:
   * | Outcome | Default (failOpen=false) | Opt-in (failOpen=true) |
   * | --- | --- | --- |
   * | 200 | returns `VerifyEnvelope` | returns `VerifyEnvelope` |
   * | timeout / network / 5xx | throws `ConsentVerifyError` | returns `OpenFailureEnvelope` |
   * | 4xx (caller bug / scope / 422) | throws `ConsentShieldApiError` | throws `ConsentShieldApiError` |
   *
   * The 4xx-always-throws rule is non-negotiable per the v2 whitepaper
   * §5.4 — a failOpen flag must NEVER mask a real validation / scope
   * error. Use `isOpenFailure(result)` to ergonomically branch on the
   * `failOpen=true` return shape.
   *
   * @example
   * ```ts
   * const result = await client.verify({
   *   propertyId: 'PROP_UUID',
   *   dataPrincipalIdentifier: 'user@example.com',
   *   identifierType: 'email',
   *   purposeCode: 'marketing',
   * })
   * if (isOpenFailure(result)) {
   *   // failOpen=true mode — log the override to your audit trail.
   * } else if (result.status === 'granted') {
   *   // Proceed with the operation.
   * }
   * ```
   */
  verify(input: VerifyInput): Promise<VerifyEnvelope | OpenFailureEnvelope> {
    return verifyImpl(this.http, input, this.failOpen, this.onFailOpen)
  }

  /**
   * POST `/v1/consent/verify/batch` — multi-identifier consent check.
   *
   * Same behaviour table as `verify`. Client-side validation BEFORE any
   * network call: empty `identifiers` throws `RangeError` synchronously;
   * more than 10 000 entries throws `RangeError` synchronously
   * (mirrors the server's MAX_IDENTIFIERS cap; saves the round-trip);
   * non-string entries throw `TypeError`.
   *
   * Result `results` array preserves input order — every input
   * `identifiers[i]` corresponds to `result.results[i]`.
   */
  verifyBatch(
    input: VerifyBatchInput,
  ): Promise<VerifyBatchEnvelope | OpenFailureEnvelope> {
    return verifyBatchImpl(this.http, input, this.failOpen, this.onFailOpen)
  }

  // ─────────────────────────────────────────────────────────────────────
  // ADR-1006 Sprint 1.3 — record + revoke + artefact CRUD + events +
  // deletion + rights + audit. Failure modes are surfaced as
  // ConsentShieldApiError; these methods don't carry the verify-class
  // fail-closed/open contract.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * POST `/v1/consent/record` — record a fresh consent event + create
   * the per-purpose artefacts. `clientRequestId` is the idempotency key:
   * a replay with the same id within the org returns the same `event_id`
   * and `idempotent_replay: true`.
   */
  recordConsent(input: RecordConsentInput): Promise<RecordEnvelope> {
    return recordImpl(this.http, input)
  }

  /**
   * POST `/v1/consent/artefacts/{id}/revoke` — revoke a single artefact.
   * Idempotent: replaying on an already-revoked artefact returns
   * `idempotent_replay: true`. Throws `ConsentShieldApiError(409)` on a
   * terminal-state artefact (revoked + replaced + ...).
   */
  revokeArtefact(artefactId: string, input: RevokeArtefactInput): Promise<RevokeEnvelope> {
    return revokeImpl(this.http, artefactId, input)
  }

  /**
   * GET `/v1/consent/artefacts` — list artefacts matching the filter.
   * Server-defined cursor pagination; pass `next_cursor` from the
   * previous response into `cursor` to fetch the next page.
   */
  listArtefacts(input: ListArtefactsInput = {}): Promise<ArtefactListEnvelope> {
    return listArtefactsImpl(this.http, input)
  }

  /**
   * Async-iterator helper that walks every page of `listArtefacts` until
   * `next_cursor` is null. Use with `for await (const a of ...)`.
   */
  iterateArtefacts(input: ListArtefactsInput = {}): AsyncIterableIterator<ArtefactListItem> {
    return iterateArtefactsImpl(this.http, input)
  }

  /**
   * GET `/v1/consent/artefacts/{id}` — full artefact detail with
   * revocation + replacement chain. Returns `null` when no artefact
   * with that id belongs to the key's org.
   */
  getArtefact(
    artefactId: string,
    options: { traceId?: string; signal?: AbortSignal } = {},
  ): Promise<ArtefactDetail | null> {
    return getArtefactImpl(this.http, artefactId, options)
  }

  /** GET `/v1/consent/events` — list ingested consent events with cursor pagination. */
  listEvents(input: ListEventsInput = {}): Promise<EventListEnvelope> {
    return listEventsImpl(this.http, input)
  }

  /** Async-iterator helper for `listEvents`. */
  iterateEvents(input: ListEventsInput = {}): AsyncIterableIterator<EventListItem> {
    return iterateEventsImpl(this.http, input)
  }

  /**
   * POST `/v1/deletion/trigger` — request deletion of a data principal's
   * data scoped to the given purpose set / artefact set. `purposeCodes`
   * is REQUIRED when `reason === 'consent_revoked'`.
   */
  triggerDeletion(input: TriggerDeletionInput): Promise<DeletionTriggerEnvelope> {
    return triggerDeletionImpl(this.http, input)
  }

  /** GET `/v1/deletion/receipts` — list deletion-pipeline receipts. */
  listDeletionReceipts(input: ListDeletionReceiptsInput = {}): Promise<DeletionReceiptsEnvelope> {
    return listDeletionReceiptsImpl(this.http, input)
  }

  /** Async-iterator helper for `listDeletionReceipts`. */
  iterateDeletionReceipts(
    input: ListDeletionReceiptsInput = {},
  ): AsyncIterableIterator<DeletionReceiptRow> {
    return iterateDeletionReceiptsImpl(this.http, input)
  }

  /**
   * POST `/v1/rights/requests` — open a fresh DPDP §13 rights request.
   * Requires `identityVerifiedBy` — a free-form description of how the
   * caller verified the requestor's identity (server records this in
   * the audit trail; DPB-facing).
   */
  createRightsRequest(input: CreateRightsRequestInput): Promise<RightsRequestCreatedEnvelope> {
    return createRightsRequestImpl(this.http, input)
  }

  /** GET `/v1/rights/requests` — list rights requests with filter + cursor. */
  listRightsRequests(input: ListRightsRequestsInput = {}): Promise<RightsRequestListEnvelope> {
    return listRightsRequestsImpl(this.http, input)
  }

  /** Async-iterator helper for `listRightsRequests`. */
  iterateRightsRequests(
    input: ListRightsRequestsInput = {},
  ): AsyncIterableIterator<RightsRequestItem> {
    return iterateRightsRequestsImpl(this.http, input)
  }

  /**
   * GET `/v1/audit` — list org audit-log entries with optional event_type
   * + entity_type + date filters and cursor pagination.
   */
  listAuditLog(input: ListAuditLogInput = {}): Promise<AuditLogEnvelope> {
    return listAuditLogImpl(this.http, input)
  }

  /** Async-iterator helper for `listAuditLog`. */
  iterateAuditLog(input: ListAuditLogInput = {}): AsyncIterableIterator<AuditLogItem> {
    return iterateAuditLogImpl(this.http, input)
  }
}

/**
 * Default fail-open audit-trail callback. Production apps SHOULD override
 * `onFailOpen` with a sink that lands in their structured logger / Sentry
 * / a `/v1/audit` POST so the compliance override is captured deliberately.
 *
 * The default keeps this visible at the edges (stderr) so the override is
 * never silent — defaulting to `console.warn` rather than no-op is the
 * compliance-safe choice for SDKs.
 */
const defaultFailOpenCallback: FailOpenCallback = (envelope, ctx) => {
  // eslint-disable-next-line no-console
  console.warn('[@consentshield/node] fail-open verify override', {
    method: ctx.method,
    cause: envelope.cause,
    reason: envelope.reason,
    traceId: envelope.traceId,
  })
}
