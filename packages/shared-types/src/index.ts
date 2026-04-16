// @consentshield/shared-types — schema-derived types shared by the
// customer app (app/) and the operator app (admin/).
//
// Populated by subsequent ADRs as schema-derived types are introduced:
//   - ADR-0020 (DEPA schema skeleton): consent artefact, purpose
//     definition, purpose-connector mapping, revocation
//   - ADR-0027 (admin schema): admin user profile, audit log entry,
//     impersonation session summary
//
// App-specific UI prop types and React component prop types stay in the
// app that owns them (app/src/types/ or admin/src/types/). Only types
// that BOTH apps consume belong here.

export {}
