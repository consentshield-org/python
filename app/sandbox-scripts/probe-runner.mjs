// ADR-0041 Sprint 1.2 — Playwright probe scenario.
//
// Executed inside a Vercel Sandbox (Firecracker microVM). Reads probe
// config JSON from stdin or /tmp/probe-input.json, loads the target URL
// with a given consent cookie state set, waits for network idle, collects
// all script src + iframe src + image src + final DOM + network request
// URLs, and prints a single JSON object to stdout.
//
// The orchestrator (/api/internal/run-probes) parses this JSON and runs
// it through the shared matchSignatures helper. No signature matching
// happens inside the sandbox — keeps the sandbox payload minimal.

import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

function readConfig() {
  try {
    const raw = readFileSync('/tmp/probe-input.json', 'utf8')
    return JSON.parse(raw)
  } catch {
    // Fallback: stdin
    return JSON.parse(readFileSync(0, 'utf8'))
  }
}

async function main() {
  const cfg = readConfig()
  const {
    url,
    consent_cookie_name = 'cs_consent',
    consent_cookie_domain,
    consent_state = {},
    wait_ms = 3000,
    user_agent = 'ConsentShieldProbe/2.0 (+https://consentshield.in)',
  } = cfg

  if (!url) {
    console.error(JSON.stringify({ error: 'missing url in config' }))
    process.exit(2)
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const context = await browser.newContext({ userAgent: user_agent })

  // Set the consent cookie BEFORE navigation. The domain is the hostname
  // of the target URL unless overridden.
  const domain = consent_cookie_domain ?? new URL(url).hostname
  await context.addCookies([
    {
      name: consent_cookie_name,
      value: Buffer.from(JSON.stringify(consent_state)).toString('base64url'),
      domain,
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 3600,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ])

  const networkUrls = []
  context.on('request', (req) => {
    networkUrls.push(req.url())
  })

  const page = await context.newPage()
  const t0 = Date.now()
  let status = null
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    status = resp?.status() ?? null
  } catch (e) {
    console.error(JSON.stringify({ error: 'navigation failed', detail: String(e) }))
    await browser.close()
    process.exit(3)
  }
  await page.waitForTimeout(wait_ms)
  const page_load_ms = Date.now() - t0

  // DOM snapshot
  const scriptSrcs = await page.$$eval('script[src]', (els) =>
    els.map((e) => e.getAttribute('src')).filter(Boolean),
  )
  const iframeSrcs = await page.$$eval('iframe[src]', (els) =>
    els.map((e) => e.getAttribute('src')).filter(Boolean),
  )
  const imgSrcs = await page.$$eval('img[src]', (els) =>
    els.map((e) => e.getAttribute('src')).filter(Boolean),
  )
  const cookies = (await context.cookies()).map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
  }))
  const title = await page.title().catch(() => null)
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => user_agent)

  await browser.close()

  // Resolve relative URLs against the page origin so the orchestrator sees
  // absolute URLs that match tracker_signatures.*.pattern strings.
  const origin = new URL(url).origin
  function absolutise(u) {
    try {
      return new URL(u, origin).toString()
    } catch {
      return u
    }
  }

  const result = {
    url,
    status,
    page_load_ms,
    title,
    user_agent: ua,
    consent_state,
    consent_cookie_name,
    network_urls: networkUrls,
    script_srcs: scriptSrcs.map(absolutise),
    iframe_srcs: iframeSrcs.map(absolutise),
    img_srcs: imgSrcs.map(absolutise),
    cookies,
  }
  process.stdout.write(JSON.stringify(result))
}

main().catch((e) => {
  console.error(JSON.stringify({ error: 'unhandled', detail: String(e) }))
  process.exit(1)
})
