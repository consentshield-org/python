import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './utils/fixtures'
import {
  acceptAll,
  bannerIsDismissed,
  customise,
  getLoadedTrackers,
  openBanner,
  rejectAll,
  type ConsentEventDetail
} from './utils/banner-harness'
import {
  countConsentEventsSince,
  latestConsentEvent
} from './utils/supabase-admin'
import {
  startStaticServer,
  type StaticServerHandle
} from './utils/static-server'

// See specs/demo-matrix.md for the normative spec.
// This file runs 3 verticals × 3 outcomes = 9 cells. Each cell exercises one
// vertical's banner through one user action (accept_all / reject_all /
// customise) and asserts: page event detail, banner dismount, DB buffer row,
// row count delta, and tracker-loading count (non-accepted purposes' trackers
// must not appear in the DOM).

const HERE = dirname(fileURLToPath(import.meta.url))
const TEST_SITES_ROOT = resolve(HERE, '..', '..', 'test-sites')

interface Purpose {
  code: string
  required: boolean
}

interface VerticalSetup {
  slug: 'ecommerce' | 'healthcare' | 'bfsi'
  port: number
  sitePath: string
  purposes: Purpose[]
  // Expected `scripts[data-cs-tracker]` counts per outcome. Derived from each
  // vertical's `test-sites/<slug>/index.html` window.__DEMO_TRACKERS__ dict
  // plus demo.js's `loadFor(['essential'])` pageload call.
  expectedTrackers: { accept_all: number; reject_all: number; customise: number }
}

const VERTICALS: VerticalSetup[] = [
  {
    slug: 'ecommerce',
    port: 4001,
    sitePath: '/ecommerce/',
    purposes: [
      { code: 'essential', required: true },
      { code: 'analytics', required: false },
      { code: 'marketing', required: false }
    ],
    // analytics: 2 (GA + Hotjar), marketing: 1 (Meta Pixel), essential: 0.
    expectedTrackers: { accept_all: 3, reject_all: 0, customise: 2 }
  },
  {
    slug: 'healthcare',
    port: 4002,
    sitePath: '/healthtech/',
    purposes: [
      { code: 'clinical_care', required: true },
      { code: 'research_deidentified', required: false },
      { code: 'marketing_health_optin', required: false }
    ],
    // research_deidentified: 1 (GA), marketing_health_optin: 0, clinical_care: 0.
    expectedTrackers: { accept_all: 1, reject_all: 0, customise: 1 }
  },
  {
    slug: 'bfsi',
    port: 4003,
    sitePath: '/bfsi/',
    purposes: [
      { code: 'kyc_mandatory', required: true },
      { code: 'credit_bureau_share', required: false },
      { code: 'marketing_sms', required: false }
    ],
    // kyc_mandatory: 1 (Razorpay), credit_bureau_share: 1, marketing_sms: 1.
    // reject_all still loads kyc_mandatory's tracker (legal_obligation → always-on).
    expectedTrackers: { accept_all: 3, reject_all: 1, customise: 2 }
  }
]

type Outcome = 'accept_all' | 'reject_all' | 'customise'
const OUTCOMES: Outcome[] = ['accept_all', 'reject_all', 'customise']

for (const v of VERTICALS) {
  test.describe(`@matrix @browser @${v.slug}`, () => {
    let server: StaticServerHandle | null = null

    test.beforeAll(async () => {
      server = await startStaticServer(TEST_SITES_ROOT, { port: v.port })
    })

    test.afterAll(async () => {
      if (server) await server.stop()
    })

    for (const outcome of OUTCOMES) {
      test(`${v.slug} × ${outcome}`, async (
        { ecommerce, healthcare, bfsi, page },
        testInfo
      ) => {
        const workerUrl = process.env.WORKER_URL
        if (!workerUrl) {
          test.skip(
            true,
            'WORKER_URL env not set. Start `cd worker && bun run dev` first (see specs/demo-matrix.md §8 for the two runtime-green blockers).'
          )
          return
        }
        if (!server) throw new Error('static server did not start')

        const fixture = { ecommerce, healthcare, bfsi }[v.slug]
        // Property[2] (Sandbox probe) has the tightest `allowed_origins` —
        // localhost:<port> only — so no other matrix cell can see these rows.
        const property = fixture.properties[2]
        expect(
          property,
          `${v.slug} fixture missing properties[2] (Sandbox probe)`
        ).toBeTruthy()

        const cutoffIso = new Date().toISOString()
        const url = `${server.url}${v.sitePath}`

        // Network + console evidence.
        const networkLog: string[] = []
        page.on('response', (resp) => {
          if (resp.url().includes('/v1/')) {
            networkLog.push(`← ${resp.status()} ${resp.url()}`)
          }
        })
        page.on('requestfailed', (req) => {
          if (req.url().includes('/v1/')) {
            networkLog.push(
              `✗ ${req.method()} ${req.url()} — ${req.failure()?.errorText}`
            )
          }
        })

        await openBanner(page, {
          url,
          cdn: workerUrl,
          orgId: fixture.orgId,
          propertyId: property.id
        })

        const required = v.purposes.filter((p) => p.required).map((p) => p.code)
        const optional = v.purposes
          .filter((p) => !p.required)
          .map((p) => p.code)
        const [firstOptional, secondOptional] = optional

        let ev: ConsentEventDetail
        let expectedAccepted: string[]
        let expectedRejected: string[]

        if (outcome === 'accept_all') {
          ev = await acceptAll(page)
          expectedAccepted = v.purposes.map((p) => p.code)
          expectedRejected = []
        } else if (outcome === 'reject_all') {
          ev = await rejectAll(page)
          expectedAccepted = required
          expectedRejected = optional
        } else {
          ev = await customise(page, { acceptNames: [firstOptional] })
          expectedAccepted = [...required, firstOptional]
          expectedRejected = [secondOptional]
        }

        await testInfo.attach(`${v.slug}-${outcome}-consent-event.json`, {
          body: JSON.stringify(ev, null, 2),
          contentType: 'application/json'
        })

        expect(new Set(ev.accepted)).toEqual(new Set(expectedAccepted))
        expect(new Set(ev.rejected)).toEqual(new Set(expectedRejected))

        // Banner dismount after any outcome.
        expect(await bannerIsDismissed(page)).toBe(true)

        // Let keepalive:false POST flush + DB to catch up.
        await new Promise((r) => setTimeout(r, 1_000))

        let observed: Awaited<ReturnType<typeof latestConsentEvent>> = null
        for (let i = 0; i < 10; i++) {
          observed = await latestConsentEvent(property.id, cutoffIso)
          if (observed) break
          await new Promise((r) => setTimeout(r, 500))
        }

        await testInfo.attach(`${v.slug}-${outcome}-network.log`, {
          body: networkLog.length
            ? networkLog.join('\n')
            : '(no /v1/* requests observed)',
          contentType: 'text/plain'
        })

        expect(observed, 'no consent_events row observed').not.toBeNull()
        expect(observed!.org_id).toBe(fixture.orgId)
        expect(observed!.property_id).toBe(property.id)
        expect(observed!.banner_id).toBe(property.bannerId)
        expect(observed!.event_type).toBe(ev.event_type)
        expect(observed!.origin_verified).toBe('origin-only')

        await testInfo.attach(`${v.slug}-${outcome}-observed-row.json`, {
          body: JSON.stringify(observed, null, 2),
          contentType: 'application/json'
        })

        const count = await countConsentEventsSince(property.id, cutoffIso)
        expect(count, 'expected exactly 1 consent_events row since cutoff').toBe(
          1
        )

        // Tracker-loading assertion — spec §4 proofs #6 + #7 in one check.
        const trackers = await getLoadedTrackers(page)
        await testInfo.attach(`${v.slug}-${outcome}-loaded-trackers.json`, {
          body: JSON.stringify(trackers, null, 2),
          contentType: 'application/json'
        })
        expect(
          trackers.length,
          `${v.slug} × ${outcome}: expected ${v.expectedTrackers[outcome]} tracker(s), got ${trackers.length}`
        ).toBe(v.expectedTrackers[outcome])
      })
    }
  })
}
