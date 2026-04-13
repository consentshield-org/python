import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,

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
    if (breadcrumb.category === 'http') {
      if (breadcrumb.data) {
        delete breadcrumb.data.request_body
        delete breadcrumb.data.response_body
      }
    }
    return breadcrumb
  },
})
