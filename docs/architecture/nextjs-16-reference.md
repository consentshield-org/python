# Next.js 16 — Project Reference

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
*Reference for ConsentShield development · April 2026*

---

## 1. proxy.ts Replaces middleware.ts

The single biggest rename in Next.js 16.

- `middleware.ts` → `proxy.ts`
- Export `middleware` → export `proxy` (named or default)
- **Runs on Node.js runtime** (not Edge). Edge runtime is NOT supported in proxy.ts.
- Config: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`
- File location unchanged: project root or `src/` directory
- `config.matcher` pattern works identically

**For ConsentShield:** Use `proxy.ts` for route protection (redirect unauthenticated users away from dashboard routes). Session refresh via Supabase SSR client works natively on Node.js — no Edge runtime workarounds needed.

---

## 2. Breaking Changes from Next.js 14/15

### Async Request APIs (Fully Enforced)

Next.js 15 deprecated sync access. **Next.js 16 removes it entirely.** These must be awaited:

```typescript
const cookieStore = await cookies()
const headerList = await headers()
const { orgId } = await params
const { page } = await searchParams
const draft = await draftMode()
```

### Removed Features

| Removed | Replacement |
|---------|-------------|
| `next lint` command | Run ESLint directly (`eslint src/`) |
| `serverRuntimeConfig` / `publicRuntimeConfig` | `.env` files + `process.env` |
| `experimental.turbopack` config | Top-level `turbopack` key |
| `experimental.dynamicIO` / `experimental.ppr` | `cacheComponents` |
| AMP support | Removed entirely |
| `eslint` key in next.config | Removed |
| Build output size/First Load JS metrics | Use Lighthouse/Vercel Analytics |

### Behavior Changes

| Change | Detail |
|--------|--------|
| **Default bundler = Turbopack** | Webpack opt-in via `--webpack` flag |
| **Caching is opt-in** | All dynamic code runs at request time by default |
| **`revalidateTag()` signature** | Now requires second argument: `revalidateTag('tag', 'max')` |
| **Parallel routes** | All slots require explicit `default.js` files |
| **ESLint** | Defaults to Flat Config format (ESLint 9) |
| **Dev output directory** | `.next/dev` (separate from build's `.next/`) |

### Version Requirements

- **Node.js 20.9+** (Node 18 dropped)
- **TypeScript 5.1+**

---

## 3. Caching Model — Opt-In via "use cache"

**Old model (Next.js 14):** Implicit caching. Pages statically cached by default. Opt out with `dynamic = 'force-dynamic'`.

**New model (Next.js 16):** All dynamic code runs at request time by default. Caching is opt-in.

Enable:
```typescript
// next.config.ts
const nextConfig = {
  cacheComponents: true,
}
```

Usage:
```typescript
async function getProducts() {
  "use cache"
  return db.products.findMany()
}
```

Cache variants:
- `"use cache"` — standard server-side cache
- `"use cache: remote"` — shared across server instances
- `"use cache: private"` — browser memory only, can access cookies/headers

Cache lifecycle:
- `cacheLife('max')` — set cache duration
- `cacheTag('tag')` — tag for invalidation
- `revalidateTag('tag', 'max')` — SWR invalidation (requires second arg)

**For ConsentShield:** Dashboard pages showing buffer table data must be dynamic (the default). Use `"use cache"` only for static content: sector templates, tracker signatures, documentation pages. Never cache compliance-critical real-time views.

---

## 4. Build System

- **Turbopack is default.** 2-5x faster builds, up to 10x faster Fast Refresh.
- **Webpack is opt-in:** `next build --webpack` or `next dev --webpack`
- **Custom webpack config in next.config fails with Turbopack by default.**
- **Concurrent dev/build** via separate output directories.
- **Lockfile** prevents multiple instances on same project.

---

## 5. Tailwind CSS v4

Tailwind v4 ships with the latest create-next-app:

- **CSS-first configuration:** No more `tailwind.config.js`. Use `@theme` directive in CSS.
- **Single import:** `@import "tailwindcss"` replaces three `@tailwind` directives.
- **Automatic content detection:** No `content` globs needed.
- **PostCSS:** Uses `@tailwindcss/postcss` package.
- **Rust engine:** Up to 5x faster builds.

---

## 6. next.config.ts Changes

```typescript
// next.config.ts for Next.js 16
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Turbopack config (was experimental.turbopack)
  turbopack: {},

  // Cache components (replaces experimental.dynamicIO and experimental.ppr)
  // cacheComponents: true,

  // Proxy URL normalization (was skipMiddlewareUrlNormalize)
  // skipProxyUrlNormalize: true,

  // React Compiler (was experimental.reactCompiler)
  // reactCompiler: true,
}

export default nextConfig
```

---

## 7. Impact on ConsentShield Architecture

| Area | What to do |
|------|-----------|
| **Route protection** | Use `proxy.ts` (not middleware.ts) for auth redirects |
| **Supabase SSR** | Works natively in proxy.ts (Node.js runtime) |
| **All page/layout params** | Must `await params`, `await searchParams`, `await cookies()` |
| **Linting** | Run `eslint src/` directly (no `next lint`) |
| **Dashboard views** | Dynamic by default (correct for real-time buffer data) |
| **Static content** | Use `"use cache"` selectively for templates/reference data |
| **Bundler** | Turbopack default. No custom webpack config needed. |
| **ESLint config** | Flat config format (`eslint.config.mjs`) |
| **Tailwind** | v4 CSS-first config, `@tailwindcss/postcss` |

---

*Sources: nextjs.org/blog/next-16, nextjs.org/docs/app/guides/upgrading/version-16, nextjs.org/docs/app/getting-started/proxy, tailwindcss.com/docs/upgrade-guide*
