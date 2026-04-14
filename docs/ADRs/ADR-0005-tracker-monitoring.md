# ADR-0005: Tracker Monitoring (Banner Script v2 with MutationObserver)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-14
**Date completed:** 2026-04-14

---

## Context

The compiled banner (ADR-0003 Sprint 1.3) captures consent decisions but doesn't verify that customers' sites actually respect those decisions. The v2 blueprint Section 5 calls for the banner script to observe what happens after consent — detect trackers, classify them against the signature database, and report violations when a tracker fires without the required consent.

This is what makes ConsentShield an enforcement engine, not just a consent manager.

## Decision

Extend the compiled banner script to:
1. Detect third-party scripts loaded after banner render (MutationObserver on DOM + PerformanceObserver on resource timing)
2. Classify each against an embedded tracker signature database (~30 services, ~15KB)
3. Compare classifications against the user's consent state
4. POST observations + violations to `/v1/observations` (HMAC-signed, already exists)

Also seed the `tracker_signatures` table with an initial curated set, and add a dashboard enforcement monitor that surfaces violations.

## Consequences

After this ADR:
- Customers see real-time "which trackers fired, which violated consent" on their dashboard
- The enforcement clock + compliance score reflect actual site behavior, not just config
- Marketing differentiator: no other India tool monitors real consent enforcement

---

## Implementation Plan

### Phase 1: Signature Database + Monitoring Script

#### Sprint 1.1: Seed Tracker Signature Database
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] supabase/seed/tracker_signatures.sql — 30+ curated signatures
- [ ] Categories: analytics, marketing, personalisation, functional
- [ ] Services to cover: Google Analytics (GA4), Meta Pixel, Hotjar, Mixpanel,
      LinkedIn Insight, Google Ads, Segment, Clevertap, WebEngage, MoEngage,
      Razorpay, Intercom, Cloudflare CDN, Freshchat, Zoho, etc.
- [ ] detection_rules JSONB: array of { type, pattern, confidence }
      type: 'script_src' | 'resource_url' | 'cookie_name' | 'global_var'
- [ ] data_locations (ISO country codes)
- [ ] is_functional flag for payment/CAPTCHA/chat that shouldn't be blocked

**Testing plan:**
- [ ] Seed file runs cleanly on fresh DB
- [ ] All 30+ signatures inserted with correct category
- [ ] Reference data RLS lets authenticated users read

**Status:** `[x] complete`

#### Sprint 1.2: Banner Script v2 with Monitoring
**Estimated effort:** 5–6 hours
**Deliverables:**
- [ ] Embed signature DB (subset, minified) in compiled banner
- [ ] MutationObserver on <head>/<body> for new <script> tags
- [ ] PerformanceObserver for resource timing entries
- [ ] Classification function: match detected URL against signature patterns
- [ ] Comparison: consent state vs required_consent per purpose category
- [ ] 5-second initial observation window, 60-second extended window
- [ ] POST /v1/observations with HMAC signature (already supported by Worker)
- [ ] Functional allowlist (never flagged)
- [ ] 60-second grace period after consent change

**Testing plan:**
- [ ] Test page with GA4 only → detected, violation if analytics not consented
- [ ] Test page with Razorpay → detected, functional allowlist, no violation
- [ ] Test page with Meta Pixel before consent → violation flagged
- [ ] Consent withdrawal → trackers that were active flagged if still firing 60s later

**Status:** `[x] complete`

#### Sprint 1.3: Dashboard Enforcement Monitor
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] /dashboard/enforcement — violations view
- [ ] Recent violations table (tracker, severity, page URL hash, count)
- [ ] Trend chart: violations over time (last 7 days)
- [ ] Tracker override UI: mark false positives
- [ ] Data flow map: where data goes based on detections (cross-border indicator)
- [ ] Dashboard score now includes real enforcement signal

**Testing plan:**
- [ ] Violations from Sprint 1.2 appear in monitor within seconds
- [ ] Override marks subsequent observations as non-violation
- [ ] Cross-border detection: GA4 (US), Hotjar (EU) visualized

**Status:** `[x] complete`

---

## Architecture Changes

_None — extends existing banner script and tracker_observations buffer._

---

## Test Results

_Pending_

---

## Changelog References

- CHANGELOG-schema.md (seed data), CHANGELOG-worker.md (banner v2), CHANGELOG-dashboard.md
