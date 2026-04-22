// ADR-1014 Sprint 2.4 — cross-vertical banner interaction harness.
//
// The harness abstracts the three banner outcomes (accept_all / reject_all /
// customise) over any vertical demo page. Tests feed in `{ url, cdn, orgId,
// propertyId }` and receive a typed `ConsentEventDetail` back, plus helpers
// for the post-interaction state (DB row, injected tracker scripts).
//
// Runtime dependencies (same skip-cleanly pattern as `demo-ecommerce-banner.spec.ts`):
//   1. A reachable banner CDN — either `bunx wrangler dev` locally (WORKER_URL env)
//      or the production Cloudflare Worker at `https://cdn.consentshield.in`.
//   2. The Worker's `SUPABASE_WORKER_KEY` must be a valid cs_worker JWT
//      (ADR-1010 Sprint 2.1 role guard). Local dev-vars service-role is rejected.
//   3. The banner's stored purposes must carry `{ id, name, required, default }`
//      (the Worker's `Purpose` interface). The bootstrap currently stores
//      `{ code, required, legal_basis }` — a shape-mismatch pre-req that
//      blocks runtime green until reconciled. Tracked in ADR-1014 Sprint 2.4.

import type { Page, Route } from '@playwright/test'
import { expect } from '@playwright/test'

export type BannerEventType =
  | 'consent_given'
  | 'consent_withdrawn'
  | 'purpose_updated'

export interface ConsentEventDetail {
  event_type: BannerEventType
  accepted: string[]
  rejected: string[]
}

export interface BannerOpenArgs {
  /** Full page URL to navigate to. Any existing query string is preserved. */
  url: string
  /** CDN / Worker base URL — passed to banner-loader.js as `?cdn=`. */
  cdn: string
  /** Fixture org uuid — passed as `?org=`. */
  orgId: string
  /** Fixture property uuid — passed as `?prop=`. */
  propertyId: string
}

/**
 * Intercept `/v1/banner.js` to flip `keepalive: true` → `keepalive: false` in the
 * compiled banner script. Same technique as `demo-ecommerce-banner.spec.ts`:
 * Chromium's `fetch(..., { keepalive: true })` bypasses page-level interception,
 * so the POSTs are invisible to Playwright without this patch. The downstream
 * request path to the Worker is unchanged.
 */
const patchKeepalive = async (route: Route): Promise<void> => {
  const resp = await route.fetch()
  const body = await resp.text()
  const patched = body.replace(/keepalive\s*:\s*true/g, 'keepalive:false')
  await route.fulfill({
    response: resp,
    body: patched,
    headers: {
      ...resp.headers(),
      'content-length': String(Buffer.byteLength(patched))
    }
  })
}

/**
 * Navigate to a demo page with banner-loader query params, install a window
 * listener that captures the next `consentshield:consent` event, and wait
 * for the banner's Accept-all button to render. Returns nothing — subsequent
 * calls to `acceptAll` / `rejectAll` / `customise` operate on the same page.
 */
export async function openBanner(
  page: Page,
  args: BannerOpenArgs
): Promise<void> {
  const sep = args.url.includes('?') ? '&' : '?'
  const target =
    `${args.url}${sep}cdn=${encodeURIComponent(args.cdn)}` +
    `&org=${encodeURIComponent(args.orgId)}` +
    `&prop=${encodeURIComponent(args.propertyId)}`

  await page.route(
    (url) => url.pathname === '/v1/banner.js',
    patchKeepalive
  )

  await page.addInitScript(() => {
    ;(window as unknown as { __cs_event?: ConsentEventDetail | null }).__cs_event =
      null
    window.addEventListener('consentshield:consent', (e) => {
      ;(window as unknown as { __cs_event?: ConsentEventDetail }).__cs_event = (
        e as CustomEvent
      ).detail as ConsentEventDetail
    })
  })

  await page.goto(target, { waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('button', { name: 'Accept all' }),
    'banner Accept-all button did not render within 10 s'
  ).toBeVisible({ timeout: 10_000 })
}

async function waitForConsentEvent(
  page: Page,
  timeoutMs = 5_000
): Promise<ConsentEventDetail> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __cs_event?: ConsentEventDetail | null })
        .__cs_event !== null,
    null,
    { timeout: timeoutMs }
  )
  return await page.evaluate(
    () =>
      (window as unknown as { __cs_event: ConsentEventDetail }).__cs_event
  )
}

export async function acceptAll(page: Page): Promise<ConsentEventDetail> {
  await page.getByRole('button', { name: 'Accept all' }).click()
  const ev = await waitForConsentEvent(page)
  expect(ev.event_type).toBe('consent_given')
  expect(ev.rejected, 'accept_all should leave rejected[] empty').toEqual([])
  return ev
}

export async function rejectAll(page: Page): Promise<ConsentEventDetail> {
  await page.getByRole('button', { name: 'Reject all' }).click()
  const ev = await waitForConsentEvent(page)
  expect(ev.event_type).toBe('consent_withdrawn')
  // accepted[] is not empty in the reject-all case — required-basis purposes
  // (legal_obligation / contract) always stay granted. The matrix test asserts
  // exactly which purposes survive per vertical.
  return ev
}

export interface CustomiseArgs {
  /**
   * Purpose display-names to mark accepted. Required-basis purposes are
   * always accepted regardless; optional purposes not in this list are rejected.
   * Matching is `<strong>` textContent of the banner's purpose rows.
   */
  acceptNames: string[]
}

export async function customise(
  page: Page,
  args: CustomiseArgs
): Promise<ConsentEventDetail> {
  await page.getByRole('button', { name: 'Customise' }).click()

  // Banner renders one <label><input type=checkbox><span><strong>name</strong>…
  // per purpose. We flip optional checkboxes to match args.acceptNames; disabled
  // (required) checkboxes are left alone.
  await page.evaluate((accept) => {
    const dialog = document.querySelector(
      '[role="dialog"][aria-label="Cookie consent"]'
    )
    if (!dialog) throw new Error('consent banner root not found')
    const labels = dialog.querySelectorAll('label')
    for (const label of Array.from(labels)) {
      const nameEl = label.querySelector('strong')
      const cb = label.querySelector(
        'input[type=checkbox]'
      ) as HTMLInputElement | null
      if (!nameEl || !cb || cb.disabled) continue
      const name = (nameEl.textContent || '').trim()
      const shouldBeChecked = accept.includes(name)
      if (cb.checked !== shouldBeChecked) cb.click()
    }
  }, args.acceptNames)

  await page.getByRole('button', { name: 'Save preferences' }).click()
  const ev = await waitForConsentEvent(page)
  expect(ev.event_type).toBe('purpose_updated')
  return ev
}

/**
 * Return the `src` of every script injected by `test-sites/shared/demo.js`
 * after consent (identified by `data-cs-tracker="1"`). Used to assert
 * tracker-blocking behaviour in the matrix test.
 */
export async function getLoadedTrackers(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[data-cs-tracker]')
    return Array.from(scripts).map((s) => (s as HTMLScriptElement).src)
  })
}

/**
 * Returns the banner root if present, null if it's been removed (which happens
 * after any `finalise` call — the banner dismounts itself post-interaction).
 */
export async function bannerIsDismissed(page: Page): Promise<boolean> {
  return await page.evaluate(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Cookie consent"]'
      ) === null
  )
}
