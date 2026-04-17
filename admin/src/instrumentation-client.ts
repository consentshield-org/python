// Sentry client-side init for the admin app. Runs on every page load.
// Reads the DSN from a NEXT_PUBLIC_ env var so it can differ by
// environment (production / preview / dev) without being hardcoded.
// DSNs are public by design (they end up in the browser bundle), so
// NEXT_PUBLIC_ is correct.
//
// Rule 17 compliance: beforeSend strips request headers, cookies, body,
// and query string so Sentry never sees PII or auth material from the
// admin console.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_ADMIN

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.2,
  sendDefaultPii: false,
  enableLogs: false,

  beforeSend(event) {
    if (event.request) {
      delete event.request.headers
      delete event.request.cookies
      delete event.request.data
      delete event.request.query_string
    }
    return event
  },

  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === 'http' && breadcrumb.data) {
      delete breadcrumb.data.request_body
      delete breadcrumb.data.response_body
    }
    return breadcrumb
  },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
