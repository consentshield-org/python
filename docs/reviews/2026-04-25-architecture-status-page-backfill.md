# Architecture-doc backfill — Status page (ADR-1018 Phase 1 + Phase 2)

**Date:** 2026-04-25
**Reviewer:** Sudhindra Anegondhi
**Scope:** `docs/architecture/consentshield-definitive-architecture.md` + `docs/architecture/consentshield-complete-schema-design.md`. ADR-1018's Architecture Changes section had committed both updates and they were never delivered; this review records the catch-up and the same-time addition of Phase 2 (Better Stack) coverage so the architecture doc leads rather than trails.

## Why this review exists

CLAUDE.md's "Reviews" rule:
> Every review must be documented in `docs/reviews/` with a dated markdown file. … No architecture doc is promoted to source of truth without a documented review.

ADR-1018 (Phase 1, Completed 2026-04-23) listed under its Architecture Changes block:

> - `docs/architecture/consentshield-definitive-architecture.md` — new subsection under Surface 5 (Operator Console) describing the status-page schema + admin vs public split.
> - `docs/architecture/consentshield-complete-schema-design.md` — add the three `status_*` tables with column descriptions.

Neither was applied at ship time. The marketing-claims review on 2026-04-25 (Issue 18) re-examined the public claims at `/docs/status` and triggered the Phase 2 supersession recorded in ADR-1018. The user-direction during that review was that the architecture doc should *lead* implementation rather than trail it; this backfill catches up the trailing Phase 1 + adds Phase 2 coverage in one pass.

## Documents reviewed

- `docs/architecture/consentshield-definitive-architecture.md` (`@HEAD~`).
- `docs/architecture/consentshield-complete-schema-design.md` (`@HEAD~`).
- ADR-1018 (`docs/ADRs/ADR-1018-self-hosted-status-page.md`) — both Phase 1 sprints and the Phase 2 plan added 2026-04-25.
- Migrations referenced: `20260804000013_status_page.sql`, `20260804000015_status_probes_cron.sql`, `20260804000019_audit_log_column_fix.sql`.
- Edge Function source: `supabase/functions/run-status-probes/index.ts`, `supabase/functions/health/index.ts`.
- Customer-app surface: `app/src/app/(public)/status/page.tsx`, `app/src/app/api/health/route.ts`.
- Admin surface: `admin/src/app/(operator)/status/`.

## Findings

### Phase 1 (already-shipped) backfill

- **Definitive architecture** — Appendix A's panel table omitted the `Status Page (operator)` row at `/admin/(operator)/status` even though Sprint 1.2 added the panel. **Backfilled** with the row pointing at `public.status_subsystems` + `status_checks` + `status_incidents` + the four admin RPCs.
- **Definitive architecture** — no top-level subsection covered the public status surface at all. **Backfilled** as a new **Appendix E — Public status surface (`status.consentshield.in`)**, split into Phase 1 (self-hosted, shipped) and Phase 2 (Better Stack, proposed). Appendix E sits after Appendix D so the alphabetical order is preserved.
- **Schema design** — the three `public.status_*` tables had no entry in §3 (Tables) or §11 (DEPA additions) or §12 (Post-DEPA Amendments). Adding them under §12 would have been a misclassification (§12 is scoped to ADRs 0033–0049). **Backfilled** as a new **§13 — Status page schema (ADR-1018, April 2026)** with five subsections: 13.1 `status_subsystems` schema + RLS + grants; 13.2 `status_checks` (append-only probe results); 13.3 `status_incidents` (lifecycle + indexes); 13.4 the four admin SECURITY DEFINER RPCs; 13.5 the probe-loop Edge Function + pg_cron schedules.

### Phase 2 (proposed) coverage

- **Definitive architecture** — Appendix E's Phase 2 subsection describes the Better Stack vendor pivot: account ownership (`info@consentshield.in`); 7-monitor matrix mirroring the marketing wireframe at `marketing/src/app/docs/status/page.mdx`; vendor-hosted page with custom domain + ConsentShield branding; subscriber notifications via email + RSS + webhook; sev1 / sev2 / sev3 incident severity matrix; DNS cutover plan; `BETTERSTACK_API_TOKEN` env-var location; the **Free, $0/mo** founder-direction interim with launch-time upgrade trigger.
- **Schema design** — explicit note in §13 preamble: *"The schema does **not** change in Phase 2; the tables continue to capture pg_cron probe results + admin-posted incidents for the in-perimeter triage view."* No table changes; Phase 2 is a public-surface vendor pivot, not a schema migration.

### Findings classification

- **Blocking:** none.
- **Should-fix:** none beyond the backfill itself.
- **Cosmetic:** none.

## Fixes applied

Three docs touched, all under one commit:
- `docs/architecture/consentshield-definitive-architecture.md` — Appendix A row + new Appendix E.
- `docs/architecture/consentshield-complete-schema-design.md` — new §13.
- `docs/reviews/2026-04-25-architecture-status-page-backfill.md` — this file.

ADR-1018 is unchanged; its Architecture Changes block remains accurate now that the backfill closes the deliverables it promised.

## Verification

- `grep -n "^## Appendix" docs/architecture/consentshield-definitive-architecture.md` → ordered A → B → C → D → E.
- `grep -n "Status Page (operator)" docs/architecture/consentshield-definitive-architecture.md` → matches in Appendix A panel table.
- `grep -n "## 13\." docs/architecture/consentshield-complete-schema-design.md` → §13 + 13.1–13.5 subsections present.
- ADR-1018's two Architecture Changes bullets cross-checked against the doc updates: both delivered.
- ADR-1018's marketing-claims-review Issue 18 cross-link present in Appendix E so a future reader can trace the Phase 2 supersession decision.

## Outcome

**Approved as source of truth.** The two architecture docs now describe what's shipped (Phase 1 self-hosted internal-readout) **and** what's planned (Phase 2 Better Stack public surface with launch-time upgrade trigger). Going forward, Sprint 2.7 (Phase 1 disposition) will further trim the architecture doc when the host-based redirect in `app/src/app/page.tsx` retires; that's a Sprint 2.7 deliverable, not a follow-up review.

Architecture doc now leads ADR-1018 Phase 2 implementation: Sprints 2.2 → 2.8 build against the Phase-2 description in Appendix E rather than producing it after the fact. Per the user-direction recorded during this backfill — *"ideally arch. doc must lead. in this case its trailing which is not good."*
