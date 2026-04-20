# Changelog — Marketing

Public marketing site (`marketing/` workspace → `consentshield.in`). New in 2026-04-21.

## [ADR-0501 Sprint 2.2] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 2 Sprint 2.2 — Home body + Product page (full content)

### Added
- `marketing/src/components/sections/` — new directory holding composable page sections.
  - `cta-band.tsx` — reusable CTA band. Takes `eyebrow`, `title`, `body`, and action children. Used by home + product (DEPA will reuse in 2.3).
  - `home-hero.tsx` — hero extracted from `page.tsx` so home composes cleanly from named section components.
  - `contrast.tsx` — documentation-vs-enforcement 2-up grid (home).
  - `story.tsx` — Collect / Enforce / Prove 3-card grid with SVG icons; internal `StoryCard` helper (home).
  - `depa-moat.tsx` — 5-principle dark-navy section (home).
  - `timeline.tsx` — 3 enforcement-clock cards (home).
  - `pricing-preview.tsx` — 4-tier pricing grid; `featured` variant flag; `Link`-based CTAs (home).
  - `capability-layer.tsx` — reusable product-page building block; accepts `tag`, `title`, `lede`, and a typed `Feature[]`.
  - `arch-promo.tsx` — Architecture Brief promo card. PDF primary CTA; DOCX + MD as secondary links; reads paths from `DOWNLOAD_BRIEF` constants in `src/lib/routes.ts`.
- `marketing/src/app/page.tsx` — composes HomeHero + Contrast + Story + DepaMoat + Timeline + PricingPreview + CtaBand.
- `marketing/src/app/product/page.tsx` — full content: product hero + 4 `CapabilityLayer` blocks (24 features total as typed inlined arrays) + ArchPromo + CtaBand.

### Tested
- [x] `cd marketing && bun run build` — 12 static routes; clean.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

## [ADR-0501 Sprint 2.1] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 2 Sprint 2.1 — Foundations (downloads + chrome + globals + route skeleton)

### Added
- `marketing/public/downloads/ConsentShield-Architecture-Brief.{pdf,docx,md}` — three-format content package, copied from `docs/design/screen designs and ux/marketing-site/`. MD renamed from `architecture-brief.md` to match the PDF/DOCX stem.
- `marketing/public/brand/*.svg` (12 files) + `marketing/src/app/favicon.ico` + `marketing/src/app/icon.svg` — mirrored from `admin/public/brand/` and `admin/src/app/` so the two surfaces share the same brand identity.
- `marketing/src/lib/routes.ts` — route enum, nav-link list, `DOWNLOAD_BRIEF` constants.
- `marketing/src/components/logo.tsx` — inlined shield + "ConsentShield" wordmark SVG matching HTML spec; `variant="light" | "dark"` for nav vs. footer.
- `marketing/src/components/nav.tsx` — client component; sticky; scroll-shadow via `window.scrollY`; active-link derived from `usePathname()` (replaces the HTML's data-nav JS).
- `marketing/src/components/footer.tsx` — 5-column server component; all `data-nav` jumps swapped for `<Link>`; Architecture Brief PDF download link.
- `marketing/src/app/globals.css` — **full CSS port (~714 lines)** from the HTML spec's `<style>` block. Class names preserved verbatim so HTML ↔ React drift stays grep-able. `:root` typography aliases point to next/font CSS vars.
- `marketing/src/app/layout.tsx` — DM Sans + JetBrains Mono via `next/font/google`; Satoshi via Fontshare CDN; wraps children in `<Nav/>` + `<Footer/>`.
- `marketing/src/app/page.tsx` — home route with hero section only.
- `marketing/src/app/{product,depa,solutions,pricing,contact,terms,privacy,dpa}/page.tsx` — 8 stub routes; each has per-page metadata + a hero + "Content ships in Sprint 2.x" marker. Every nav link now resolves to a real page.

### Changed
- `marketing/src/app/layout.tsx` — swapped DM_Mono → JetBrains_Mono to match the HTML spec's `--mono` font.

### Removed
- `marketing/public/downloads/.gitkeep` — replaced by the three real download files.

### Tested
- [x] `cd marketing && bun run build` — 12 routes static; clean. Turbopack cold build 1.4s.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

### Deferred (ADR-0501)
- Sprints 2.2–2.5: page body ports.
- Phase 3: PDF/DOCX/MD generation pipeline (content for Architecture Brief is delivered manually for now; per-page downloadable packets come later).
- Phase 4: security hardening.

## [ADR-0501 Sprint 1.1] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site (`marketing/`)
**Sprint:** Sprint 1.1 — Scaffold

### Added
- `marketing/` — Bun workspace sibling of `app/` + `admin/` + `worker/`. Next.js 16.2.3 + React 19.2.5 + TypeScript 5.9.3 + Tailwind v4.2.2 + ESLint 9.39.4. Exact-pinned; no Sentry / no Supabase / no secrets wired.
- `marketing/package.json` — `@consentshield/marketing`; `dev` on port 3002; mirrors admin workspace scripts except the env-isolation prebuild (marketing has no secrets to isolate).
- `marketing/next.config.ts` — minimal; deliberately no `noindex` header (marketing is the one public surface).
- `marketing/src/app/layout.tsx` — DM Sans + DM Mono next/font; Satoshi wordmark stylesheet link; indexable metadata (title, description, Open Graph).
- `marketing/src/app/page.tsx` — placeholder landing explaining the scaffold. Replaced in Phase 2 when user-authored HTML lands.
- `marketing/src/app/globals.css` — Tailwind v4 `@import` + reserved `@theme` block for brand tokens.
- `marketing/src/app/robots.ts` — fully crawlable; sitemap reference at `https://consentshield.in/sitemap.xml`.
- `marketing/public/downloads/.gitkeep` — placeholder for Phase 3 PDF / DOCX / Markdown artefacts.
- `marketing/tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `vercel.json`, `.gitignore` — mirror the admin workspace layout.

### Changed
- Root `package.json` — `workspaces` array adds `"marketing"` between `admin` and `worker`.
- `docs/ADRs/ADR-index.md` — new entry for ADR-0501; added a comment block documenting the reserved ADR number ranges now that the 500-series opens.

### Tested
- [x] `bun install` at repo root — clean; 828 installs across 1029 packages; no hoist conflicts.
- [x] `cd marketing && bun run build` — clean; 4 static routes (`/`, `/_not-found`, `/robots.txt`, types); Turbopack; 1.3s cold.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

### Deferred (explicit, per ADR-0501)
- Phase 2 — content. Awaits user-authored HTML.
- Phase 3 — PDF / DOCX / MD download pipeline. Tooling (pandoc vs `pdfkit` + `html-to-docx`) decided once Phase 2 is stable.
- Phase 4 — security hardening (CSP, HSTS, Turnstile, Sentry PII strip, BotID, env-isolation prebuild). Deferred per user direction.
