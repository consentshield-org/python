# Sacrificial controls (ADR-1014 Sprint 5.4 preview)

Files in this folder are **intentionally broken tests that MUST fail**. They exist to prove the suite's pos/neg discipline is intact.

Rules:

- Every control is a plain `*.spec.ts` file. Playwright picks it up as a normal test.
- Every control asserts a patently-false condition. It MUST fail red on every run.
- If any control ever passes, the suite is flagged — CI inverts control outcomes: any `passed` control fails the build. Sprint 5.4 wires the inversion gate.
- Controls DO NOT touch production code paths. They exist only to red-flag the suite.
- Controls DO NOT require any fixture setup — they run against no real system.

Do not "fix" a control. If a control's assertion needs to change, update the pairing in `specs/pair-matrix.md` (Sprint 3.7) and replace the file.
