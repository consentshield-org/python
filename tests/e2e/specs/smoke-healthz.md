# E2E-1.1-smoke-healthz: All three app surfaces serve /healthz

**ADR:** ADR-1014
**Sprint:** Phase 1, Sprint 1.1
**Sibling negative:** `smoke-healthz-negative.spec.ts` (control in `controls/`)
**Category:** @smoke

---

## 1. Intent

Prove the test harness can drive a browser against all three deployed surfaces (customer app, admin app, marketing site) and observe a response. This is the foundation sanity check: if this spec cannot pass, nothing downstream in ADR-1014 is actionable. Regressing this spec means the harness is broken, not the product.

This spec intentionally does not exercise business logic. It exists so that:

- The Playwright config loads correctly.
- The env loader resolves `APP_URL` / `ADMIN_URL` / `MARKETING_URL`.
- The trace-id fixture attaches to `testInfo`.
- The tracedRequest fixture produces a context with the expected header.

## 2. Setup

- `APP_URL`, `ADMIN_URL`, `MARKETING_URL` are populated in `.env.e2e` (or ambient).
- Each of the three surfaces serves a response at `/healthz` (200 OK). If a surface has no `/healthz` yet, the harness falls back to `/` and asserts only that the response is < 500.
- No database, Worker, or R2 dependency.

## 3. Invariants

- The trace id emitted by the fixture is present in the test attachments (`testInfo.attachments`).
- No HTTP-level redirects leave the test's own origin (a corporate proxy swallowing /healthz would violate this).

## 4. Expected proofs

1. APP_URL `/healthz` (or `/`) responds with status < 500.
2. ADMIN_URL `/healthz` (or `/`) responds with status < 500.
3. MARKETING_URL `/healthz` (or `/`) responds with status < 500.
4. Each response includes a non-empty body.
5. `testInfo.attachments` contains an entry named `trace-id.txt` whose content matches the emitted trace id for that test run.
6. The `tracedRequest` context sent an `X-Request-Id` header with the same trace id (verified by re-reading from the context's `extraHTTPHeaders`).

## 5. Pair-with-negative

**Pair:** `tests/e2e/controls/smoke-healthz-negative.spec.ts` — intentionally asserts that a patently-false condition holds (`expect('ok').toEqual('not-ok')`). This test MUST fail red. If it ever passes, the suite is flagged — the pos/neg discipline is broken.

The control file lives in `controls/` and is included in the default test run so its failure is always observed (see Sprint 5.4 — this is a preview of the controls pattern).

## 6. Why this spec is not a fake positive

The spec would trivially pass on a dead endpoint if we only asserted `response.status() < 500` against one URL. We assert against all three *distinct* surfaces, each with its own deployment pipeline, and we assert that a non-empty body is returned. A single broken backend cannot satisfy all three checks. The trace-id fixture is independently verified against `testInfo.attachments`, which Playwright writes *after* the test body runs — this is not a self-referential check.

## 7. Evidence outputs

- `trace-id.txt` — per test
- HTTP response headers for each of the three surface hits (JSON attachment)
- Playwright HTML report (always)
- Trace (on failure)
