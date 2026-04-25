import { test as base, type APIRequestContext } from '@playwright/test'
import { traceId } from './trace-id'
import { readEnv, type E2eEnv } from './env'

// Sprint 1.1 baseline fixtures + Sprint 1.2 vertical fixtures.
// Sprint 1.3 (Worker harness) and Sprint 1.4 (evidence writer) extend this
// file in place.

export type VerticalSlug = 'ecommerce' | 'healthcare' | 'bfsi'

export interface WebPropertyFixture {
  id: string
  url: string
  signingSecret: string
  bannerId: string
}

export interface VerticalFixture {
  slug: VerticalSlug
  accountId: string
  orgId: string
  userId: string
  userEmail: string
  userPassword: string
  propertyIds: string[]
  propertyUrls: string[]
  properties: WebPropertyFixture[]
  apiKey: string
  apiKeyId: string
}

interface E2eFixtures {
  env: E2eEnv
  traceId: string
  tracedRequest: APIRequestContext
  ecommerce: VerticalFixture
  healthcare: VerticalFixture
  bfsi: VerticalFixture
}

function readVerticalFromEnv(slug: VerticalSlug, prefix: string): VerticalFixture {
  const required = [
    `FIXTURE_${prefix}_ACCOUNT_ID`,
    `FIXTURE_${prefix}_ORG_ID`,
    `FIXTURE_${prefix}_USER_ID`,
    `FIXTURE_${prefix}_USER_EMAIL`,
    `FIXTURE_${prefix}_USER_PASSWORD`,
    `TEST_API_KEY_${prefix}`,
    `TEST_API_KEY_${prefix}_ID`
  ]
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(
      `Vertical fixture ${slug} missing env keys: ${missing.join(', ')}. ` +
        `Run \`bunx tsx scripts/e2e-bootstrap.ts\` to seed.`
    )
  }
  const properties: WebPropertyFixture[] = []
  for (let i = 1; i <= 3; i++) {
    const id = process.env[`FIXTURE_${prefix}_PROPERTY_${i}_ID`]
    const url = process.env[`FIXTURE_${prefix}_PROPERTY_${i}_URL`]
    const signingSecret = process.env[`FIXTURE_${prefix}_PROPERTY_${i}_SECRET`]
    const bannerId = process.env[`FIXTURE_${prefix}_PROPERTY_${i}_BANNER_ID`]
    if (id && url && signingSecret && bannerId) {
      properties.push({ id, url, signingSecret, bannerId })
    }
  }
  return {
    slug,
    accountId: process.env[`FIXTURE_${prefix}_ACCOUNT_ID`]!,
    orgId: process.env[`FIXTURE_${prefix}_ORG_ID`]!,
    userId: process.env[`FIXTURE_${prefix}_USER_ID`]!,
    userEmail: process.env[`FIXTURE_${prefix}_USER_EMAIL`]!,
    userPassword: process.env[`FIXTURE_${prefix}_USER_PASSWORD`]!,
    propertyIds: properties.map((p) => p.id),
    propertyUrls: properties.map((p) => p.url),
    properties,
    apiKey: process.env[`TEST_API_KEY_${prefix}`]!,
    apiKeyId: process.env[`TEST_API_KEY_${prefix}_ID`]!
  }
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
  // Both `X-Request-Id` (transport-layer convention) and `X-CS-Trace-Id`
  // (ADR-1014 Sprint 3.2 — pipeline correlation that the Worker writes
  // onto the consent_events row + echoes back in the response header)
  // are set so the test harness can stitch banner → Worker → buffer →
  // delivery → R2 hops by trace id.
  tracedRequest: async ({ playwright, traceId: tid }, use) => {
    const ctx = await playwright.request.newContext({
      extraHTTPHeaders: { 'X-Request-Id': tid, 'X-CS-Trace-Id': tid }
    })
    await use(ctx)
    await ctx.dispose()
  },

  // Vertical fixtures — resolve on access. Tests that don't need a given
  // vertical never trigger its env lookup.
  ecommerce: async ({}, use) => {
    await use(readVerticalFromEnv('ecommerce', 'ECOM'))
  },
  healthcare: async ({}, use) => {
    await use(readVerticalFromEnv('healthcare', 'HEALTH'))
  },
  bfsi: async ({}, use) => {
    await use(readVerticalFromEnv('bfsi', 'BFSI'))
  }
})

export { expect } from '@playwright/test'
