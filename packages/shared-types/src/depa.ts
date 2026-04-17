// DEPA schema-derived types shared by the customer app (app/) and the
// operator app (admin/). Field names are snake_case to match Supabase
// client deserialisation (consistent with existing app convention in
// app/src/lib/rights/deletion-dispatch.ts).
//
// Sources: docs/architecture/consentshield-complete-schema-design.md §11.4
// and the corresponding migrations in supabase/migrations/20260418*.
//
// Only types consumed by BOTH apps live here. App-specific UI props stay
// in the owning app's src/types/ (feedback_share_narrowly_not_broadly).

// ═══════════════════════════════════════════════════════════
// Enum-style unions (column-level constraints documented in §11.4)
// ═══════════════════════════════════════════════════════════

export type ArtefactStatus = 'active' | 'revoked' | 'expired' | 'replaced'

export type Framework = 'dpdp' | 'abdm' | 'gdpr'

export type RevocationReason =
  | 'user_preference_change'
  | 'user_withdrawal'
  | 'business_withdrawal'
  | 'data_breach'
  | 'regulatory_instruction'

export type RevokedByType =
  | 'data_principal'
  | 'organisation'
  | 'system'
  | 'regulator'

// ═══════════════════════════════════════════════════════════
// purpose_definitions (§11.4.1) — canonical purpose library per org.
// ═══════════════════════════════════════════════════════════

export interface PurposeDefinition {
  id: string
  org_id: string
  purpose_code: string
  display_name: string
  description: string
  data_scope: string[]
  default_expiry_days: number
  auto_delete_on_expiry: boolean
  is_required: boolean
  framework: Framework
  abdm_hi_types: string[] | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ═══════════════════════════════════════════════════════════
// purpose_connector_mappings (§11.4.2)
// ═══════════════════════════════════════════════════════════

export interface PurposeConnectorMapping {
  id: string
  org_id: string
  purpose_definition_id: string
  connector_id: string
  data_categories: string[]
  created_at: string
}

// ═══════════════════════════════════════════════════════════
// consent_artefacts (§11.4.3) — the DEPA consent record.
// APPEND-ONLY from application code. Status transitions happen via
// triggers + Edge Functions only.
// ═══════════════════════════════════════════════════════════

export interface ConsentArtefact {
  id: string
  artefact_id: string                 // 'cs_art_' + 26-char ULID-ish
  org_id: string
  property_id: string
  banner_id: string
  banner_version: number
  consent_event_id: string
  session_fingerprint: string
  purpose_definition_id: string
  purpose_code: string
  data_scope: string[]                // SNAPSHOT at creation — categories, never values
  framework: Framework
  expires_at: string                  // ISO timestamp; mandatory per Rule 20
  status: ArtefactStatus
  replaced_by: string | null          // artefact_id of the replacement
  abdm_artefact_id: string | null
  abdm_hip_id: string | null
  abdm_hiu_id: string | null
  abdm_fhir_types: string[] | null    // FHIR resource type NAMES — never content
  created_at: string
}

// ═══════════════════════════════════════════════════════════
// artefact_revocations (§11.4.4) — immutable revocation log (Category B).
// INSERT triggers the in-DB cascade and (from ADR-0022) the out-of-DB
// cascade to deletion_requests fan-out.
// ═══════════════════════════════════════════════════════════

export interface ArtefactRevocation {
  id: string
  org_id: string
  artefact_id: string
  revoked_at: string
  reason: RevocationReason
  revoked_by_type: RevokedByType
  revoked_by_ref: string | null
  notes: string | null
  delivered_at: string | null         // buffer-pattern delivery tracking
  created_at: string
}

// ═══════════════════════════════════════════════════════════
// consent_expiry_queue (§11.4.5) — scheduled expiry management.
// Rows are retained as historical audit trail — NOT deleted after
// processing.
// ═══════════════════════════════════════════════════════════

export interface ConsentExpiryQueueEntry {
  id: string
  org_id: string
  artefact_id: string
  purpose_code: string
  expires_at: string
  notify_at: string                   // expires_at − 30 days
  notified_at: string | null          // null → alert not yet sent
  processed_at: string | null         // null → pending enforcement
  superseded: boolean                 // true if re-consented before expiry
  created_at: string
}

// ═══════════════════════════════════════════════════════════
// depa_compliance_metrics (§11.4.6) — cached score per org.
// Refreshed nightly by depa-score-refresh-nightly cron (ADR-0025).
// ═══════════════════════════════════════════════════════════

export interface DepaComplianceMetrics {
  id: string
  org_id: string
  total_score: number                 // numeric(4,1) 0–20
  coverage_score: number              // numeric(4,1) 0–5
  expiry_score: number                // numeric(4,1) 0–5
  freshness_score: number             // numeric(4,1) 0–5
  revocation_score: number            // numeric(4,1) 0–5
  computed_at: string                 // stale if > 25h old — surface in UI
  created_at: string
  updated_at: string
}

// Convenience: the return type of compute_depa_score(p_org_id) —
// matches the jsonb shape returned by the function (§11.2).
export interface DepaScoreResult {
  total: number
  coverage_score: number
  expiry_score: number
  freshness_score: number
  revocation_score: number
  computed_at: string
}
