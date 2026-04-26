# SDK publish runbook — Python (PyPI)

> **Source of truth:** [`packages/python-client/PUBLISHING.md`](../../packages/python-client/PUBLISHING.md). This file mirrors the canonical runbook so operators discovering `docs/runbooks/` can find it.
>
> Edits go in the source file, not here.

---

Open [`packages/python-client/PUBLISHING.md`](../../packages/python-client/PUBLISHING.md) for the full runbook (PyPI account + 2FA + project-scoped API token, `~/.pypirc` chmod 600, pre-flight gates, version bump in pyproject.toml + `__version__`, `python -m build`, `twine check`, test-PyPI dry run, production upload, recovery from a bad release — yank + bump-and-republish, NEVER force-overwrite).

## Quick reference

| Phase | Command |
|---|---|
| Pre-flight | `cd packages/python-client && pytest && mypy --strict && ruff check` |
| Bump | Update `pyproject.toml` `version` AND `__version__` (must match) |
| Build | `python -m build` |
| Verify | `twine check dist/*` |
| Test-PyPI | `twine upload --repository testpypi dist/*` (dry run) |
| Production | `twine upload dist/*` |
| Smoke | `pip install consentshield==1.0.0` |

**Coordinate published:** `consentshield` 1.0.0 (single package; not split like Java / .NET / PHP — Tier 1 hand-rolled SDK ships as one artefact).
