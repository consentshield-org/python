import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'

config({ path: '.env.local' })

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    include: [
      'tests/rls/**/*.test.ts',
      'tests/admin/**/*.test.ts',
      'tests/depa/**/*.test.ts',
      'tests/rbac/**/*.test.ts',
      'tests/billing/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    // Serialise test files. Parallel execution across 7+ files fires
    // enough concurrent Supabase auth.admin.createUser calls to trip
    // the "Request rate limit reached" / "Database error creating new
    // user" throttles. The real bottleneck is Supabase-side, not test
    // correctness — serial execution costs a few seconds and removes
    // the flaky failure mode.
    fileParallelism: false,
  },
})
