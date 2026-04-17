// Sentry init for Next.js edge runtime (middleware, edge routes).
// Loaded by admin/src/instrumentation.ts when NEXT_RUNTIME === 'edge'.
//
// Rule 17 scrubbing mirrors the client + server configs.

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
