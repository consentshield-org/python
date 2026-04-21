# ConsentShield — Comprehensive Review as of 2026-04-18

**Reviewer:** Sudhindra Anegondhi
**Date:** 2026-04-18
**Scope:** Definitive architecture documents, ADRs 0001–0050, per-area changelogs, and the full monorepo code base (app/, admin/, worker/, supabase/, packages/, tests/).
**Method:** Four parallel critical reads (architecture docs, recent ADRs 0044–0050, changelogs, code base) synthesised against CLAUDE.md non-negotiable rules and the ADR-index claimed status.

---

## Correction — 2026-04-19

Chunks 2 and 3 of ADR-0050 Sprint 2.1 had already landed on `main` (commits `1562f84` and `4c1bd9f`) before this review was drafted — the `git status` snapshot used during preparation was stale. The corrections below supersede the body of the review where they conflict; the body is preserved as originally written for audit trail.

- **Sprint 2.1 is complete, not half‑built.** Chunk 3 (commit `4c1bd9f`, 2026‑04‑18 21:27) landed `public.invoices` with trigger‑enforced immutability + `REVOKE DELETE` on every app‑code role, `billing.razorpay_webhook_events` verbatim store with signature‑verified anon‑callable RPCs (`rpc_razorpay_webhook_insert_verbatim` + `_stamp_processed`), `public.accounts` billing‑profile columns (populated on first invoice issuance), and the `app/src/app/api/webhooks/razorpay/route.ts` refactor. Tests: 10/10 invoice‑immutability, 6/6 razorpay‑verbatim, 194/194 full admin suite across 16 files, both apps build + lint clean. **Rule 19 now has teeth.**
- **Risk #2 below (ADR‑0050 chargeback‑defence half‑built) is closed.** Strike it from the ranked list.
- **Recommended move #1 below is superseded.** The issuer payload is committed (`1562f84`). The live critical path shifts to **ADR‑0050 Sprint 2.2** — PDF renderer + `admin.billing_issue_invoice` RPC + GST computation. Invoices now exist in the database but cannot yet be issued to customers; that is the next blocker.
- **Must‑fix items reduce from two to one.** Architecture‑doc drift against ADR‑0044 / 0050 (Risk #1) is now the single open priority. Overall health: **green with one must‑fix item.**

Verified against `git log` and the body of commit `4c1bd9f` on 2026‑04‑19.

---

## 1. Executive summary

The platform has reached a credible waterline. Fifty ADRs exist; 46 Completed, 2 In Progress (0046, 0050), 1 Abandoned (0035, folded into 0033), 1 design-only (0044 — implementation is distributed across 0047/0048). In the last ~10 days you shipped an entire admin console (13/13 panels), the DEPA artefact fan‑out pipeline, Rule 12 identity isolation, the Rule 5 service‑role carve‑out, customer RBAC (account → orgs → web_properties) with membership lifecycle, SDF Phase 1, Worker 403 observability, rate‑limit + Sentry ingestion, and the first half of the account‑aware billing rewrite (ADR‑0050 Sprint 1 + 2.1 chunks 1 & 2).

The code base is healthier than the ADR velocity suggests: zero `any` leaks in source, zero `TODO/FIXME`, no skipped tests, all scoped roles honoured, Worker still zero‑dep, RLS suite 243/243, Worker suite 20/20, billing‑issuer suite 21/21. Cross‑app guards (check‑no‑admin‑imports‑in‑app, check‑env‑isolation) run as prebuild hooks.

The single meaningful dissonance in the project right now is between the **definitive architecture document** and the **ADR‑0044 + ADR‑0050 world** it was locked before. The main body still teaches an org‑centric billing / tenancy model; the Appendix A backfill is aware but doesn't re‑teach. This is the largest documentation risk; the code is already past it.

## 2. Shipped state by surface

**Customer app (`app/`)** — Next 16.2.3 / React 19.2.5 / Supabase JS 2.103.0. `proxy.ts` enforces Rule 12 at the edge (admin JWT → 403 + redirect hint). RBAC gates via `lib/auth/require-org-role.ts` with account_owner inheritance. Signup is invitation‑only. DEPA customer UI (Purposes, Artefacts, Rights reshape, Dashboard tile) is live. Rights workflow + Turnstile + OTP + delivery pipeline all wired.

**Admin app (`admin/`)** — 13 operator panels shipped: accounts, admins, audit‑log, billing (landing + account detail + operations + issuers/), connectors, flags, orgs, pipeline, security (rate‑limit + Sentry + Worker 403s fed by real tables), signatures, support, templates. All admin API routes are under `api/admin/*`; Rule 5 carve‑out is correctly scoped — service role is only used for `auth.admin.*` calls, with the authoritative state transition happening in a `require_admin`‑gated SECURITY DEFINER RPC.

**Worker (`worker/`)** — Zero npm deps (only `@cloudflare/workers-types` dev). HMAC + Origin validation, IPv4 CIDR block list via KV, eight 403 log sites feeding `public.worker_errors`. 20/20 suite green.

**Supabase** — 20 migrations in range 2026‑04‑29 → 2026‑05‑07 (dev dates). Three scoped DB roles enforced; service role key appears only in tests and migrations, never in prod app code. Two hot‑fix migrations (20260507000005, 20260507000007) are intentional follow‑ups, each documented; no squashing debt yet.

**Edge Functions** — 10 active: check‑cron‑health, check‑stuck‑buffers, check‑stuck‑deletions, oauth‑token‑refresh, process‑consent‑event, process‑artefact‑revocation, run‑consent‑probes (deprecated, kept for rollback), run‑security‑scans, send‑sla‑reminders, sync‑admin‑config‑to‑kv. All use `CS_ORCHESTRATOR_ROLE_KEY`. Probes v2 (Vercel Sandbox) lives in a Next.js route, not Edge Function, per ADR‑0041.

**Packages** — Three, as specified: `shared-types`, `compliance`, `encryption`. No drift.

**Tests** — ~44 test files. RLS isolation (6), RBAC (6), DEPA (4), admin RPCs (14 including the new billing‑issuer suite), plus app/ and admin/ suites. No `.skip`, no `describe.skip`.

## 3. Architecture coherence

### 3.1 Where the definitive architecture leads the ADRs

§6.7 DEPA consent artefact fan‑out, §7.3 artefact lifecycle, §8.4 artefact‑scoped deletion, Rule 2 immediate‑delete replacement of the 48‑hour purge, Rule 3 structural zero‑persistence for regulated content — all of this is integrated, teaches correctly, and matches what 0020–0025 / 0037 shipped.

### 3.2 Where the ADRs lead the architecture (drift)

- **Accounts vs organisations (ADR‑0044).** The main body (§§1–15) still treats `organisations` as the billing/tenancy unit. Appendix A knows about `public.accounts`, but §3 Category A list, §4 processing modes, §5 isolation / `current_org_id()` and §10 API surface are all organisation‑first. New readers will build the wrong mental model.
- **Plans as first‑class (ADR‑0044 + ADR‑0050).** `public.plans` with `max_organisations` / `max_web_properties_per_org` is not in §4 or §10.3; the architecture still speaks of `plan` as a string column on organisations.
- **Invitation‑only signup (ADR‑0044).** §10.1 still describes `/signup` as walk‑up; there is no mention of `/signup?invite=<token>` or the marketing `/api/internal/invites` HMAC path.
- **Invoice immutability (Rule 19, ADR‑0050).** CLAUDE.md has Rule 19 (correct). The architecture document does not yet reflect it — there is no §11 entry for issuer‑entity immutability, no mention of verbatim `billing.razorpay_webhook_events`, no section on the two‑tier visibility (platform_owner all‑time vs platform_operator current‑active).
- **Platform_owner tier.** ADR‑0050 Sprint 2.1 chunk 1 introduces `admin_role > platform_owner > platform_operator > support > read_only`. The admin‑platform document still reads as a single‑tier operator model.
- **Worker suspension behaviour.** Admin‑platform doc says a suspended account's banner becomes a no‑op via KV sync; the definitive‑architecture Worker section doesn't reference `organisations.status` → suspended_org_ids.

### 3.3 Subtle but worth noting

- **`consent_artefacts` is Category A (operational) but delivered to customer storage.** §7.3 handles this correctly by staging via `delivery_buffer`, but the live‑state vs exported‑state asymmetry (ConsentShield's artefact table is ahead of the customer's last export) is not flagged to auditors. The mitigation is Principle 2 ("audits must use customer storage"), but it is not tight about *artefact lifecycle* audits specifically.
- **Admin testing priorities are absent from `consentshield-testing-strategy.md`.** Priorities 21–25 (AAL2, audit‑log immutability, impersonation timeout + customer notification) are assumed to be covered ADR‑by‑ADR. A consolidated admin priority would close the loop.

## 4. ADR execution quality

- **ADR‑0044 (Customer RBAC)** — Listed Completed. In practice the ADR is a **design blueprint**; shipped implementation is distributed across ADR‑0047 (membership lifecycle + invariant), ADR‑0048 (accounts admin view), and the Phase 0 schema work consumed by 0050. Index is not lying, but a first‑time reader would be misled. Suggest re‑titling its status or adding a "realised across ADR‑0044 / 0047 / 0048" note in the index.
- **ADR‑0046 (SDF)** — Accurately marked In Progress. Phase 1 fully shipped (schema + RPC + admin card + customer card, 7/7 tests). Phases 2–4 remain charter‑only (DPIA records, auditor engagements, audit‑export ZIP extension).
- **ADR‑0050 (Account‑aware billing)** — Accurately marked In Progress. Sprint 1 and Sprint 2.1 chunks 1 + 2 shipped (platform_owner tier 7/7; billing_account_summary 3/3; issuer entities 21/21). **Remaining in Sprint 2.1:** `public.accounts` billing‑profile columns, `public.invoices` schema + immutability triggers, `billing.razorpay_webhook_events` verbatim store, webhook handler refactor. Sprints 2.2 (PDF render + issuance), 2.3 (invoice history + reconciliation), 3.1 (GST statement + export manifest), 3.2 (dispute workspace) are planned but untouched.
- **ADR‑0045 / 0047 / 0048 / 0049** — Genuinely Completed with tests passing and changelog coverage across schema / api / dashboard / docs as Rule ("no merge without a changelog") requires.

## 5. Uncommitted work on the branch

Four dirty paths from `git status` — all coherent and ready for a single commit:

- `admin/src/app/(operator)/billing/issuers/` — list + new + `[issuerId]` pages, `actions.ts` server actions. Owner‑gated "+ New issuer" button via `canOperate()` / platform_owner check.
- `supabase/migrations/20260507000006_billing_issuer_entities.sql` (565 LOC) — table + 6 RPCs (create, list, detail, update, activate, retire, hard_delete) with identity‑field immutability + single‑active invariant.
- `supabase/migrations/20260507000007_billing_issuer_update_op_fix.sql` (92 LOC) — PL/pgSQL operator‑precedence fix on the mutable‑field guard (`v_key <> all(v_mutable)` ambiguity).
- `tests/admin/billing-issuer-rpcs.test.ts` (358 LOC) — 21/21 PASS; covers role gating, immutable vs mutable patch behaviour, single‑active flip, retire blocks reactivation, hard_delete owner‑gated.

No `XXX` or half‑finished regions. The only caveat is that chunk 3 (invoices + webhook verbatim store) is not in this commit — the issuer panel currently stands alone without invoices to bind to, which is acceptable as an intermediate landing but shouldn't linger.

## 6. Risks and gaps, ranked

1. **Definitive‑architecture drift against ADR‑0044 / 0050.** Biggest single liability. Fix is a documentation pass — amend §3 Category A, §4 processing modes, §5 isolation, §10 API surface, §11 rules (Rule 19), plus a fresh "Amended: 2026‑04‑18" header.
2. **ADR‑0050 chargeback‑defence half‑built.** Without `public.invoices` immutability, `billing.razorpay_webhook_events` verbatim store, and the webhook handler refactor, Rule 19 is a policy without teeth. Finishing Sprint 2.1 is the critical‑path deliverable before anything else in the billing track.
3. **ADR‑0044 status in the index is misleading.** Either annotate "design — implementation distributed across 0047 / 0048 / 0050 phase 0" or mark the unshipped phases of its own checklist as deferred. Current presentation fails the truthiness test a cold reader would apply.
4. **Admin testing priority missing from testing‑strategy.** No explicit suite listed for AAL2 enforcement, audit‑log immutability under concurrent writes, impersonation time‑box + customer notification. Each ADR has pointwise tests, but there is no consolidated priority the way Priority 1 / 2 / 10 guard customer paths.
5. **DEPA artefact "live vs exported" asymmetry not flagged to auditors.** Low severity, but a half‑sentence in §7.3 / §11 telling auditors that artefact *lifecycle* audits MUST read the customer's R2 export rather than ConsentShield's working set would harden the position materially.
6. **Hot‑fix migration pair (0005 + 0007).** Intentional and documented, but sets a precedent; if frequency grows, squash before first paying customer.
7. **Infra deferrals recorded but not closed.** Second hardware‑key enrolment for AAL2, Vercel Ignored Build Step wiring on both projects, Cloudflare Access on admin domain, Sentry project `consentshield-admin`, and CF_API_TOKEN / CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID secrets for `sync-admin-config-to-kv` non‑dry‑run are all owner actions still pending.
8. **Rule 21 (hardware‑key AAL2) is design‑enforced but not runtime‑enforced in dev.** `ADMIN_HARDWARE_KEY_ENFORCED` flip is pending. Acceptable because the project is dev‑only, but track it so it doesn't slip past first admin invite of a real operator.

## 7. Recommended next three moves

1. **Commit the issuer‑entity payload**, then immediately open ADR‑0050 Sprint 2.1 chunk 3: `public.invoices` + immutability trigger + `REVOKE DELETE` on every app role + `billing.razorpay_webhook_events` verbatim store + webhook handler refactor. This is the closure of Rule 19 and the only ADR on the critical path.
2. **Architecture doc pass — ADR‑0044 + ADR‑0050 backfill.** Amend §3/§4/§5/§10/§11 so that a new reader builds the accounts → orgs → web_properties mental model rather than the org‑first one. Stamp a fresh amendment date. Cross‑reference Rule 19.
3. **After ADR‑0050 Sprint 2.2 (PDF + issuance) lands**, open ADR‑0051 (evidence ledger capture points). It is a prerequisite for 0052 (dispute auto‑submission) and is what makes the dispute workspace in 3.2 worth building.

Overall health: **green with two must‑fix items** — architecture documentation drift, and completing ADR‑0050 Sprint 2.1. Everything else is well‑tended.
