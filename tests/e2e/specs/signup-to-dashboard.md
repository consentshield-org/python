# E2E-1.5-signup-to-dashboard: signup-intake → onboarding wizard entry gate

**ADR:** ADR-1014 (Sprint 1.5 — First end-to-end smoke)
**Sprint:** Phase 1, Sprint 1.5
**Companion positive (RPC-layer):** `tests/integration/signup-intake.test.ts` — ADR-1014 Sprint 3.1 covers the `create_signup_intake` RPC's 6 branches at the Vitest layer.
**This spec:** the browser-layer companion. Proves the invitation `token` the RPC returns actually lands a visitor on a working wizard + that an expired token is rejected at wizard boot.
**Category:** @pipeline @browser @onboarding

---

## 1. Intent

Close the wizard-entry gate — the boundary between "I have a valid invitation link in my inbox" and "my session is live on the onboarding wizard". This is the last hop Sprint 3.1's RPC test doesn't observe: that the token the RPC persists into `invitations.token` actually renders a usable wizard at `/onboarding?token=<X>` when it's fresh, and bounces with the correct recovery surface when it's expired.

Regressing the positive means the wizard stopped recognising tokens the signup-intake is handing out — every new customer would see a confusing "invalid link" screen immediately after receiving a valid email. Regressing the negative means the wizard started accepting expired tokens — security-relevant (expired links can reach an attacker's inbox via forwarded mail, and re-opening them should never pass).

## 2. Setup

- `APP_URL` reachable (either `cd app && bun run dev` locally on 3000 or a deployed URL like `app.consentshield.in`).
- `SUPABASE_SERVICE_ROLE_KEY` set for seed + cleanup via `tests/e2e/utils/supabase-admin.ts`.
- The existing `tests/e2e/utils/fixtures.ts` `env` fixture supplies `APP_URL` via `.env.e2e`.

The test skips cleanly if `APP_URL` isn't set — same pattern as every other browser-driven Playwright spec in this tree.

## 3. Invariants

- Every seeded `invitations` row is deleted in the per-test `finally` block, regardless of test outcome. Neither test leaves state visible to another run.
- Each test uses its own unique email + token. Parallel execution across projects (chromium / webkit / firefox-nightly) cannot see each other's seeds because the email is the join key and it's randomised.
- The negative test ALWAYS seeds via the RPC first, then force-expires via service-role UPDATE. The RPC's 14-day default cannot be overridden at call time; the force-expire is the only way to seed an expired row without waiting 14 days.
- **The expired-token response is a 200-rendered HTML page with `InvalidShell(reason='expired')`, NOT an HTTP 410.** Sprint 1.5's original ADR spec wording said "410 Gone at wizard boot"; the actual Next.js implementation renders a 200 with an explanatory shell + resend form. The test asserts the shell-body content, not an HTTP status code. Documented here so a future reader doesn't chase the "why isn't this 410" rabbit-hole.

## 4. Expected proofs

### Sub-test A — valid fresh token

1. `create_signup_intake('s15-valid-…', 'starter', 'Sprint 1.5 Valid Fixture', null)` → `{branch:'created', id, token}`. Token is 48-hex chars (Sprint 3.1's existing assertion).
2. `page.goto(APP_URL + '/onboarding?token=' + token)` → page loads (200).
3. The "expired" body copy (`This invitation link has expired`) is NOT visible. The expired-body text check is the explicit negative guard — if the wizard accidentally routed to InvalidShell, this would catch it.
4. The wizard's Step-1 indicator (`[aria-current="step"]`) is visible. Step 1 is the OTP-verify step; the indicator being present is the load-bearing positive signal that the wizard actually booted.

### Sub-test B — expired token

1. Same RPC call + a service-role UPDATE pushing `expires_at` 1 hour into the past.
2. `page.goto(APP_URL + '/onboarding?token=' + token)` → page loads (200).
3. The expired body copy renders verbatim (`This invitation link has expired`, matches `app/src/app/(public)/onboarding/page.tsx:132`).
4. No wizard step indicator renders (`[aria-current="step"]` locator count = 0).
5. The resend-link form renders — visitor has a recovery path + can receive a new link without reaching an operator.

## 5. Pair-with-negative

This file IS the pair. Sub-test A is the positive; Sub-test B is the negative. Both scope by unique email → unique token, so parallel execution across projects can't cross-observe.

Complementary coverage lives at a different layer:
- `tests/integration/signup-intake.test.ts` (Sprint 3.1) — the 6 RPC branches (`created`, `already_invited`, `existing_customer`, `admin_identity`, `invalid_email`, `invalid_plan`) + case-insensitive email dedupe.
- Page-handler level: onboarding `page.tsx` itself is the code that renders the shell; this spec verifies its output.

## 6. Why this spec is not a fake positive

Three independent surfaces are asserted per sub-test:

1. **The RPC** — happy path asserts the RPC returned `branch=created` + a 48-hex token. A regression in the RPC's token generation would fail before Playwright navigates.
2. **The page handler** — page renders either the wizard shell OR the InvalidShell based on a `Date` comparison against `expires_at`. The sub-tests exercise both branches of that comparison.
3. **The DOM** — we assert specific elements / text that only the correct shell renders. A bug where `page.tsx` routed to the WRONG shell on valid-token input would fail at this layer.

Additionally, the negative test's explicit force-expire step via service-role UPDATE proves the path through `if (new Date(row.expires_at) <= new Date())` at `onboarding/page.tsx:75`. A regression that removed this date check would flip the negative test from InvalidShell to wizard-shell, failing the assertion.

## 7. Evidence outputs

- `trace-id.txt` — per test, via the shared fixture.
- `signup-to-dashboard-positive-url.txt` — captures the URL Playwright navigated to (includes the seeded token).
- `signup-to-dashboard-negative-url.txt` — same for the negative.
- Playwright trace on failure (captures DOM + network).

## 8. Deferred — full 7-step wizard completion

Sprint 1.5's original ADR wording asked for `marketing signup → email OTP → wizard Steps 1–7 → dashboard welcome toast`. Scope decision (documented in the test-file header + this §8): the full 7-step traversal is **deferred to Sprint 5.2 (partner reproduction docs)** because:

1. Sprint 3.1 already tested every branch of the signup-intake RPC — the DB-side branching contract is proven.
2. This spec proves the wizard ENTRY gate works for both branches of the expiry check.
3. The missing middle — driving OTP verify (which requires intercepting a real Resend email or stubbing OTP input), completing industry-select / data-inventory / template-selection / banner-config / first-consent-poll — adds ~200 lines of Playwright + runtime dependencies (Resend test inbox OR OTP-stub toggle in dev mode) that are better suited to an operator-guided demo script than a CI-run test. Sprint 5.2's partner-reproduction lane is the natural home for that coverage — partners literally walk through the wizard as part of the evidence archive's "here's how to set up a new customer" script.

Sprint 1.5 closes as specified for the entry-gate pair; the full traversal re-surfaces under Sprint 5.2 with the correct framing.
