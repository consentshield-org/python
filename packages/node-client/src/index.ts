// ADR-1006 Phase 1 — `@consentshield/node` public surface.
//
// Sprint 1.1 (THIS) ships: ConsentShieldClient + auth + transport +
// error hierarchy + ping. Per-endpoint methods (verify, verifyBatch,
// recordConsent, revokeArtefact, triggerDeletion, artefact CRUD,
// rights, audit) land in Sprint 1.2 / 1.3.

export { ConsentShieldClient, type ConsentShieldClientOptions } from './client'

export {
  ConsentShieldError,
  ConsentShieldApiError,
  ConsentShieldNetworkError,
  ConsentShieldTimeoutError,
  ConsentVerifyError,
  type ProblemJson,
} from './errors'

export type { FetchImpl, HttpRequest } from './http'

export {
  isOpenFailure,
  type FailOpenCallback,
  type VerifyInput,
  type VerifyBatchInput,
} from './verify'

export type { RecordConsentInput } from './record'
export type { RevokeActorType, RevokeArtefactInput } from './revoke'
export type { ListArtefactsInput } from './artefacts'
export type { ListEventsInput } from './events'
export type {
  DeletionActorType,
  ListDeletionReceiptsInput,
  TriggerDeletionInput,
} from './deletion'
export type { CreateRightsRequestInput, ListRightsRequestsInput } from './rights'
export type { ListAuditLogInput } from './audit'

export type {
  ArtefactDetail,
  ArtefactListEnvelope,
  ArtefactListItem,
  ArtefactRevocation,
  AuditLogEnvelope,
  AuditLogItem,
  DeletionReason,
  DeletionReceiptRow,
  DeletionReceiptsEnvelope,
  DeletionTriggerEnvelope,
  EventListEnvelope,
  EventListItem,
  IdentifierType,
  OpenFailureEnvelope,
  RecordEnvelope,
  RecordedArtefact,
  RevokeEnvelope,
  RightsCapturedVia,
  RightsRequestCreatedEnvelope,
  RightsRequestItem,
  RightsRequestListEnvelope,
  RightsRequestStatus,
  RightsRequestType,
  VerifyBatchEnvelope,
  VerifyBatchResultRow,
  VerifyEnvelope,
  VerifyStatus,
} from './types'
