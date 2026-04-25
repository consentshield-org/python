# PUBLISHING — `consentshield` (PyPI)

Operator runbook for publishing the Python SDK to PyPI. Two-factor
authentication is mandatory on the PyPI account; do not store the
token in any committed file or local script.

## One-time setup

### 1. PyPI account + project ownership

1. Sign up at https://pypi.org with the support@ alias
   (`support@consentshield.in`). Use a unique strong password +
   hardware-backed 2FA (security key or TOTP). PyPI requires 2FA on
   accounts that publish.
2. Reserve the `consentshield` project name by uploading version
   `0.0.0a0` once from a clean machine, OR file a "pre-claim" via the
   PyPI request form. Once owned, add `Sudhindra Anegondhi` as the
   sole maintainer. Do NOT add organisation collaborators until the
   v1 launch passes legal review.
3. Repeat on https://test.pypi.org for the staging publish flow.

### 2. API token (project-scoped)

Generate a project-scoped API token (NOT account-scoped) under
"Account settings → API tokens". Scope it to `consentshield` only.
The token format is `pypi-AgENd...` (long random string).

Store the token in a local `~/.pypirc` outside the repo:

```ini
# ~/.pypirc — chmod 600
[distutils]
index-servers =
    pypi
    testpypi

[pypi]
username = __token__
password = pypi-<the-real-token>

[testpypi]
repository = https://test.pypi.org/legacy/
username = __token__
password = pypi-<the-test-token>
```

`chmod 600 ~/.pypirc`. The repo's `.gitignore` already excludes
`.pypirc`; double-check before any `git add`.

### 3. Local toolchain

```sh
python3 -m venv ~/.venvs/cs-publish
source ~/.venvs/cs-publish/bin/activate
pip install --upgrade pip build twine
```

`build` produces the wheel + sdist. `twine` validates and uploads.
Both run from the publish venv; do not contaminate the project venv
with publish tooling.

## Per-release publish

Pre-flight is mandatory. Every step must pass before `twine upload`.

### 1. Pre-flight

```sh
cd packages/python-client

# Tests + coverage gate (fail_under=80 in pyproject.toml).
pip install -e '.[test]'
pytest -q --cov

# Type-check strict.
pip install -e '.[dev]'
mypy --strict src tests

# Lint.
ruff check src tests
```

All three MUST pass with zero warnings. Coverage report sits at
`htmlcov/index.html` for spot-check.

### 2. Version bump

Edit `pyproject.toml` `[project] version = "X.Y.Z"` AND
`src/consentshield/__init__.py` `__version__ = "X.Y.Z"`. Both must
match — `twine check` will not catch a mismatch.

Tag the bump commit:

```sh
git add pyproject.toml src/consentshield/__init__.py
git commit -m "chore(consentshield): bump to X.Y.Z"
git tag -a python-vX.Y.Z -m "consentshield X.Y.Z"
```

### 3. Build

```sh
rm -rf dist build
python -m build
ls dist/
# consentshield-X.Y.Z-py3-none-any.whl
# consentshield-X.Y.Z.tar.gz
```

### 4. Validate

```sh
twine check dist/*
```

Expect `PASSED` for both files. `twine check` validates the
README rendering, classifier set, and metadata version.

### 5. Test-PyPI dry run

```sh
twine upload --repository testpypi dist/*
```

Verify by installing the test wheel into a scratch venv:

```sh
python3 -m venv /tmp/cs-test
source /tmp/cs-test/bin/activate
pip install \
    --index-url https://test.pypi.org/simple/ \
    --extra-index-url https://pypi.org/simple/ \
    consentshield==X.Y.Z

python -c "from consentshield import ConsentShieldClient, AsyncConsentShieldClient; print('ok')"
deactivate
```

The `--extra-index-url` is required because `httpx` (runtime dep) is
not on test.pypi.org.

### 6. Production upload

```sh
twine upload dist/*
```

The `__token__` username + `pypi-...` password from `~/.pypirc` are
picked up automatically. PyPI 2FA prompts the security key /
authenticator on the publish action.

Verify on https://pypi.org/project/consentshield/ that the new
version is listed and the README rendered correctly. Smoke-test
install from a fresh venv:

```sh
python3 -m venv /tmp/cs-prod-smoke
source /tmp/cs-prod-smoke/bin/activate
pip install consentshield==X.Y.Z
python -c "from consentshield import ConsentShieldClient; ConsentShieldClient(api_key='cs_live_smoke')"
deactivate && rm -rf /tmp/cs-prod-smoke
```

### 7. Post-publish

```sh
git push origin main
git push origin python-vX.Y.Z
```

Publish a GitHub release linking to the PyPI version page. Note the
release in `docs/changelogs/CHANGELOG-api.md` under the relevant ADR
sprint entry.

## Recovering from a bad release

PyPI does NOT allow re-uploading a yanked version's filename. If a
release contains a critical bug:

1. Yank the bad version: `pip install pypi-yank-cli` then
   `pypi-yank consentshield X.Y.Z` (or via the PyPI web UI). Yanked
   versions remain installable by exact pin but stop appearing in
   `pip install consentshield`.
2. Bump to `X.Y.(Z+1)` and re-publish from scratch.
3. NEVER force-overwrite the same filename — PyPI rejects this with
   `400 Bad Request: File already exists`.

## Security checklist

- [ ] API token is project-scoped, not account-scoped.
- [ ] `.pypirc` is `chmod 600`, outside the repo.
- [ ] 2FA is enforced on the PyPI account.
- [ ] No PyPI token appears in any CI workflow file (use OIDC trusted
      publishing if/when CI gains publish authority — until then,
      manual local publish only).
- [ ] `twine check dist/*` passed before upload.
- [ ] Test-PyPI dry run succeeded for the same wheel + sdist.
