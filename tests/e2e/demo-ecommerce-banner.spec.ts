import { test, expect } from './utils/fixtures'
import {
  countConsentEventsSince,
  latestConsentEvent
} from './utils/supabase-admin'
import { startStaticServer, type StaticServerHandle } from './utils/static-server'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// See specs/demo-ecommerce-banner.md for the normative spec.
// Paired negative: demo-ecommerce-banner-wrong-origin.spec.ts.

const HERE = dirname(fileURLToPath(import.meta.url))
const TEST_SITES_ROOT = resolve(HERE, '..', '..', 'test-sites')

let staticServer: StaticServerHandle | null = null

test.beforeAll(async () => {
  // Bind to the exact port seeded in e2e-bootstrap.ts allowed_origins so the
  // Worker's origin check resolves correctly. 4001 is ecommerce's port.
  staticServer = await startStaticServer(TEST_SITES_ROOT, { port: 4001 })
})

test.afterAll(async () => {
  if (staticServer) await staticServer.stop()
})

test.describe('@pipeline @browser @ecommerce Demo ecommerce banner → Worker → buffer', () => {
  test('Accept all fires consent event AND produces a consent_events row', async ({
    ecommerce,
    page
  }, testInfo) => {
    const workerUrl = process.env.WORKER_URL
    if (!workerUrl) {
      test.skip(true, 'WORKER_URL env not set. Start `cd worker && bun run dev` first.')
      return
    }
    if (!staticServer) {
      throw new Error('static server did not start')
    }

    // Use fixture property [2] — its allowed_origins only contains localhost:4001,
    // which isolates this test's buffer rows from any other @pipeline test.
    const property = ecommerce.properties[2]
    expect(property, 'fixture missing properties[2] (Sandbox probe)').toBeTruthy()

    const cutoffIso = new Date().toISOString()
    const demoUrl =
      `${staticServer.url}/ecommerce/?cdn=${encodeURIComponent(workerUrl)}` +
      `&org=${encodeURIComponent(ecommerce.orgId)}` +
      `&prop=${encodeURIComponent(property.id)}`

    // Capture console messages + network activity (evidence on failure).
    const consoleMsgs: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleMsgs.push(`[${msg.type()}] ${msg.text()}`)
      }
    })
    const networkLog: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/v1/')) {
        networkLog.push(`→ ${req.method()} ${req.url()}`)
      }
    })
    page.on('response', (resp) => {
      if (resp.url().includes('/v1/')) {
        networkLog.push(`← ${resp.status()} ${resp.url()}`)
      }
    })
    page.on('requestfailed', (req) => {
      if (req.url().includes('/v1/')) {
        networkLog.push(`✗ ${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
      }
    })

    // The production banner calls `fetch(..., { keepalive: true })` which
    // in Chromium bypasses page-level request interception. Intercept the
    // banner.js response and flip keepalive off — same request path, but
    // the browser routes the POST through normal interception (needed so
    // Playwright's network hooks see every request for evidence capture).
    await page.route(
      (url) => url.hostname === '127.0.0.1' && url.pathname === '/v1/banner.js',
      async (route) => {
        const resp = await route.fetch()
        const body = await resp.text()
        const patched = body.replace(/keepalive\s*:\s*true/g, 'keepalive:false')
        await route.fulfill({
          response: resp,
          body: patched,
          headers: { ...resp.headers(), 'content-length': String(Buffer.byteLength(patched)) }
        })
      }
    )

    // Capture the page-level consent event for a state proof.
    await page.addInitScript(() => {
      ;(window as unknown as { __cs_event?: unknown }).__cs_event = null
      window.addEventListener('consentshield:consent', (e) => {
        ;(window as unknown as { __cs_event?: unknown }).__cs_event = (
          e as CustomEvent
        ).detail
      })
    })

    // Navigate — proof 1: page loads, banner script injected.
    await page.goto(demoUrl, { waitUntil: 'domcontentloaded' })

    // Proof 2: loader exposes the resolved config.
    const demoCfg = await page.evaluate(
      () => (window as unknown as { __consentshield_demo?: unknown }).__consentshield_demo
    )
    expect(demoCfg, 'banner-loader.js did not expose __consentshield_demo').toBeTruthy()
    expect((demoCfg as { org: string }).org).toBe(ecommerce.orgId)
    expect((demoCfg as { prop: string }).prop).toBe(property.id)

    // Proof 1: the banner's Accept all button is rendered.
    const acceptBtn = page.getByRole('button', { name: 'Accept all' })
    await expect(acceptBtn).toBeVisible({ timeout: 10_000 })

    await acceptBtn.click()

    // Proof 3: the page-level event fires.
    await page.waitForFunction(
      () => (window as unknown as { __cs_event?: unknown }).__cs_event !== null,
      null,
      { timeout: 5_000 }
    )
    const pageEvent = await page.evaluate(
      () => (window as unknown as { __cs_event?: unknown }).__cs_event
    )

    await testInfo.attach('consent-event-fired.json', {
      body: JSON.stringify(pageEvent, null, 2),
      contentType: 'application/json'
    })

    expect((pageEvent as { event_type: string }).event_type).toBe('consent_given')
    expect(
      (pageEvent as { accepted: string[] }).accepted.length,
      'accepted purposes must be non-empty after Accept all'
    ).toBeGreaterThan(0)

    // Give the in-flight fetch(keepalive:true) time to land + flush.
    // Playwright's requestfinished can lag for keepalive requests.
    await new Promise((r) => setTimeout(r, 1_000))

    // Proofs 5 + 6: DB row observed + count delta = 1. Poll up to 5s.
    let observed: Awaited<ReturnType<typeof latestConsentEvent>> = null
    for (let i = 0; i < 10; i++) {
      observed = await latestConsentEvent(property.id, cutoffIso)
      if (observed) break
      await new Promise((r) => setTimeout(r, 500))
    }

    // Always emit the network log so failures have diagnostic data.
    await testInfo.attach('network.log', {
      body: networkLog.length ? networkLog.join('\n') : '(no /v1/* requests observed)',
      contentType: 'text/plain'
    })

    expect(observed, 'no consent_events row observed').not.toBeNull()
    expect(observed!.org_id).toBe(ecommerce.orgId)
    expect(observed!.property_id).toBe(property.id)
    expect(observed!.banner_id).toBe(property.bannerId)
    expect(observed!.event_type).toBe('consent_given')
    expect(observed!.origin_verified).toBe('origin-only')

    await testInfo.attach('observed-row.json', {
      body: JSON.stringify(observed, null, 2),
      contentType: 'application/json'
    })

    const count = await countConsentEventsSince(property.id, cutoffIso)
    expect(count, 'expected exactly 1 row since cutoff').toBe(1)

    if (consoleMsgs.length > 0) {
      await testInfo.attach('console.log', {
        body: consoleMsgs.join('\n'),
        contentType: 'text/plain'
      })
    }
  })
})
