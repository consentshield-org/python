# ADR-0501 — ConsentShield marketing site (`marketing/`)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress (Phases 1 + 2 + 3 complete 2026-04-21; Phase 4 pending)
**Date:** 2026-04-21
**Phases:** 4
**Sprints:** 4+ (Phase 1 has one sprint; later phases sized once content + formats land)

**Depends on:** ADR-0026 (Bun workspace monorepo; `app/` + `admin/` + `worker/` siblings).

## Context

The customer app (`app/`) and admin console (`admin/`) are both authed surfaces and are `noindex, nofollow`. ConsentShield needs a public marketing surface — `consentshield.in` — that is:

- Fully indexable (sitemap, canonical URLs, Open Graph, structured data)
- Independently deployable on Vercel (separate project from customer + admin)
- Built on the same stack the rest of the repo already uses (Next.js 16 + TypeScript + Tailwind v4 + shadcn-ready)
- Carrying a multi-format download pipeline — each content page produces PDF, DOCX, and Markdown artefacts of the same content, linkable from the page

The 500-series ADR slot is reserved for the marketing site so admin (0026–0057), compliance / public-API (1001+), and marketing don't collide. ADR-0501 kicks off the series.

## Decision

Add a fourth Next.js workspace at `marketing/` as a sibling of `app/` + `admin/` + `worker/`. The workspace mirrors the admin project's stack discipline (exact version pinning, Tailwind v4 via `@tailwindcss/postcss`, DM Sans + DM Mono fonts, ESLint 9 flat config, TypeScript 5.9). No Sentry and no Supabase wiring yet — the Phase 1 scaffold is a static public surface with no client-side secrets and no runtime data dependency.

Content, downloads, and security hardening all land as explicit later phases. The rationale for splitting those out of scaffold:

1. **Content (Phase 2):** the user authors the HTML directly and hands it over page-by-page. Each HTML file gets translated to a typed Next.js route. Wireframes-before-ADRs (feedback memory) is satisfied by the authored HTML acting as the visual spec.
2. **Downloads (Phase 3):** the same page content is also emitted as PDF, DOCX, and MD. The generation pipeline (build-time vs on-demand, pandoc vs pdfkit vs html-to-docx) is a design decision that deserves its own sprint.
3. **Security (Phase 4):** CSP / HSTS / strict cookies / Turnstile on any interactive forms / Sentry PII strip are explicitly deferred per user direction. Phase 1 ships with Vercel defaults only.

### Why `marketing/` and not a subdomain of `app/`

Three reasons:

- **Crawl policy diverges.** Customer app is `noindex` site-wide; marketing must be indexable. Keeping them in one Next.js project forces conditional per-route robots headers — fragile.
- **Cookie / session scope diverges.** Marketing needs no session; customer app needs Supabase cookies. Separate origins = cleaner cookie scoping.
- **Release cadence diverges.** Marketing copy changes daily in campaign seasons; customer app ships only on ADR close-out. Independent deploy units = independent blast radius.

### Ports + domains

| Workspace | Local port | Production domain |
|-----------|-----------|-------------------|
| `app/` | 3000 | `app.consentshield.in` (TBD by ADR-0054 cutover) |
| `admin/` | 3001 | `admin.consentshield.in` |
| `marketing/` | 3002 | `consentshield.in` + `www.consentshield.in` |

## Implementation

### Phase 1 — Scaffold (sprint 1.1)

Ship a clean, buildable, lintable, indexable empty shell. No real content.

**Deliverables:**

- [x] `marketing/package.json` — `@consentshield/marketing`, exact-pinned versions matching `admin/package.json` (next 16.2.3, react 19.2.5, tailwindcss 4.2.2, typescript 5.9.3, eslint 9.39.4, eslint-config-next 16.2.3). No Sentry, no Supabase, no pdfkit yet.
- [x] `marketing/next.config.ts` — minimal, indexable (no `X-Robots-Tag: noindex` header like admin has).
- [x] `marketing/tsconfig.json` — extends `../tsconfig.base.json`, `@/*` → `./src/*`.
- [x] `marketing/postcss.config.mjs` — Tailwind v4 PostCSS plugin.
- [x] `marketing/eslint.config.mjs` — mirror `admin/eslint.config.mjs`.
- [x] `marketing/vercel.json` — placeholder for the Vercel project.
- [x] `marketing/.gitignore` — `.next/`, `.vercel/`, `node_modules/`.
- [x] `marketing/src/app/layout.tsx` — DM Sans + DM Mono; indexable metadata; ConsentShield wordmark stylesheet link (Satoshi).
- [x] `marketing/src/app/page.tsx` — placeholder landing with a one-line scaffold-complete notice. Replaced when HTML lands.
- [x] `marketing/src/app/globals.css` — `@import "tailwindcss"` + reserved `@theme` block for brand tokens.
- [x] `marketing/src/app/robots.ts` — public, crawlable; sitemap reference stub.
- [x] `marketing/public/downloads/.gitkeep` — reserved for Phase 3 artefacts.
- [x] Root `package.json` — `workspaces` array adds `"marketing"`.
- [x] `bun install` at repo root — 828 installs across 1029 packages, no hoisting conflicts.
- [x] `cd marketing && bun run build` — clean; 4 static routes (`/`, `/_not-found`, `/robots.txt`, types). Turbopack; cold build 1.3s.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

**Status:** `[x] complete — 2026-04-21`

### Test Results

- `bun install` — Saved lockfile; 828 installs across 1029 packages; no changes.
- `cd marketing && bun run build` — ✓ Compiled successfully in 1306ms; TypeScript clean; 4 static routes generated.
- `cd marketing && bun run lint` — clean.
- `cd marketing && bun run dev --port 3002` — not yet run in this sprint; manual smoke scheduled alongside first HTML drop.

### Phase 2 — Content

User-authored HTML spec: `docs/design/screen designs and ux/marketing-site/consentshield-site-v2.html` (3052 lines, single-file SPA). Content is decomposed into one `src/app/<slug>/page.tsx` per in-doc page; shared layout chrome lifts into `src/components/`. The HTML is the normative spec; drift is recorded in an alignment note (TBD) under `docs/marketing/design/`.

Sprint breakdown:

#### Sprint 2.1 — Foundations (shipped 2026-04-21)

**Deliverables:**

- [x] Copy `ConsentShield-Architecture-Brief.pdf` + `.docx` + `.md` into `marketing/public/downloads/` (MD renamed for consistent stem across formats).
- [x] Mirror admin brand kit (12 SVGs) into `marketing/public/brand/`; `favicon.ico` + `icon.svg` mirrored to `marketing/src/app/` so Next.js App Router auto-serves them.
- [x] `marketing/src/app/globals.css` — full CSS port (~714 lines) from the HTML's `<style>` block. Class names preserved verbatim; `:root` typography aliases point to next/font CSS vars (`--font-dm-sans`, `--font-jetbrains-mono`).
- [x] `marketing/src/lib/routes.ts` — route enum + nav-link list + download-brief path constants.
- [x] `marketing/src/components/logo.tsx` — shield SVG + wordmark; light/dark variant.
- [x] `marketing/src/components/nav.tsx` — sticky, scroll-shadow client component; active-link state via `usePathname()`; replaces the HTML's data-nav click handler.
- [x] `marketing/src/components/footer.tsx` — 5-column server component with `<Link>` navigation + Architecture Brief download.
- [x] `marketing/src/app/layout.tsx` — swaps DM_Mono → JetBrains_Mono to match spec; wraps children in `<Nav/>` + `<Footer/>`.
- [x] `marketing/src/app/page.tsx` — home; hero section only (remaining sections land in 2.2).
- [x] 8 stub routes: `/product`, `/depa`, `/solutions`, `/pricing`, `/contact`, `/terms`, `/privacy`, `/dpa`. Each renders a hero with per-page metadata + a "Content ships in Sprint 2.x" placeholder. Every nav link now resolves.
- [x] `cd marketing && bun run build` — 12 static routes + `/icon.svg` + `/robots.txt`. 1.4s cold.
- [x] `cd marketing && bun run lint` — clean.

**Status:** `[x] complete — 2026-04-21`

#### Sprint 2.2 — Home + Product (shipped 2026-04-21)

**Deliverables:**

- [x] `marketing/src/components/sections/cta-band.tsx` — reusable CTA band; takes eyebrow, title, body, action children. Used on home, product, depa pages.
- [x] `marketing/src/components/sections/home-hero.tsx` — hero extracted from page.tsx so home composes cleanly from named section components.
- [x] `marketing/src/components/sections/contrast.tsx` — documentation-vs-enforcement 2-up grid.
- [x] `marketing/src/components/sections/story.tsx` — Collect/Enforce/Prove 3-card grid with SVG icons. `StoryCard` helper collapses the repeat.
- [x] `marketing/src/components/sections/depa-moat.tsx` — 5-principle dark section. Principles array inlined.
- [x] `marketing/src/components/sections/timeline.tsx` — 3 enforcement-clock cards. Entries array inlined.
- [x] `marketing/src/components/sections/pricing-preview.tsx` — 4-tier pricing grid. Tiers array inlined; `featured` variant flag; Link-based CTAs.
- [x] `marketing/src/components/sections/capability-layer.tsx` — reusable product-page building block. Takes tag, title, lede, features array. Each feature = name + description.
- [x] `marketing/src/components/sections/arch-promo.tsx` — Architecture Brief promo card. PDF primary CTA; DOCX + MD as secondary links. Uses `DOWNLOAD_BRIEF` constants from `src/lib/routes.ts`.
- [x] `marketing/src/app/page.tsx` — composes HomeHero + Contrast + Story + DepaMoat + Timeline + PricingPreview + CtaBand.
- [x] `marketing/src/app/product/page.tsx` — full content: product hero + 4 `CapabilityLayer` blocks (24 features total, inlined as typed arrays) + ArchPromo + CtaBand.

**Status:** `[x] complete — 2026-04-21`

#### Sprint 2.3 — DEPA + Solutions (shipped 2026-04-21)

**Deliverables:**

- [x] `marketing/src/components/sections/depa-hero.tsx` — hero + inlined 340x340 radial shield SVG with 5 orbiting principle dots (P01–P05).
- [x] `marketing/src/components/sections/depa-compare.tsx` — 7-row capability comparison table (GDPR-adapted vs DEPA-native); rows inlined as typed `Row[]` with rich pos/neg copy.
- [x] `marketing/src/app/depa/page.tsx` — composes DepaHero + DepaCompare + CtaBand with PDF + DOCX + MD download links + PDF size/page-count meta row.
- [x] `marketing/src/components/sections/cta-band.tsx` — extended with optional `meta` slot (DEPA uses it for "PDF · 30 pages · 476 KB" + alternate-format links under the primary action row).
- [x] `marketing/src/components/sections/solutions-tabs.tsx` — client component; renders tab bar + active panel; 5 sectors inlined with full data (tab label, priority, heading, description, 2 stats, 3 features with SVG icons). Active-tab state via `useState`; ARIA roles `tablist` / `tab` / `tabpanel`.
- [x] `marketing/src/app/solutions/page.tsx` — composes sol-hero + SolutionsTabs + CtaBand.

**Status:** `[x] complete — 2026-04-21`

#### Sprint 2.4 — Pricing + Contact + Legal (shipped 2026-04-21)

**Deliverables:**

- [x] `marketing/src/components/sections/price-toggle.tsx` — client Monthly/Annual pill (cosmetic per HTML spec; table shows both ranges in every row).
- [x] `marketing/src/components/sections/price-table.tsx` — 4-column feature grid across 4 groups (Compliance foundation, Enforcement depth, Multi-framework + ecosystem, Enterprise-only). Typed `Row[]` cells accept `'✓'`, `'—'`, or free text; rendered via `PriceCell` helper.
- [x] `marketing/src/components/sections/bfsi-callout.tsx` — specialist track callout with range pricing.
- [x] `marketing/src/app/pricing/page.tsx` — composes PriceHero + PriceToggle + PriceTable + BfsiCallout + add-ons note + CtaBand.
- [x] `marketing/src/components/sections/contact-form.tsx` — client; uncontrolled inputs; preventDefaults on submit and shows acknowledgement state. Real submit wiring (Resend + Turnstile + BotID) deferred to Phase 4.
- [x] `marketing/src/app/contact/page.tsx` — contact-hero with 5 options (Book demo / Partner / CA&Legal / Technical walkthrough / Architecture Brief download link) + contact form.
- [x] `marketing/src/components/sections/legal-layout.tsx` — shared hero + TOC-on-left + article-on-right. Used by terms/privacy/dpa. Auto-numbered section counter inherited from `.legal-content` CSS.
- [x] `marketing/src/app/terms/page.tsx` — full Terms content, 12 sections. All `data-nav` jumps converted to `<Link>`.
- [x] `marketing/src/app/privacy/page.tsx` — full Privacy Policy, 12 sections, grievance officer contact block.
- [x] `marketing/src/components/sections/dpa-signing-card.tsx` — client; Execute Digitally card; uncontrolled inputs + required checkbox; preventDefault + acknowledgement state.
- [x] `marketing/src/app/dpa/page.tsx` — DPA (12 sections + 3 annexes) + divider + EU Addendum (9 sections, with SCC election table) + DpaSigningCard + final CtaBand. Annex 3 sub-processor table + SCC clause table rendered via typed `SubprocRow` / `SccRow` helpers.

**Status:** `[x] complete — 2026-04-21`

#### Sprint 2.5 — How-it-works demo modal (shipped 2026-04-21)

**Deliverables:**

- [x] `marketing/src/components/sections/demo-frames.tsx` — 7 frame function components (Frame1UserArrives → Frame7AuditExport) + `FRAMES` array. Inline styles + `animation-delay` values preserved verbatim from the HTML spec so log-line / artefact / receipt staggered animations replay identically on every frame remount. Small reusable helpers inside: `BrowserBar`, `PurposeRow`, `TrackerRow`, `PrefRow`, `Receipt`, `LogTime`.
- [x] `marketing/src/components/sections/how-it-works-demo.tsx` — client island. Two exports:
  - `HowItWorksDemo` — button trigger rendered inline in the hero CTA row.
  - `DemoModal` — mounted only while open. State: `index` (0–6), `playing` (bool), `tick` (re-run key). Effects: auto-advance (6s setTimeout), progress-fill animation (imperative via `fillRef` — reflow-force + width transition matches the HTML's `showDemoFrame` technique), Escape key close, body scroll lock. Controls: prev / play-pause / next / click-dot. Current frame remounted via `key={index-tick}` so `animation-delay` sequences replay from frame 1 of each log chain.
- [x] `marketing/src/components/sections/home-hero.tsx` — **corrected** to match spec: third CTA "Why DEPA-native matters" added; "See how it works" replaces the Sprint-2.1 placeholder "See the platform" and now triggers the demo; hero-meta corrected to the four items in the HTML spec (Enforcement begins · 13 May 2027 / Per-violation penalty · Up to ₹250 crore / Indian businesses affected · 4,00,000+ / Deploys in · 48 hours) — Sprint 2.1 had invented three different items.

**Status:** `[x] complete — 2026-04-21`

### Phase 3 — Downloadable legal documents (MD / PDF / DOCX)

Scope narrowed on user direction: **legal pages only** (terms, privacy, dpa). Marketing pages are for browsing; only legal artefacts travel offline. Architecture Brief already ships as a manually-authored three-format packet and is out of Phase 3 scope.

**Source of truth + tooling decisions (locked in Sprint 3.1):**

- Content lives in typed TS modules under `marketing/src/content/legal/*.ts` — one `LegalDocument` per legal page. The document is authored *once*; the web renderer and the downloads generator consume the same source. No JSX-extraction, no HTML coupling.
- Inline formatting uses a constrained Markdown subset (`**bold**`, `*em*`, `[text](url)`) parsed by a 40-line `md-inline.ts` shared between the React renderer and the serializers. Zero dependencies.
- Generation happens build-time via a Bun script (`scripts/generate-downloads.ts`) wired into `prebuild`. No Vercel Function budget required.

#### Sprint 3.1 — Structured legal content model (shipped 2026-04-21)

**Deliverables:**

- [x] `marketing/src/content/legal/types.ts` — typed content model: `LegalBlock` (h3 / p / ul / note / contact / subprocTable / sccTable), `LegalSection`, `LegalDocument` with optional `intro` and `addendum`.
- [x] `marketing/src/content/legal/md-inline.ts` — 40-line inline MD parser + React renderer. Shared with serializers in Sprint 3.2.
- [x] `marketing/src/content/legal/terms.ts` — full Terms migrated (12 sections).
- [x] `marketing/src/content/legal/privacy.ts` — full Privacy Policy migrated (12 sections + grievance contact block with an external link to meity.gov.in).
- [x] `marketing/src/content/legal/dpa.ts` — full DPA migrated (12 sections + 3 annexes including the sub-processor table) plus EU Addendum as `LegalDocument.addendum` (9 sections + SCC election table).
- [x] `marketing/src/components/sections/legal-document.tsx` — `LegalDocumentView` renderer; consumes `LegalDocument` and emits the same JSX the hand-written pages produced before. Handles `intro`, `sections`, `addendum.intro`, `addendum.sections`, plus `subprocTable` + `sccTable` block renderers inlined.
- [x] `marketing/src/app/terms/page.tsx`, `/privacy/page.tsx`, `/dpa/page.tsx` — thin composition: `<LegalDocumentView doc={...}/>`. DPA page retains `DpaSigningCard` + final `CtaBand` as bespoke sections alongside the rendered document.

**Status:** `[x] complete — 2026-04-21`

#### Sprint 3.2 — Serializers + downloads generator (shipped 2026-04-21)

**Deliverables:**

- [x] `marketing/src/content/legal/serialize-md.ts` — structured document → Markdown string. Handles title, meta table, TOC, sections with anchors, intro paragraphs, paragraphs, lists, notes (blockquotes), contact blocks, sub-processor tables, SCC election tables, addendum with divider.
- [x] `marketing/src/content/legal/serialize-pdf.ts` — document → `pdfkit` Buffer. Brand palette (navy/teal), auto-numbered sections, manually-drawn tables with header fill + row borders, inline formatting via `continued: true` font switching, clickable hyperlinks, page footer with "Page N of M" across all buffered pages. Title page includes meta strip + TOC.
- [x] `marketing/src/content/legal/serialize-docx.ts` — document → `docx` `Packer` Buffer. Declarative Paragraph/Table tree with TextRun (bold/italic) and ExternalHyperlink children. Mirrors PDF visual treatment: brand-coloured headings, notes with left-border + teal-light shading, teal table headers.
- [x] `marketing/scripts/generate-downloads.ts` — Bun entry point; iterates TERMS / PRIVACY / DPA, writes 9 files to `marketing/public/downloads/`.
- [x] `marketing/package.json` — adds `pdfkit` 0.18.0 (matches admin), `@types/pdfkit` 0.17.6, `docx` 9.6.1. Adds `prebuild` + `downloads` scripts. `prebuild` runs before every `next build`, so the artefacts are always fresh.
- [x] `marketing/.gitignore` — `public/downloads/{terms,privacy,dpa}.*` gitignored. Architecture-Brief trio stays committed.
- [x] `marketing/src/lib/routes.ts` — `DOWNLOAD_LEGAL` constants for the 9 download paths.
- [x] `marketing/src/components/sections/legal-layout.tsx` — optional `downloads` prop renders a dashed-border row under the meta strip with PDF / Word / Markdown pills.
- [x] `marketing/src/components/sections/legal-document.tsx` — forwards `DOWNLOAD_LEGAL[doc.slug]` automatically to the layout.

**Output sizes (post-generator run):**

| Doc | MD | PDF | DOCX | Pages (PDF) |
|-----|----|----|------|-------------|
| terms | 10 KB | 19 KB | 14 KB | 12 |
| privacy | 9 KB | 17 KB | 14 KB | ~11 |
| dpa | 25 KB | 42 KB | 20 KB | ~22 |

**Status:** `[x] complete — 2026-04-21`

### Phase 4 — Security hardening

Explicitly deferred per user direction. Items on the backlog for this phase:

- Strict CSP (report-only → enforce), HSTS with `preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- Secure cookie defaults (if any interactive state lands).
- Turnstile on any contact / lead-capture form.
- Sentry with `beforeSend` PII strip mirroring Rule 18.
- Bot detection via Vercel BotID on high-value routes (signup-intent forms, asset downloads if gated).
- No `NEXT_PUBLIC_*` secrets; env isolation prebuild check (mirror `admin/scripts/check-env-isolation.ts`).

**Status:** `[ ] deferred`

## Acceptance criteria

### Sprint 1.1

- `marketing/` exists as a Bun workspace sibling of `app/` + `admin/` + `worker/`.
- `bun install` at repo root hoists cleanly (no `@types/react` / `next` / `react` version mismatches).
- `cd marketing && bun run build` produces a clean Next.js 16 build; `/` route compiles; `robots.txt` is generated.
- `cd marketing && bun run lint` passes.
- `cd marketing && bun run dev --port 3002` serves the placeholder landing at `http://localhost:3002`.
- Placeholder `public/downloads/.gitkeep` checked in.
- No Sentry / no Supabase / no secrets / no hard-coded analytics.
- Root `package.json` workspaces array lists `"marketing"`.

## Consequences

**Enables:** the public marketing surface gains a home that's independently versioned, deployable, and can be handed HTML page-by-page without touching any authed surface.

**Introduces:**
- Fourth Next.js workspace. Root-level `bun install` now resolves + hoists four Next.js apps. No concrete risk expected since all three existing apps already pin the same next + react + typescript versions.
- New ADR series (0501+). Marketing, customer app (0001–0019 + 0046+ + 1001+), admin (0026+), and DEPA (0019–0025) now live in four non-overlapping number ranges. `ADR-index.md` adds a new section heading when the first 0501 entry lands.
- Vercel project count grows from two to three (`consentshield-one`, `consentshield-admin`, new `consentshield-marketing`).

**Defers (explicit):**
- Content — Phase 2, awaits user HTML.
- Downloads — Phase 3, tooling TBD.
- Security hardening — Phase 4, per user direction.
