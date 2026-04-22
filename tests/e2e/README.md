# `@consentshield/e2e` — end-to-end test harness (ADR-1014)

Partner-evidence-grade suite. Exercises the full ConsentShield pipeline: browser → banner → Cloudflare Worker HMAC → buffer → delivery Edge Function → R2 object → receipts — with paired positive / negative controls and mutation testing.

> **Read first:** `specs/README.md` — the normative test-spec template. Every `*.spec.ts` here has a matching `specs/<slug>.md` that states intent, invariants, and proofs in plain English.

## Quick start

```bash
# From the repo root:
bun install                               # picks up this workspace
cd tests/e2e && bun run install:browsers  # downloads chromium + webkit

# Minimum viable .env.e2e (project root) — see utils/env.ts for the full list.
cat >> ../../.env.e2e <<EOF
APP_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001
MARKETING_URL=http://localhost:3002
WORKER_URL=http://localhost:8787
SUPABASE_URL=<your-test-project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
EOF

# Smoke run
bun run test:smoke
```

From the repo root the same commands are exposed as:

```bash
bun run test:e2e:smoke     # PR subset
bun run test:e2e           # full chromium + webkit
bun run test:e2e:full      # + firefox + video on failure (nightly)
bun run test:e2e:partner   # reads .env.partner (Sprint 5.1 bootstrap)
```

## Layout

```
tests/e2e/
├── playwright.config.ts        # Projects: chromium, webkit, firefox (nightly)
├── package.json                # Exact-pinned deps per project Rule 17
├── tsconfig.json               # Extends tsconfig.base.json
├── utils/
│   ├── env.ts                  # Env loader + required-keys guard
│   ├── trace-id.ts             # Per-test ULID-shaped trace id
│   └── fixtures.ts             # Extended Playwright `test` with env/traceId/tracedRequest
├── specs/                      # Spec docs — the contract (read first)
│   ├── README.md               # Template + writing checklist
│   └── smoke-healthz.md        # Example
├── controls/                   # Sacrificial "must-fail" controls (Sprint 5.4 preview)
│   ├── README.md
│   └── smoke-healthz-negative.spec.ts
└── smoke-healthz.spec.ts       # First smoke — 3-surface /healthz probe
```

## Discipline

Per ADR-1014:

1. **Every spec.ts has a matching specs/<slug>.md.** CI fails if the 1:1 mapping is broken.
2. **Every positive test has a paired negative control.** The pair is declared in section 6 of the spec doc and indexed in `specs/pair-matrix.md` (Sprint 3.7).
3. **Assertions must be on observable state.** Naked HTTP-status assertions are insufficient — see ADR-1014 Decision → Coverage depth.
4. **Every test emits a trace id** (the `traceId` fixture). The id threads through Worker logs, buffer rows, R2 manifests, and the evidence archive.
5. **Controls MUST fail red.** A control that ever passes invalidates the whole run.

## What's in this sprint (Sprint 1.1)

- [x] Workspace scaffold (package.json, tsconfig.json)
- [x] `playwright.config.ts` — chromium + webkit default; firefox nightly-gated (`PLAYWRIGHT_NIGHTLY=1`)
- [x] `specs/README.md` — normative spec-doc template
- [x] `utils/env.ts`, `utils/trace-id.ts`, `utils/fixtures.ts`
- [x] Root `package.json` scripts: `test:e2e`, `test:e2e:smoke`, `test:e2e:full`, `test:e2e:partner`
- [x] First smoke spec + sacrificial control
- [ ] Verification — `bun run test:e2e:smoke` against running local servers

Sprint 1.2 (next) will wire the Supabase test-project bootstrap (`scripts/e2e-bootstrap.ts`) and fixture factory. Sprint 1.3 adds the Worker local harness. Sprint 1.4 adds the R2 evidence writer + static index.
