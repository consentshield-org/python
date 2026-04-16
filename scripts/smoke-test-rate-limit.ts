import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { checkRateLimit } = await import('../src/lib/rights/rate-limit')
  const key = `smoke:${Date.now()}`
  const results: { i: number; allowed: boolean; retry: number }[] = []

  for (let i = 1; i <= 7; i++) {
    const r = await checkRateLimit(key, 5, 1)
    results.push({ i, allowed: r.allowed, retry: r.retryInSeconds })
  }

  console.table(results)

  const denied = results.filter((r) => !r.allowed)
  const allowed = results.filter((r) => r.allowed)

  if (allowed.length === 5 && denied.length === 2 && denied[0].retry > 0) {
    console.log('\n[PASS] 5 allowed, 2 denied, Retry-After > 0')
    process.exit(0)
  }
  console.error('\n[FAIL] unexpected results')
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
