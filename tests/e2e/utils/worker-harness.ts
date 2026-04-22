import { spawn, type ChildProcess } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKER_DIR = resolve(HERE, '..', '..', '..', 'worker')

export interface WorkerHandle {
  url: string
  /** Kills the spawned process if one was started; no-op if using WORKER_URL. */
  stop: () => Promise<void>
}

/**
 * Returns a live Cloudflare Worker URL for the E2E suite.
 *
 * Two modes:
 *   1. **Preset** — if `WORKER_URL` is already set (env, .env.e2e, or deployed
 *      URL passed via CI), that URL is returned verbatim. Preferred for CI
 *      and for partner reproductions against a deployed Worker.
 *   2. **Spawn** — if `WORKER_URL` is missing OR the caller passes
 *      `{ forceSpawn: true }`, we spawn `bunx wrangler dev --local` from the
 *      worker/ workspace and wait for the "Ready on" log line.
 *
 * Prerequisites for spawn mode:
 *   - `worker/.dev.vars` containing `SUPABASE_WORKER_KEY=<plaintext>`.
 *     Copy the value from `.env.local` (key: `SUPABASE_WORKER_KEY` or
 *     `SUPABASE_SERVICE_ROLE_KEY` per the ADR-1010 migration state).
 *   - Port 8787 free.
 */
export async function startWorker(
  opts: { forceSpawn?: boolean; readyTimeoutMs?: number } = {}
): Promise<WorkerHandle> {
  const preset = process.env.WORKER_URL
  if (preset && !opts.forceSpawn) {
    return { url: preset, stop: async () => {} }
  }

  const port = 8787
  const url = `http://127.0.0.1:${port}`
  const timeoutMs = opts.readyTimeoutMs ?? 45_000

  const child: ChildProcess = spawn(
    'bunx',
    ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port)],
    {
      cwd: WORKER_DIR,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let resolved = false
  let output = ''

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString()
      output += text
      // wrangler prints "Ready on http://127.0.0.1:8787" when the dev server is up.
      if (!resolved && /Ready on http:\/\/127\.0\.0\.1:/.test(output)) {
        resolved = true
        resolveReady()
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', (code) => {
      if (!resolved) {
        rejectReady(
          new Error(
            `wrangler dev exited before becoming ready (code=${code}).\n` +
              `Last output:\n${output.slice(-1_000)}`
          )
        )
      }
    })
    setTimeout(() => {
      if (!resolved) {
        rejectReady(new Error(`wrangler dev ready timeout after ${timeoutMs}ms`))
      }
    }, timeoutMs)
  })

  await ready

  return {
    url,
    stop: () =>
      new Promise<void>((resolveStop) => {
        if (child.killed || child.exitCode !== null) {
          resolveStop()
          return
        }
        child.once('exit', () => resolveStop())
        child.kill('SIGTERM')
        // Hard stop after 5s if SIGTERM is ignored.
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 5_000)
      })
  }
}
