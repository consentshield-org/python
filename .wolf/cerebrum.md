# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: —

## User Preferences

- **No AI authorship attribution anywhere.** No commit Co-Authored-By, no "AI-assisted" claims, no tool credits in docs/code/comments. All work is (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com. References to Claude API/Anthropic API as technology choices are fine — only authorship claims are prohibited.
- **User prefers working files archived in .claude/working/** to keep project root clean.

## Key Learnings

- **Next.js 16 uses `proxy.ts` not `middleware.ts`.** The proxy runs on Node.js runtime (not Edge). Export `proxy` not `middleware`. See docs/architecture/nextjs-16-reference.md.
- **All request APIs must be awaited in Next 16.** `await cookies()`, `await headers()`, `await params`, `await searchParams`. Sync access removed entirely.
- **`next lint` does not exist in Next 16.** Run `eslint src/` directly. The package.json script already accounts for this.
- **Caching is opt-in in Next 16.** Pages are dynamic by default. Use `"use cache"` directive only for static content. Good for ConsentShield's real-time buffer data views.
- **Tailwind v4 is CSS-first.** No `tailwind.config.js`. Uses `@theme` in CSS and `@tailwindcss/postcss`.
- **ESLint 9 flat config.** Uses `eslint.config.mjs`, not `.eslintrc.json`.
- **Every package must be latest with security patches, exact-pinned.** No `^`, no `~`. Check versions before adding any dependency.
- **Supabase hosted: `gen_random_bytes()` lives in `extensions` schema.** Must qualify as `extensions.gen_random_bytes()` in all migrations. Same applies to other pgcrypto functions.
- **Use pooler connection string for psql queries.** Direct DB hostname doesn't resolve from local. Use `postgresql://postgres.xlqiakmkdjycfiioslgs:PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`.

## Do-Not-Repeat

[2026-04-13] Initially scaffolded with Next.js 14 (from CLAUDE.md) instead of checking the current major version (16). Always verify current versions of all tools before scaffolding. The user corrected this — latest stable with all security patches is the rule.

[2026-04-13] Over-eagerly replaced "Anthropic API" technology references when the user only wanted authorship attribution removed. Technology references (Claude API, Anthropic API) are fine. Only authorship/credit claims (Co-Authored-By, "AI-assisted", "Claude writes") must be removed.

## Decision Log

[2026-04-13] **Next.js 16 over 14.** CLAUDE.md originally specified Next.js 14 but the current major version is 16. Updated to 16.2.3 (latest stable). React 19.2.5. All packages pinned to latest with security patches as of 2026-04-13.
