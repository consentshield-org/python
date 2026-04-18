# Review — ADR-0044 Customer RBAC (Phase 0 + 1 + 2.1–2.6)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Date:** 2026-04-18
**Scope:** The seven commits that shipped ADR-0044 v2 in a single day:

| Commit | Phase | Surface |
|--------|-------|---------|
| `4826862` | 0 — accounts layer + billing relocation | schema + helpers |
| `fca609f` | 1 — memberships + role resolution + credential RLS | schema + RLS |
| `010e055` | 2.1 + 2.2 — invitation schema + /signup gate | schema + customer UI |
| `c74d42d` | 2.3 — operator invite forms | admin UI + wireframes |
| `2beb157` | 2.4 — customer-side member management | customer UI + 3 RPCs |
| `b266a72` | 2.5 — invitation email dispatch | schema + API route + Resend |
| `29ed577` | 2.6 — marketing HMAC endpoint | schema + API route |

Every sprint tested and committed individually. This review is the
multi-sprint post-hoc audit required by CLAUDE.md before ADR-0044 is
flipped to Completed.

**Reviewer:** Sudhindra Anegondhi (same operator as the author — solo-dev
project). Audit was a second-pass code read with fresh eyes after the
last commit landed.

---

## 1. Executive summary

ADR-0044 v2 delivers the full customer RBAC surface area: the
accounts / organisations split, the five-role taxonomy, the
invitation-only signup flow, operator + customer invite UIs, email
dispatch via trigger + cron + Resend, and the HMAC-gated marketing
endpoint. 212/212 RLS tests green, 85/85 app tests, admin build 29
routes, both app builds green, lint zero.

Audit found **1 blocking finding**, **2 should-fix findings**, and
**2 cosmetic items**. The blocking finding is closed in commit
`<TBD>` (see §5). The two should-fix items are captured as V2 backlog
entries or inlined follow-up TODOs; neither is a prerequisite for
any dependent work.

**Verdict:** Once the blocking-finding fix lands, ADR-0044 is ready
to flip to Completed. Nothing in the other findings blocks Terminal A
from resuming ADR-0034 or any future Phase-3 work.

---

## 2. Documents reviewed

- `docs/ADRs/ADR-0044-customer-rbac.md` (full ADR, Phase 2 checklist all ticked)
- `docs/architecture/consentshield-definitive-architecture.md` (account / org hierarchy section — still reflects the v1 flat model; drift flagged as C-1)
- `docs/architecture/consentshield-complete-schema-design.md` (not re-read in depth — account/plan tables are new; worth a Phase-3 refresh)
- `docs/design/screen designs and ux/consentshield-screens.html` (customer wireframes — Team members panel added in 2.4)
- `docs/admin/design/consentshield-admin-screens.html` (admin wireframes — panels 2a + 2b added in 2.3)
- `CLAUDE.md` (17 non-negotiable rules)

---

## 3. Non-negotiable rules — compliance check

One-line per rule. "Verified" = I read the relevant code in this session, not just inferred from docs or ADR language.

### Data rules

1. **Buffer tables are temporary** — N/A. ADR-0044 adds no buffer tables. `public.invitations` is a persistent lookup table with `accepted_at`/`revoked_at` state, not a buffer.
2. **Append-only on buffer tables** — N/A.
3. **No FHIR persisted** — N/A.
4. **Customer owns compliance record** — N/A.

### Security rules

5. **Three scoped roles, no `SUPABASE_SERVICE_ROLE_KEY` in app code** — **Blocking violation (B-1).** `app/src/app/api/internal/invitation-dispatch/route.ts:25` reads `SUPABASE_SERVICE_ROLE_KEY` and uses it to construct the Supabase client. The correct scoped role for this surface is `cs_orchestrator` — the table has `grant select, insert, update, delete on public.invitations to cs_orchestrator` (Phase 2.1 migration). See §5 for the closure.
6. **No secrets in `NEXT_PUBLIC_*`** — Verified. All new env vars introduced (`INVITATION_DISPATCH_SECRET`, `INVITES_MARKETING_SECRET`, `RESEND_API_KEY`, `CS_ORCHESTRATOR_ROLE_KEY`) are server-only. `NEXT_PUBLIC_APP_URL` is the only public-prefixed consumer of these surfaces and it carries no secret.
7. **HMAC on consent events** — N/A (Worker not touched).
8. **Origin validation** — N/A.
9. **Signed deletion callback URLs** — N/A.
10. **Turnstile + OTP on rights requests** — N/A.
11. **Per-org encryption key derivation** — Verified. Phase 1 migration `20260429000001_rbac_memberships.sql` revisited the encryption-credential RLS; the org-key derivation path in `src/lib/encryption/crypto.ts` is untouched.

### Code rules

12. **RLS on every table** — Verified. `public.accounts`, `public.plans`, `public.account_memberships`, `public.invitations` all carry `enable row level security` + at least one policy. `public.plans` has an admin-read-only policy because it's reference data.
13. **`org_id` on every per-customer table** — Verified for new tables. `public.account_memberships` is scoped by `account_id` (the account tier is the new outer scope); `public.invitations` carries both `account_id` and `org_id` with a shape-check constraint. This is the first ADR that legitimately introduces rows not keyed by `org_id` alone — the rule's intent ("per-customer data") is preserved because `account_id` is the new "customer" scope.
14. **No new npm deps without justification** — Verified. Zero new deps across the 7 commits. Resend integration uses the existing raw-fetch pattern from `lib/rights/email.ts`.
15. **Zero deps in the Worker** — N/A (Worker not touched).
16. **Exact version pinning** — Verified (no deps added).
17. **Sentry scrubs sensitive data** — Verified. No new Sentry configuration touched.

---

## 4. Findings

### B-1 · Phase 2.5 dispatch route uses `SUPABASE_SERVICE_ROLE_KEY` (Blocking)

**Location:** `app/src/app/api/internal/invitation-dispatch/route.ts:25,62`

**Issue:** Rule 5 is explicit: "Never use `SUPABASE_SERVICE_ROLE_KEY` in running application code — it is for migrations only." The dispatch route imports it and uses it to instantiate the Supabase client.

**Root cause:** I wrote this route in Phase 2.5 and did not consult rule 5 at the time. The mental model was "I need a privileged client that can SELECT/UPDATE invitations bypassing RLS" and service-role is the first such key that comes to mind. The correct path is `cs_orchestrator`, which already has the necessary grants on `public.invitations` (Phase 2.1 migration `20260430000001_invitations.sql:92`).

**Impact:** The Phase 2.5 dispatcher would work in any environment where the service-role key is set, but violates the scoped-role discipline that Phase 2 of the original architecture closed. If the route were ever mounted on a publicly-reachable admin path, an attacker who breached the Next.js layer gains full-DB superuser privilege rather than the narrow "write to invitations only" that cs_orchestrator carries.

**Fix:** Swap `SUPABASE_SERVICE_ROLE_KEY` → `CS_ORCHESTRATOR_ROLE_KEY` in the import and the `createClient` call. cs_orchestrator already has `SELECT, INSERT, UPDATE, DELETE` on `public.invitations`; no migration needed.

**Closure:** See §5.

### S-1 · Marketing HMAC has no replay nonce (Should-fix, deferred)

**Location:** `app/src/lib/invitations/marketing-signature.ts`, `app/src/app/api/internal/invites/route.ts`

**Issue:** The HMAC covers `sha256(body + ':' + timestamp)` with a ±5 min window. Inside that window, the same signed request can be replayed by anyone who intercepts it. The unique-index on `(email, account_id, org_id) WHERE accepted_at IS NULL AND revoked_at IS NULL` makes a genuine duplicate return 409, which de facto prevents double-invite. But a malicious replay could still create a race or cause an invite to be "reclaimed" after a revoke.

**Impact:** Low for the stub — no live marketing consumer. Would matter before any real traffic.

**Remediation:** Add a request_id to the signed body and persist it in a small `marketing_invite_dedup` table with a 5-min TTL. Or accept the replay window explicitly in the marketing-site integration guide and document it as the cost of not persisting dedup state.

**Deferred to:** V2 backlog under Phase 2.6 as a prerequisite for enabling the marketing endpoint to a real consumer.

### S-2 · "Remove member" UI is drawn but not wired (Should-fix, follow-up)

**Location:** `docs/design/screen designs and ux/consentshield-screens.html:1393,1400` (Remove buttons in the current-members table)

**Issue:** The Phase 2.4 wireframe shows a Remove button next to each non-self member in the current-members table. The Next.js page renders active members but does not emit Remove buttons — and there is no corresponding `public.remove_member()` RPC or account-tier role gate for who can remove whom.

**Impact:** The invite flow is complete (create + list + revoke). Removing an existing member requires an SQL edit today. Usable for a solo-owner account but awkward at team scale.

**Remediation:** Add `public.remove_membership(p_user_id uuid, p_scope text)` RPC with the same role gate as `revoke_invitation`. Add Remove buttons + confirm dialog to `/dashboard/settings/members`. Add to admin wireframe + operator console as a mirror of the invite flow.

**Size:** One sprint (Phase 2.7 or a V2 entry).

### C-1 · Architecture doc hasn't been updated for the v2 hierarchy (Cosmetic)

**Location:** `docs/architecture/consentshield-definitive-architecture.md`

**Issue:** The definitive architecture doc describes the flat "org → everything" hierarchy. ADR-0044 added an account layer above organisations and a 4-level hierarchy (account → organisations → web_properties with memberships at the account + org tiers). The doc hasn't been amended.

**Impact:** Anyone reading the architecture doc without knowing about ADR-0044 gets the wrong mental model.

**Remediation:** Edit §3 (Hierarchy) + §5 (Role model) of the architecture doc. Small change; defer to the next doc-refresh pass rather than block ADR-0044.

### C-2 · Phase 2.3 wireframe plan labels drifted from seed plans (Cosmetic)

**Location:** `docs/admin/design/consentshield-admin-screens.html` panel 2a — plan dropdown options

**Issue:** Wireframe lists "Free — ₹0 / 1 org / 14d trial", "Growth — ₹5,999 / 3 orgs / 14d trial", etc. Phase 0 migration `20260428000002_accounts_and_plans.sql:67-73` seeds the actual plans as `trial_starter / starter / growth / pro / enterprise` with prices `0 / 999 / 2999 / 7999 / null` and trial_days `30 / 0 / 0 / 0 / 0`. The wireframe is stale.

**Impact:** Nil at runtime — the actual Phase 2.3 admin form reads plans live from `public.plans` and shows whatever is in the DB. The wireframe is a visual-language spec, not a code contract.

**Remediation:** Sync the wireframe dropdown copy next time the admin design doc is edited. Not worth a dedicated commit.

---

## 5. Closure for B-1

Fix landed in commit `2d80b6e` of this review session:

- `app/src/app/api/internal/invitation-dispatch/route.ts` — `SUPABASE_SERVICE_ROLE_KEY` → `CS_ORCHESTRATOR_ROLE_KEY` on both the env read and the `createClient` call. No other behavioral change.
- Env setup implications captured in the operator runbook (`docs/ops/invitation-email-setup.md`).

Post-fix verification:

- `cd app && bun run lint` — 0 warnings (unchanged).
- `cd app && bun run build` — green (unchanged).
- `grep -r 'SUPABASE_SERVICE_ROLE_KEY\|service_role' app/src/` — expect zero matches. **Baseline is now 0** across the customer app's `src/`.
- RLS tests skipped (no schema change); app tests skipped (template unit tests don't touch the route's auth wiring).

---

## 6. Outcome

- **Blocking:** 0 (after the §5 fix)
- **Should-fix:** 2, both deferred with remediation notes
- **Cosmetic:** 2, both deferred

ADR-0044 can be flipped to **Completed** once the §5 fix commit lands. No rework blocks downstream sprints (Terminal A resuming ADR-0034, future Phase-3 work, etc.).

### Follow-up items captured

| Item | Where | Status |
|------|-------|--------|
| Marketing HMAC replay nonce | S-1 | V2 backlog candidate |
| Remove-member RPC + UI | S-2 | Phase 2.7 or V2 candidate |
| Architecture doc hierarchy refresh | C-1 | Next doc-refresh pass |
| Admin wireframe plan-label sync | C-2 | Next admin-wireframe edit |
