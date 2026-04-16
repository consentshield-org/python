# Changelog — Dashboard

Next.js UI changes.

## ADR-0018 Sprint 1.1 — 2026-04-16

### Changed
- `src/app/(dashboard)/dashboard/integrations/integrations-table.tsx`:
  the "New Connector" form now surfaces a Type selector
  (Generic webhook / Mailchimp / HubSpot) with per-type conditional
  fields. Button label moved from "Add Webhook Connector" to
  "Add Connector".

## ADR-0017 Sprint 1.1 — 2026-04-16

### Added
- New page `src/app/(dashboard)/dashboard/exports/page.tsx` — lists
  past export manifests (pointer-only; no ZIP bytes stored) with an
  **Export ZIP** button that triggers `POST /api/orgs/[orgId]/audit-export`,
  downloads the archive in-browser, and reloads the manifest list.
- Companion client component `export-button.tsx` handles the
  fetch-to-blob-to-anchor download flow.

## ADR-0016 Sprint 1 — 2026-04-16

### Changed
- `src/app/(dashboard)/dashboard/enforcement/page.tsx`: new
  **Consent Probes** section listing every active probe with its
  schedule, last-run timestamp, and status (clean / N violations /
  failed). Reads `consent_probes` + `consent_probe_runs`; joins the
  latest run per probe. No CRUD UI in v1 — probes are seeded via
  SQL until a dedicated micro-ADR adds the form.

## ADR-0015 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0015 — Security Posture Scanner
**Sprint:** Phase 1, Sprint 1.1

### Changed
- `src/app/(dashboard)/dashboard/enforcement/page.tsx`: new
  **Security Posture** section. Queries `security_scans` alongside
  the existing tracker-observations queries; for every property
  shows the highest-severity finding from its most-recent scan with
  a colour-coded badge (critical / high / medium / low / info /
  unscanned). Lists total findings and the worst `signal_key` per
  property.

### Tested
- [x] `bun run build` + `bun run lint` + `bun run test` — clean.

## ADR-0013 Sprint 1.2 — 2026-04-15

### Changed
- `src/app/(public)/signup/page.tsx` — passwordless OTP flow. Two stages:
  (1) email + orgName + industry → `supabase.auth.signInWithOtp` with
  `shouldCreateUser: true` and `options.data`; (2) 6-digit code →
  `supabase.auth.verifyOtp({type: 'email'})` → `/auth/callback`.
- `src/app/(public)/login/page.tsx` — same two-stage OTP pattern
  (`shouldCreateUser: false`). Passwords removed from UI.

### Rationale
- Phishing / forwarding resistance, device continuity, no URL leakage, no
  email-scanner premature consumption. Full reasoning in ADR-0013.
- Consistent with ADR-0004 (rights-request OTP).

### Operator action
- In Supabase Dashboard → Authentication → Email Templates → Magic Link,
  replace the `{{ .ConfirmationURL }}` block with a prominent
  `{{ .Token }}` display so the email delivers the code only (no link
  fallback that scanners can prefetch).

## ADR-0013 Sprint 1.1 — 2026-04-15

### Changed
- `src/app/(public)/signup/page.tsx`:
  - Attaches `{ org_name, industry }` to `options.data` on
    `supabase.auth.signUp` so it survives the email-confirmation gap.
  - Sets `options.emailRedirectTo` to
    `<origin>/auth/callback` so Supabase sends the verification link
    back to our single handler.
  - New "Check your email" pending state shown when `signUp` returns no
    session (Supabase's "Confirm email" flag is ON). Otherwise navigates
    straight to `/auth/callback`.

### Tested
- [x] `bun run lint` / `build` / `test` — all green.
- Manual smoke test on live Vercel deploy after next push.
