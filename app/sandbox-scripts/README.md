# ConsentShield Sandbox Scripts (ADR-0041)

Scripts executed **inside** Vercel Sandbox microVMs by the `/api/internal/run-probes` orchestrator.

These files are **not** bundled into the Next.js server bundle. At probe run time, the orchestrator:

1. Creates a fresh Vercel Sandbox via `@vercel/sandbox`
2. Copies the contents of this directory into the sandbox
3. Runs `npm install --omit=dev && npx playwright install chromium`
4. Writes the probe config to `/tmp/probe-input.json`
5. Runs `node probe-runner.mjs`
6. Captures the JSON stdout
7. Stops the sandbox

Keep this directory minimal. Any heavy dependency extends cold-start time and eats into the 2-minute probe budget.

## Files

- `probe-runner.mjs` — Playwright scenario. Entrypoint.
- `package.json` — pinned `playwright-core`.

## Testing locally

You can run the scenario against a local config without the sandbox:

```bash
cd app/sandbox-scripts
npm install
npx playwright install chromium
echo '{"url":"https://consentshield.in"}' > /tmp/probe-input.json
node probe-runner.mjs
```

Output is a single JSON object on stdout.
