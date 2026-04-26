# SDK publish runbook — Go (module proxy)

> **Source of truth:** [`packages/go-client/PUBLISHING.md`](../../packages/go-client/PUBLISHING.md). This file mirrors the canonical runbook so operators discovering `docs/runbooks/` can find it.
>
> Edits go in the source file, not here.

---

Open [`packages/go-client/PUBLISHING.md`](../../packages/go-client/PUBLISHING.md) for the full runbook (pre-flight gates `go vet` + `go test -race -cover` + `gofmt -l . == empty`, version bump — the `Version` constant must match the git tag, `git tag -a vX.Y.Z`, verify on `proxy.golang.org`, scratch-venv smoke install, recovery from a bad tag, v2+ module-path-suffix convention).

## Quick reference

| Phase | Command |
|---|---|
| Pre-flight | `cd packages/go-client && go vet ./... && go test -race -cover ./...` |
| Tag | `git tag -a v1.0.0 -m "ConsentShield Go SDK 1.0.0" && git push origin v1.0.0` |
| Cache warm | Module proxy auto-resolves on first `go get` |
| Smoke | `go get github.com/SAnegondhi/consentshield-go@v1.0.0` |

**Coordinate published:** `github.com/SAnegondhi/consentshield-go@v1.0.0` (single module; not split — Tier 1 hand-rolled SDK ships as one artefact).

**Recovery note:** Once a tag is cached on `proxy.golang.org`, you cannot reliably reuse it. A bad release means a new patch version — never re-tag.
