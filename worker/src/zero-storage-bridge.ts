import type { Env } from './index'

// ADR-1003 Sprint 1.2 — Worker-side bridge client for zero_storage orgs.
//
// The Worker's hot path is single-digit milliseconds for the customer's
// banner. Doing an R2 upload inline would be 200-500ms. Instead:
//
//   · handleConsentEvent / handleObservation call isZeroStorage(env, org)
//     before the INSERT branch.
//   · If zero_storage, they schedule postToBridge via ctx.waitUntil and
//     return 202 immediately. The bridge does the R2 upload; result is
//     logged to worker_errors on failure.
//   · If not zero_storage, the standard INSERT path runs unchanged.
//
// Worker → Next.js trust: bearer via WORKER_BRIDGE_SECRET. If either
// env var is unset (dev Miniflare, a misconfigured prod), postToBridge
// returns { sent: false, reason: 'not_configured' } and the caller
// falls back to the INSERT path. That fallback preserves correctness —
// a zero_storage org whose bridge isn't configured writes to the
// buffer tables like a Standard org, visible via admin.pipeline_stuck_buffers.
// The safer failure mode is "still writing" rather than "silently
// dropping."
//
// Rule 16 intact: zero npm deps.

export interface BridgePostParams {
  kind: 'consent_event' | 'tracker_observation'
  org_id: string
  event_fingerprint: string
  timestamp: string
  payload: Record<string, unknown>
}

export type BridgePostResult =
  | { sent: true; status: number }
  | { sent: false; reason: 'not_configured' | 'network_error' | 'non_2xx'; status?: number; detail?: string }

export function isBridgeConfigured(env: Env): boolean {
  return Boolean(env.ZERO_STORAGE_BRIDGE_URL && env.WORKER_BRIDGE_SECRET)
}

export async function postToBridge(
  env: Env,
  params: BridgePostParams,
): Promise<BridgePostResult> {
  if (!isBridgeConfigured(env)) {
    return { sent: false, reason: 'not_configured' }
  }
  try {
    const resp = await fetch(env.ZERO_STORAGE_BRIDGE_URL!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WORKER_BRIDGE_SECRET!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      return {
        sent: false,
        reason: 'non_2xx',
        status: resp.status,
        detail: detail.slice(0, 400),
      }
    }
    return { sent: true, status: resp.status }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      sent: false,
      reason: 'network_error',
      detail: detail.slice(0, 400),
    }
  }
}
