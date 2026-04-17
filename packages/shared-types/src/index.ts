// @consentshield/shared-types — schema-derived types shared by the
// customer app (app/) and the operator app (admin/).
//
// Only types consumed by BOTH apps belong here. App-specific UI prop
// types and React component prop types stay in the owning app
// (app/src/types/ or admin/src/types/) per feedback_share_narrowly_not_broadly.
//
// Populated by:
//   - ADR-0020 (DEPA schema skeleton): ./depa — purpose_definitions,
//     purpose_connector_mappings, consent_artefacts, artefact_revocations,
//     consent_expiry_queue, depa_compliance_metrics
//   - ADR-0027 (admin schema): TBD — admin user profile, audit log entry,
//     impersonation session summary

export * from './depa'
