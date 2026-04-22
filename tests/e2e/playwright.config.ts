import { defineConfig, devices } from '@playwright/test'
import { loadE2eEnv } from './utils/env'

loadE2eEnv()

const IS_NIGHTLY = process.env.PLAYWRIGHT_NIGHTLY === '1'
const IS_PARTNER = process.env.PLAYWRIGHT_PARTNER === '1'
const IS_CI = process.env.CI === 'true' || process.env.CI === '1'

const baseProjects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] }
  },
  {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] }
  }
]

const nightlyProjects = [
  {
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] }
  }
]

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  testIgnore: ['**/node_modules/**', '**/.tsbuild/**'],

  // Fail the build on test.only left behind.
  forbidOnly: IS_CI,

  // No retries on PR runs — flakes must be diagnosed, not masked.
  // Nightly retries once for browser-flake tolerance.
  retries: IS_NIGHTLY ? 1 : 0,

  // Reasonable parallelism; serial within a file by default (tests share fixtures).
  fullyParallel: false,
  workers: IS_CI ? 2 : undefined,

  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],

  outputDir: 'test-results/artifacts',

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: IS_NIGHTLY ? 'retain-on-failure' : 'off',
    // Every test sets its own X-Request-Id header via fixtures.
    extraHTTPHeaders: {
      'X-E2E-Run': process.env.E2E_RUN_ID ?? 'local'
    }
  },

  // Projects: PR runs chromium+webkit; nightly adds firefox.
  projects: IS_NIGHTLY ? [...baseProjects, ...nightlyProjects] : baseProjects,

  // Partner mode surfaces explicit context about which env is being exercised.
  metadata: {
    commitSha: process.env.GIT_COMMIT_SHA ?? 'local',
    runId: process.env.E2E_RUN_ID ?? 'local',
    partner: IS_PARTNER,
    nightly: IS_NIGHTLY
  }
})
