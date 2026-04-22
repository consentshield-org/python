import { test as base, type APIRequestContext } from '@playwright/test'
import { traceId } from './trace-id'
import { readEnv, type E2eEnv } from './env'

// Sprint 1.1 baseline fixtures. Sprint 1.2 (Supabase bootstrap) and
// Sprint 1.3 (Worker harness) will extend this file with org/key/worker
// fixtures. Sprint 1.4 wires the evidence writer in.

interface E2eFixtures {
  env: E2eEnv
  traceId: string
  tracedRequest: APIRequestContext
}

export const test = base.extend<E2eFixtures>({
  env: async ({}, use) => {
    await use(readEnv())
  },

  traceId: async ({}, use, testInfo) => {
    const id = traceId(`e2e-${testInfo.project.name}`)
    await testInfo.attach('trace-id.txt', { body: id, contentType: 'text/plain' })
    await use(id)
  },

  // A request context that stamps every outbound call with the trace id.
  tracedRequest: async ({ playwright, traceId: tid }, use) => {
    const ctx = await playwright.request.newContext({
      extraHTTPHeaders: { 'X-Request-Id': tid }
    })
    await use(ctx)
    await ctx.dispose()
  }
})

export { expect } from '@playwright/test'
