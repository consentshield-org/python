// Shared demo helpers — wired into every ecommerce / healthtech / bfsi / etc.
// page. Small, dependency-free. Mirrors the old inline <script> blocks so
// each HTML file stays short.

(function () {
  'use strict'

  // ─── Tracker loader — per-purpose script injection after consent ─────
  var TRACKERS = (window.__DEMO_TRACKERS__ = window.__DEMO_TRACKERS__ || {
    analytics: [],
    marketing: [],
    personalisation: [],
    essential: []
  })

  function inject(src) {
    var s = document.createElement('script')
    s.src = src
    s.async = true
    s.setAttribute('data-cs-tracker', '1')
    document.head.appendChild(s)
  }

  function loadFor(purposes) {
    (purposes || []).forEach(function (p) {
      (TRACKERS[p] || []).forEach(function (t) { inject(t.src) })
    })
  }

  // Essential trackers load on every pageview regardless of consent state.
  loadFor(['essential'])

  // ─── Live consent-state panel ────────────────────────────────────────
  function renderStatus(detail) {
    var el = document.getElementById('status')
    if (!el) return
    var accepted = (detail.accepted || []).join(', ') || '(none)'
    var rejected = (detail.rejected || []).join(', ') || '(none)'
    el.textContent =
      'event: ' + detail.event_type +
      '\naccepted: ' + accepted +
      '\nrejected: ' + rejected
  }

  window.addEventListener('consentshield:consent', function (e) {
    renderStatus(e.detail)
    loadFor(e.detail.accepted)
    // Also mirror to an attribute on <body> so Playwright can wait on it.
    document.body.setAttribute('data-cs-last-event', e.detail.event_type)
  })

  // ─── Persistent nav query-string — keep ?org / ?prop / ?cdn across clicks ───
  var keep = ['org', 'prop', 'cdn']
  var params = new URLSearchParams(window.location.search)
  var forward = keep.filter(function (k) { return params.get(k) }).map(function (k) {
    return k + '=' + encodeURIComponent(params.get(k))
  }).join('&')
  if (forward) {
    document.addEventListener('click', function (evt) {
      var a = evt.target.closest && evt.target.closest('a[href]')
      if (!a) return
      var href = a.getAttribute('href')
      if (!href || /^(mailto:|tel:|https?:|#)/.test(href)) return
      if (href.indexOf('?') === -1) a.setAttribute('href', href + '?' + forward)
      else a.setAttribute('href', href + '&' + forward)
    })
  }
})()
