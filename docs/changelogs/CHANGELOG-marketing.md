# Changelog — Marketing

Public marketing site (`marketing/` workspace → `consentshield.in`). New in 2026-04-21.

## [ADR-0058 follow-up — email relay + explicit signup status] — 2026-04-21

**ADR:** ADR-0058 (follow-up; no new ADR)

### Added
- `marketing/src/app/api/internal/send-email/route.ts` — thin Resend relay. Bearer-auth'd against `INVITATION_DISPATCH_SECRET`. Accepts `{to, subject, html, text, reply_to?, from?}`, caps recipients at 10 + bodies at 200 KB, returns `{ok, id?}` on success / `{error}` with mapped status on failure. Dev fallback logs the send intent when `RESEND_API_KEY` is unset.
- `marketing/src/lib/env.ts` — added `INVITATION_DISPATCH_SECRET` + `INVITE_FROM` (default `ConsentShield <noreply@consentshield.in>`).
- `marketing/.env.example` — documents the two new vars.

### Changed
- `marketing/src/components/sections/signup-form.tsx` — reads explicit `status` from the signup-intake response. Distinct outcome shells for:
  - `created` → "Check your inbox" (unchanged copy; now keyed on status).
  - `already_invited` → "We've sent this before" + resend-via-email link.
  - `existing_customer` → "You already have an account" + Sign-in CTA.
  - `admin_identity` / `invalid_email` / `invalid_plan` → inline error banner.
  Turnstile + rate-limits still gate submission; the surfaced statuses don't add a new enumeration vector beyond what Turnstile already controls.

### Tested
- [x] `cd marketing && bun run build` — PASS; routes include `/api/internal/send-email`.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.
- [ ] End-to-end email send — deferred until `INVITATION_DISPATCH_SECRET` + `RESEND_API_KEY` are set on both env files and Vault URL repointed. Operator playtest flagged for next session.

## [ADR-0058 Sprint 1.2] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.2 — Marketing `/signup` + pricing CTA split

### Added
- `marketing/src/app/signup/page.tsx` — server component reading `?plan=<starter|growth|pro>` (whitelisted; default `growth`); renders `<SignupForm>` plus a 3-bullet sidebar explaining the trial + Enterprise routing.
- `marketing/src/components/sections/signup-form.tsx` — client island; fields email + company + plan; Turnstile widget; cross-origin POST to `${APP_URL}/api/public/signup-intake`; "Check your inbox" success state with "Try a different email" reset.

### Changed
- `marketing/src/components/sections/pricing-preview.tsx` — per-tier `ctaHref`: Starter / Growth / Pro now route to `/signup?plan=<code>` (self-serve); Enterprise stays at `/contact`. CTA labels unified to "Start free trial" on self-serve tiers.
- `marketing/src/app/pricing/page.tsx` — final CTA band primary button → `/signup?plan=growth` (was `/contact`).
- `marketing/next.config.ts` — CSP `connect-src` adds `https://app.consentshield.in http://localhost:3000` so the cross-origin POST to the customer-app intake endpoint isn't blocked.
- `marketing/src/lib/env.ts` — added typed `APP_URL` (defaults to `http://localhost:3000` in dev; prod via `NEXT_PUBLIC_APP_URL`).
- `marketing/.env.example` — documents `NEXT_PUBLIC_APP_URL`.

### Tested
- [x] `cd marketing && bun run build` — clean; 16 routes (`/signup` is dynamic / server-renders the `?plan=` query param; CTAs from pricing/preview surfaces all resolve).
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

### Pairs with
- ADR-0058 Sprint 1.1 — public intake endpoint + DB foundations on the customer app.

## [ADR-0501 Sprint 4.3] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 4 Sprint 4.3 — Sentry (client + server, PII-stripped)

First commit authored on the new `marketing/phase4` git worktree — Terminals A + B now have independent working trees to prevent further staging collisions (see `.claude/session-handoff.md`).

### Added
- `marketing/sentry.client.config.ts` — browser Sentry init. DSN via `NEXT_PUBLIC_SENTRY_DSN`; `enabled: !!dsn` so unset DSN is a no-op; `tracesSampleRate: 0.1`; replays disabled; `beforeSend` + `beforeBreadcrumb` strip request body / headers / cookies / query_string per Rule 18.
- `marketing/sentry.server.config.ts` — server mirror of the client config.

### Changed
- `marketing/next.config.ts` — default export wrapped with `withSentryConfig` (`org: 'consentshield'`, `project: 'consentshield-marketing'`, tunnel route `/monitoring`, silent outside CI). CSP `connect-src` adds `https://*.ingest.sentry.io https://*.sentry.io`.
- `marketing/package.json` — `@sentry/nextjs` 10.48.0 (mirrors admin workspace pin).
- `marketing/.env.example` — Sentry block trimmed: only `NEXT_PUBLIC_SENTRY_DSN` now (removed the redundant `SENTRY_DSN`); added `SENTRY_AUTH_TOKEN` for CI source-map upload.

### Tested
- [x] `cd marketing && bun run build` — clean. 15 routes / 12 static + 1 dynamic (`/api/contact`) + Sentry tunnel + source-map generation.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.
- [x] `bun run check-env` — clean.

### Dependency (per Rule 15)
- **`@sentry/nextjs` 10.48.0** — same version admin pins. Hand-rolling Next.js + Sentry integration across client / server / edge runtimes + source-map upload is weeks of work and security-critical. Justified.

### Deferred to Sprint 4.4
- **Vercel BotID.** Turnstile (Sprint 4.2) already gates the only POST surface; BotID would be strict belt-and-suspenders. Revisit when new POST surfaces are added.
- **CSP enforce-mode cutover.** Report-only observation window first; tightening happens once the violation log is clean.

## [ADR-0501 Sprint 4.2] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 4 Sprint 4.2 — Contact form real submit + Turnstile

### Added
- `marketing/src/lib/env.ts` — typed marketing env access with dev fallbacks (Turnstile always-pass test pair when keys unset; Resend no-op when `RESEND_API_KEY` unset).
- `marketing/src/app/api/contact/route.ts` — Node-runtime POST handler. Shape-validates body; verifies Turnstile token with Cloudflare siteverify (passes forwarded-for IP); emails via raw-fetch to Resend. Error modes: 400 (validation) / 403 (turnstile) / 502 (delivery) / 202 (success). Violation details logged server-side, never echoed to client. No SDK dependency.

### Changed
- `marketing/src/components/sections/contact-form.tsx` — real submit replaces Sprint 2.4's `preventDefault`. FormData is serialised to JSON (including the Turnstile-injected `cf-turnstile-response`) and POSTed to `/api/contact`. Turnstile widget script loaded once on form mount; widget declaratively rendered via `<div class="cf-turnstile">`. Pending + error states surface inline; 202 flips to the existing acknowledgement UI.
- `marketing/next.config.ts` — CSP `script-src` and `frame-src` add `https://challenges.cloudflare.com` so the Turnstile widget loads.

### Tested
- [x] `cd marketing && bun run build` — clean. `/api/contact` shows as dynamic (server-rendered); all other routes static.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.
- [x] `bun run check-env` — clean.

### Deferred to Sprint 4.3
- Sentry client + server init with PII-strip `beforeSend`.
- Vercel BotID on `/api/contact` (defence-in-depth alongside Turnstile).
- CSP enforce-mode cutover (after a report-only observation window).

## [ADR-0501 Sprint 4.1] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 4 Sprint 4.1 — Security headers + env isolation

### Added
- `marketing/next.config.ts` — security headers on every response: `Strict-Transport-Security` (2y + includeSubDomains + preload), `X-Content-Type-Options`, `Referrer-Policy` (strict-origin-when-cross-origin), `Permissions-Policy` (camera/mic/geo/interest-cohort denied), `X-Frame-Options: DENY`. CSP ships as `Content-Security-Policy-Report-Only` with a hardened policy allowing self + Fontshare (Satoshi) + data: images; frame-ancestors/form-action locked down; upgrade-insecure-requests. Enforce-mode cutover is a follow-up sprint after report-only catalogues Next.js inline-script violations.
- `marketing/scripts/check-env-isolation.ts` — mirrors the repo-root script. Refuses marketing builds that carry `ADMIN_*` vars or customer-app-only secrets (`MASTER_ENCRYPTION_KEY`, `DELETION_CALLBACK_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_KEY_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`). Names printed on violation; values never logged.
- `marketing/.env.example` — documents the 5 optional marketing env vars (Turnstile site/secret, Resend API key, Contact inbox, Sentry DSN) + the block-list pointer.

### Changed
- `marketing/package.json` — `prebuild` now chains `check-env-isolation.ts` → `generate-downloads.ts` → `next build`. `check-env` script exposed for ad-hoc verification.

### Tested
- [x] `bun run check-env` — clean on the current marketing workspace.
- [x] `bun run build` — prebuild fires env-check then downloads generator, then Next.js build succeeds. 12 static routes clean.
- [x] `bun run lint` — 0 errors, 0 warnings.

### Deferred
- Sprint 4.2: contact-form real submit (`/api/contact` + Turnstile verify + Resend send).
- Sprint 4.3: Sentry client + server init with PII-stripping `beforeSend`; Vercel BotID on the contact POST.
- Sprint 4.4: CSP enforce-mode cutover once report-only logs are clean.

## [ADR-0501 Sprint 3.2] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 3 Sprint 3.2 — Downloads pipeline (MD / PDF / DOCX, legal only)

### Added
- `marketing/src/content/legal/serialize-md.ts` — structured `LegalDocument` → Markdown. Renders title, meta definition-table, TOC, section anchors, paragraphs, lists, blockquoted notes, contact blocks, sub-processor + SCC tables, addendum with `---` divider.
- `marketing/src/content/legal/serialize-pdf.ts` — `pdfkit`-based serializer. Brand palette, title page with meta strip + TOC, auto-numbered sections, inline formatting via `continued: true` font switching, clickable hyperlinks, manually-drawn tables with header fill + row borders, "Page N of M" footer on every buffered page.
- `marketing/src/content/legal/serialize-docx.ts` — `docx` (v9.6.1) declarative tree. Paragraph / Table nodes with TextRun (bold/italic) + ExternalHyperlink inline children. Mirrors PDF visual treatment.
- `marketing/scripts/generate-downloads.ts` — Bun entry point; iterates TERMS / PRIVACY / DPA, writes 9 files to `marketing/public/downloads/`.
- `marketing/src/lib/routes.ts` — `DOWNLOAD_LEGAL` constants (terms/privacy/dpa × pdf/docx/md).

### Changed
- `marketing/package.json` — adds `pdfkit` 0.18.0 + `@types/pdfkit` 0.17.6 (matches admin) + `docx` 9.6.1. Adds `prebuild` (runs the generator before `next build`) and `downloads` (ad-hoc regen) scripts.
- `marketing/.gitignore` — `public/downloads/{terms,privacy,dpa}.*` gitignored; Architecture-Brief trio stays committed.
- `marketing/src/components/sections/legal-layout.tsx` — optional `downloads` prop renders a dashed-border row under the meta strip with PDF / Word / Markdown pill links.
- `marketing/src/components/sections/legal-document.tsx` — auto-wires `DOWNLOAD_LEGAL[doc.slug]` to the layout, so every legal page gets its download row for free.

### Tested
- [x] `bun scripts/generate-downloads.ts` → 9 files written: terms.md (10 KB), terms.pdf (19 KB, 12 pages), terms.docx (14 KB); privacy.{md,pdf,docx} (9/17/14 KB); dpa.{md,pdf,docx} (25/42/20 KB).
- [x] `file` check: PDFs are `PDF document, version 1.3`; DOCX are `Microsoft Word 2007+`; MDs parse cleanly.
- [x] `bun run build` — prebuild step runs the generator first; Next.js build clean; 12 static routes.
- [x] `bun run lint` — 0 errors, 0 warnings.

### Dependency additions (per Rule 15)
- **`pdfkit` 0.18.0** — standard Node PDF generator, already used by `admin/` for invoices. Mirroring the pin.
- **`@types/pdfkit` 0.17.6** — types for the above. Matches admin.
- **`docx` 9.6.1** — Microsoft-maintained Office Open XML writer. Hand-rolling DOCX bytes (zip of ~15 XML files per document) would take multiple days and be fragile; this is a justified dep.

### Deferred to Phase 4 (security hardening)
- Downloads currently have no rate limiting / bot gating. Files are small (max 42 KB) and publicly distributable — acceptable for now; BotID + rate limit would belong alongside the contact-form Turnstile wiring when Phase 4 lands.

## [ADR-0501 Sprint 3.1] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 3 Sprint 3.1 — Structured legal content model

Also includes a non-ADR fix (same commit batch): `/solutions` stripped of internal PRIORITY badges + TAM/ICP stats (not customer-facing).

### Added
- `marketing/src/content/legal/types.ts` — typed content model: `LegalBlock` union (h3 / p / ul / note / contact / subprocTable / sccTable), `LegalSection`, `LegalDocument` with optional `intro` + `addendum`.
- `marketing/src/content/legal/md-inline.ts` — 40-line inline Markdown parser (`**bold**` / `*em*` / `[text](url)`) shared between the React renderer and (Sprint 3.2) serializers. Zero dependencies.
- `marketing/src/content/legal/terms.ts` — canonical Terms of Service (12 sections).
- `marketing/src/content/legal/privacy.ts` — canonical Privacy Policy (12 sections, grievance-officer contact block with external link).
- `marketing/src/content/legal/dpa.ts` — canonical DPA (12 sections + 3 annexes, inc. sub-processors table) + EU Addendum as `LegalDocument.addendum` (9 sections + SCC election table).
- `marketing/src/components/sections/legal-document.tsx` — `LegalDocumentView` consumes `LegalDocument` and renders through the existing `LegalLayout`. Inline sub-renderers for `subprocTable` + `sccTable`.

### Changed
- `marketing/src/app/terms/page.tsx`, `/privacy/page.tsx`, `/dpa/page.tsx` — now thin composition: `<LegalDocumentView doc={...}/>`. DPA page keeps `DpaSigningCard` + final `CtaBand` bespoke, appended after the rendered document.

### Tested
- [x] `cd marketing && bun run build` — 12 static routes; clean.
- [x] `cd marketing && bun run lint` — clean.

### Deferred (Sprint 3.2)
- `scripts/generate-downloads.ts` + MD/PDF/DOCX serializers + prebuild wiring + download-link integration in footer/legal-page heroes.

## [ADR-0501 Sprint 2.5] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 2 Sprint 2.5 — How-it-works demo modal (Phase 2 close-out)

### Added
- `marketing/src/components/sections/demo-frames.tsx` — 7 frame function components + `FRAMES` array. Staggered `animation-delay` inline styles preserved verbatim. Sub-helpers: `BrowserBar`, `PurposeRow`, `TrackerRow`, `PrefRow`, `Receipt`, `LogTime`.
- `marketing/src/components/sections/how-it-works-demo.tsx` — client island exporting `HowItWorksDemo` (trigger button) + internal `DemoModal`. Auto-advance (6s), progress-fill transition (imperative reflow-force), play/pause/prev/next/dot-jump controls, Escape to close, backdrop-click to close, body scroll lock. Frame remount via `key={index-tick}` replays staggered animations from the top on every navigation action.

### Changed
- `marketing/src/components/sections/home-hero.tsx` — **corrected to match HTML spec**:
  - Third CTA "Why DEPA-native matters" added (routed to `/depa`).
  - "See how it works" CTA (with play-triangle SVG) triggers `HowItWorksDemo` — replaces the Sprint-2.1 placeholder "See the platform".
  - `hero-meta` corrected to the four items in the spec (Enforcement begins · 13 May 2027 / Per-violation penalty · Up to ₹250 crore / Indian businesses affected · 4,00,000+ / Deploys in · 48 hours). Sprint 2.1 had invented three placeholder items (Stack / Jurisdiction / Status).

### Tested
- [x] `cd marketing && bun run build` — 12 static routes; clean. Home page prerenders with the demo modal hydrating client-side only when the trigger button is clicked.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

### Phase 2 status
All five Phase 2 sprints (2.1–2.5) shipped 2026-04-21. The marketing site now matches the `consentshield-site-v2.html` spec end-to-end: 9 routes + 6 client islands (Nav, SolutionsTabs, PriceToggle, ContactForm, DpaSigningCard, HowItWorksDemo). Remaining: Phase 3 (downloads pipeline) + Phase 4 (security hardening), both explicitly deferred.

## [ADR-0501 Sprint 2.4] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 2 Sprint 2.4 — Pricing + Contact + Legal (Terms, Privacy, DPA, EU Addendum)

### Added
- `marketing/src/components/sections/price-toggle.tsx` — client Monthly/Annual pill. Cosmetic per HTML spec.
- `marketing/src/components/sections/price-table.tsx` — 4-column × 4-group feature grid. Typed `Row[]` → `PriceCell` helper renders `'✓'` / `'—'` / free text.
- `marketing/src/components/sections/bfsi-callout.tsx` — BFSI specialist-track pricing callout.
- `marketing/src/app/pricing/page.tsx` — full Pricing page content.
- `marketing/src/components/sections/contact-form.tsx` — client; uncontrolled inputs; `preventDefault` + local acknowledgement state. Real submit wiring (Resend + Turnstile + BotID) deferred to Phase 4.
- `marketing/src/app/contact/page.tsx` — contact options grid (5 cards including Architecture Brief download link) + ContactForm.
- `marketing/src/components/sections/legal-layout.tsx` — shared hero + TOC-on-left + article-on-right layout for Terms/Privacy/DPA.
- `marketing/src/app/terms/page.tsx` — full 12-section Terms of Service content.
- `marketing/src/app/privacy/page.tsx` — full 12-section Privacy Policy content with Grievance Officer block.
- `marketing/src/components/sections/dpa-signing-card.tsx` — client Execute Digitally card; uncontrolled inputs + required checkbox; preventDefault + acknowledgement state.
- `marketing/src/app/dpa/page.tsx` — full DPA (12 sections + Annexes 1–3) + EU Addendum (9 sections, with SCC election table via `SccRow` helper) + DpaSigningCard + final CtaBand. Annex 3 sub-processor table rendered via `SubprocRow` helper.

### Tested
- [x] `cd marketing && bun run build` — 12 static routes, clean (1.6s cold). All 4 new pages (pricing/contact/terms/privacy/dpa) prerender as static content; client components (PriceToggle, ContactForm, DpaSigningCard) hydrate client-side.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

### Deferred (Phase 4)
- Contact form backend + Turnstile + BotID.
- DPA signing record persistence (signatory + IP + timestamp + DPA version → admin/billing).

## [ADR-0501 Sprint 2.3] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site
**Sprint:** Phase 2 Sprint 2.3 — DEPA + Solutions

### Added
- `marketing/src/components/sections/depa-hero.tsx` — DEPA hero + inlined 340x340 radial shield SVG with 5 orbiting principle dots (P01–P05). Port is pixel-faithful to the HTML spec.
- `marketing/src/components/sections/depa-compare.tsx` — 7-row DEPA-native vs GDPR-adapted capability table. Rows inlined as typed `Row[]` with rich pos/neg copy including nested `<strong>` emphasis.
- `marketing/src/components/sections/solutions-tabs.tsx` — **client component**. Renders tab bar + active panel for 5 sectors (SaaS, Edtech, D2C, Healthcare, BFSI). Each sector carries tab label, priority badge, scenario heading, description, 2 stats, and 3 features with inline SVG icons. Active-tab state via `useState`; ARIA `tablist` / `tab` / `tabpanel` roles added. Only interactive surface on the site so far.
- `marketing/src/app/depa/page.tsx` — composes DepaHero + DepaCompare + CtaBand (PDF primary + DOCX + MD alternate links + size/page-count meta row).
- `marketing/src/app/solutions/page.tsx` — composes sol-hero + SolutionsTabs + CtaBand ("tell us about your vertical").

### Changed
- `marketing/src/components/sections/cta-band.tsx` — added optional `meta` slot rendered below the action row. Used on the DEPA page for the PDF size + alternate-format links strip.

### Tested
- [x] `cd marketing && bun run build` — 12 static routes; solutions now statically prerenders despite being a client component on the tabs (only the shell is server-rendered; tab state hydrates client-side).
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

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
