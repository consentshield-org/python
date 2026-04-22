// ADR-1014 Sprint 2.1 — config-driven banner bootstrap.
//
// Lets the same static HTML point at either:
//   - the deployed CDN (default: https://cdn.consentshield.in), or
//   - a local wrangler dev instance (e.g. ?cdn=http://127.0.0.1:8787)
//
// org / prop ids likewise read from ?org= / ?prop= so a single demo HTML
// works against any fixture organisation seeded by scripts/e2e-bootstrap.ts.
//
// Order of precedence (first wins):
//   1. URL query string            ?cdn=...&org=...&prop=...
//   2. localStorage                cs_cdn / cs_org / cs_prop (persist across pages)
//   3. Data attributes on <script> data-cdn / data-org / data-prop
//   4. Fallback defaults           cdn.consentshield.in
//
// Reading query string once and mirroring to localStorage means a visitor
// can land on /ecommerce/?org=...&prop=... and keep those values as they
// navigate to /ecommerce/product/, /cart/, /checkout/.

(function () {
  'use strict'

  var script = document.currentScript
  var params = new URLSearchParams(window.location.search)

  function pick(name) {
    var qs = params.get(name)
    if (qs) {
      try { localStorage.setItem('cs_' + name, qs) } catch (e) {}
      return qs
    }
    try {
      var ls = localStorage.getItem('cs_' + name)
      if (ls) return ls
    } catch (e) {}
    if (script && script.getAttribute('data-' + name)) {
      return script.getAttribute('data-' + name)
    }
    return null
  }

  var cdn = pick('cdn') || 'https://cdn.consentshield.in'
  var org = pick('org')
  var prop = pick('prop')

  if (!org || !prop) {
    console.warn('[cs] banner-loader: missing org/prop. Set them via ?org=...&prop=... or data-org / data-prop.')
    return
  }

  // Normalize trailing slash.
  cdn = cdn.replace(/\/$/, '')

  var tag = document.createElement('script')
  tag.async = true
  tag.src = cdn + '/v1/banner.js?org=' + encodeURIComponent(org) + '&prop=' + encodeURIComponent(prop)
  tag.setAttribute('data-cs-loader', '1')
  document.head.appendChild(tag)

  // Expose a small debug shim so the Playwright test can read what
  // config the loader ended up using without scraping the DOM.
  window.__consentshield_demo = { cdn: cdn, org: org, prop: prop, banner_src: tag.src }
})()
