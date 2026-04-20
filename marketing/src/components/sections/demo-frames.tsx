// 7 frames of the How-It-Works demo — ported verbatim from the HTML
// spec (#demoStage). Each frame is a function component; the modal
// picks FRAMES[currentIndex]. Animation-delay inline styles are kept
// exactly as the HTML has them so the staggered log/artefact/receipt
// animations replay identically when the frame (re)mounts.

export function Frame1UserArrives() {
  return (
    <div className="demo-frame active" data-frame="0">
      <div className="demo-caption">
        A user visits your website. <em>Trackers wait.</em>
      </div>
      <p className="demo-sub">
        With banner.js on your site, third-party scripts are held back until
        the user decides. No tracking before consent.
      </p>
      <div className="demo-split">
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">User · kuruvi.in</div>
          </div>
          <div className="demo-panel-body">
            <div className="demo-browser">
              <BrowserBar url="kuruvi.in/summer-collection" />
              <div className="demo-browser-body">
                <div className="demo-page-block tall" />
                <div className="demo-page-block wide" />
                <div className="demo-page-block" />
                <div className="demo-page-block narrow" />
                <div className="demo-page-block wide" />
              </div>
            </div>
          </div>
        </div>
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">ConsentShield</div>
          </div>
          <div className="demo-panel-body">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                textAlign: 'center',
                padding: 20,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: '10.5px',
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    marginBottom: 10,
                  }}
                >
                  Standby
                </div>
                <div
                  style={{
                    fontFamily: 'var(--display)',
                    fontSize: 17,
                    color: 'var(--navy)',
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  Waiting for first consent event
                </div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    lineHeight: 1.7,
                  }}
                >
                  Artefact register · empty
                  <br />
                  Trackers observed · 0<br />
                  Violations · 0
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="demo-log">
        <span className="demo-log-line">
          <LogTime t="14:32:15" />banner.js loaded from cdn.consentshield.in
        </span>
        <span
          className="demo-log-line"
          style={{ animationDelay: '.25s' }}
        >
          <LogTime t="14:32:15" />Trackers held — awaiting user decision
        </span>
      </div>
    </div>
  )
}

export function Frame2BannerRenders() {
  return (
    <div className="demo-frame active" data-frame="1">
      <div className="demo-caption">
        The banner renders. <em>Three purposes on offer.</em>
      </div>
      <p className="demo-sub">
        Necessary cookies are always authorised. Analytics and Marketing are
        optional — presented as distinct, individually-acceptable choices, not
        a single opt-in array.
      </p>
      <div className="demo-split">
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">User · kuruvi.in</div>
          </div>
          <div className="demo-panel-body">
            <div className="demo-browser">
              <BrowserBar url="kuruvi.in/summer-collection" />
              <div className="demo-browser-body">
                <div className="demo-page-block tall" />
                <div className="demo-page-block wide" />
                <div className="demo-page-block" />
                <div className="demo-banner show">
                  <div className="demo-banner-title">
                    Your privacy choices
                  </div>
                  <div className="demo-banner-text">
                    We use cookies to operate the site and, with your consent,
                    to understand usage and personalise marketing.
                  </div>
                  <div className="demo-banner-opts">
                    <span className="demo-banner-opt accepted">Necessary</span>
                    <span className="demo-banner-opt">Analytics</span>
                    <span className="demo-banner-opt">Marketing</span>
                  </div>
                  <div className="demo-banner-actions">
                    <button type="button" className="demo-banner-btn">
                      Reject optional
                    </button>
                    <button type="button" className="demo-banner-btn primary">
                      Confirm choices
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">ConsentShield</div>
          </div>
          <div className="demo-panel-body">
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '10.5px',
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: 'var(--teal)',
                marginBottom: 8,
              }}
            >
              Purpose Definition Registry
            </div>
            <PurposeRow
              name="Necessary"
              desc="session, auth · always authorised · no expiry"
            />
            <PurposeRow
              name="Analytics"
              desc="behavioural, aggregate · expires 90d · revocable"
            />
            <PurposeRow
              name="Marketing"
              desc="email, ads, pixel tracking · expires 365d · revocable"
              last
            />
          </div>
        </div>
      </div>
      <div className="demo-log">
        <span className="demo-log-line">
          <LogTime t="14:32:16" />Banner rendered · 3 purposes offered
        </span>
        <span
          className="demo-log-line"
          style={{ animationDelay: '.25s' }}
        >
          <LogTime t="14:32:16" />Purpose Definition Registry resolved from
          customer config
        </span>
      </div>
    </div>
  )
}

export function Frame3TwoArtefacts() {
  return (
    <div className="demo-frame active" data-frame="2">
      <div className="demo-caption">
        User accepts Analytics. Rejects Marketing.{' '}
        <em>Two artefacts generated.</em>
      </div>
      <p className="demo-sub">
        One DEPA-native artefact per accepted purpose — not a single event
        with a purpose array. Each is independently addressable, with its own
        expiry and revocation chain.
      </p>
      <div className="demo-split">
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">User · kuruvi.in</div>
          </div>
          <div className="demo-panel-body">
            <div className="demo-browser">
              <BrowserBar url="kuruvi.in/summer-collection" />
              <div className="demo-browser-body">
                <div className="demo-page-block tall" />
                <div className="demo-page-block wide" />
                <div className="demo-page-block" />
                <div className="demo-banner show">
                  <div className="demo-banner-title">
                    Your privacy choices
                  </div>
                  <div className="demo-banner-text">
                    Recording your choices…
                  </div>
                  <div className="demo-banner-opts">
                    <span className="demo-banner-opt accepted">
                      Necessary ✓
                    </span>
                    <span className="demo-banner-opt accepted">
                      Analytics ✓
                    </span>
                    <span className="demo-banner-opt rejected">Marketing</span>
                  </div>
                  <div className="demo-banner-actions">
                    <button type="button" className="demo-banner-btn primary">
                      Confirmed
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">Artefact register</div>
          </div>
          <div className="demo-panel-body">
            <div
              className="demo-artefact"
              style={{ animationDelay: '.1s' }}
            >
              <div className="demo-artefact-status" />
              <div>
                <div className="demo-artefact-purpose">Necessary</div>
                <div className="demo-artefact-id">CA_01J2K4F7M8N3Q</div>
              </div>
              <div className="demo-artefact-meta">expires 14 Apr 2027</div>
            </div>
            <div
              className="demo-artefact"
              style={{ animationDelay: '.6s' }}
            >
              <div className="demo-artefact-status" />
              <div>
                <div className="demo-artefact-purpose">Analytics</div>
                <div className="demo-artefact-id">CA_01J2K4F7N9P4R</div>
              </div>
              <div className="demo-artefact-meta">expires 15 Jul 2026</div>
            </div>
            <div
              style={{
                padding: '10px 12px',
                border: '1px dashed var(--line)',
                borderRadius: 6,
                fontSize: 11,
                color: 'var(--ink-3)',
                textAlign: 'center',
                marginTop: 6,
              }}
            >
              <em>Marketing — not generated (user declined)</em>
            </div>
          </div>
        </div>
      </div>
      <div className="demo-log">
        <span className="demo-log-line">
          <LogTime t="14:32:21" />Consent recorded · necessary+analytics
          accepted, marketing declined
        </span>
        <span
          className="demo-log-line ok"
          style={{ animationDelay: '.4s' }}
        >
          <LogTime t="14:32:21" />Artefact CA_01J2K4F7M8N3Q generated ·
          purpose=necessary · expiry=365d
        </span>
        <span
          className="demo-log-line ok"
          style={{ animationDelay: '.8s' }}
        >
          <LogTime t="14:32:21" />Artefact CA_01J2K4F7N9P4R generated ·
          purpose=analytics · expiry=90d
        </span>
        <span
          className="demo-log-line"
          style={{ animationDelay: '1.2s' }}
        >
          <LogTime t="14:32:21" />Artefacts delivered to customer-controlled
          R2 bucket
        </span>
      </div>
    </div>
  )
}

export function Frame4TrackersClassified() {
  return (
    <div className="demo-frame active" data-frame="3">
      <div className="demo-caption">
        Trackers load. <em>Each one classified in real time.</em>
      </div>
      <p className="demo-sub">
        Every third-party script is matched against the signature database.
        Allowed if its purpose has an active artefact; blocked if not. Two
        violations caught here — before they fire.
      </p>
      <div className="demo-split">
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">User · kuruvi.in</div>
          </div>
          <div className="demo-panel-body">
            <div className="demo-browser">
              <BrowserBar url="kuruvi.in/summer-collection" />
              <div className="demo-browser-body">
                <div className="demo-page-block tall" />
                <div className="demo-page-block wide" />
                <div className="demo-page-block" />
                <div className="demo-page-block narrow" />
                <div className="demo-page-block wide" />
              </div>
            </div>
          </div>
        </div>
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">Enforcement engine</div>
          </div>
          <div className="demo-panel-body">
            <TrackerRow
              state="allowed"
              name="Google Analytics"
              purpose="analytics ✓"
            />
            <TrackerRow
              state="allowed"
              name="Hotjar"
              purpose="analytics ✓"
            />
            <TrackerRow
              state="blocked"
              name="Meta Pixel"
              purpose="marketing ✗"
            />
            <TrackerRow
              state="blocked"
              name="Mixpanel"
              purpose="marketing ✗"
            />
          </div>
        </div>
      </div>
      <div className="demo-log">
        <span className="demo-log-line ok">
          <LogTime t="14:32:22" />google-analytics.com/ga.js → allowed (matches
          analytics artefact)
        </span>
        <span
          className="demo-log-line ok"
          style={{ animationDelay: '.2s' }}
        >
          <LogTime t="14:32:22" />static.hotjar.com/c/hotjar-*.js → allowed
          (matches analytics artefact)
        </span>
        <span
          className="demo-log-line err"
          style={{ animationDelay: '.5s' }}
        >
          <LogTime t="14:32:22" />connect.facebook.net/en_US/fbevents.js →
          BLOCKED (no marketing artefact)
        </span>
        <span
          className="demo-log-line err"
          style={{ animationDelay: '.8s' }}
        >
          <LogTime t="14:32:22" />cdn.mxpnl.com/libs/mixpanel.js → BLOCKED (no
          marketing artefact)
        </span>
      </div>
    </div>
  )
}

export function Frame5Withdrawal() {
  return (
    <div className="demo-frame active" data-frame="4">
      <div className="demo-caption">
        30 days later. The user changes their mind.{' '}
        <em>Analytics artefact revoked.</em>
      </div>
      <p className="demo-sub">
        Revocation is an immutable event on the specific artefact — not a bulk
        consent-withdrawn update. Marketing remains unaffected (it was never
        granted). Necessary continues.
      </p>
      <div className="demo-split">
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">User · preference centre</div>
          </div>
          <div className="demo-panel-body">
            <div className="demo-browser">
              <BrowserBar url="kuruvi.in/privacy/preferences" />
              <div className="demo-browser-body">
                <PrefRow
                  label="Necessary"
                  rightColor="var(--teal)"
                  right="Always on"
                />
                <PrefRow
                  label="Analytics"
                  bg="#FFF5F5"
                  border="#FCC"
                  rightColor="#C62A2F"
                  right="✗ Withdrawing…"
                />
                <PrefRow
                  label="Marketing"
                  labelMuted
                  right="Not granted"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">Artefact register</div>
          </div>
          <div className="demo-panel-body">
            <div className="demo-artefact">
              <div className="demo-artefact-status" />
              <div>
                <div className="demo-artefact-purpose">Necessary</div>
                <div className="demo-artefact-id">CA_01J2K4F7M8N3Q</div>
              </div>
              <div className="demo-artefact-meta">active</div>
            </div>
            <div
              className="demo-artefact revoked"
              style={{ animationDelay: '.2s' }}
            >
              <div className="demo-artefact-status" />
              <div>
                <div className="demo-artefact-purpose">
                  Analytics · revoked
                </div>
                <div className="demo-artefact-id">CA_01J2K4F7N9P4R</div>
              </div>
              <div className="demo-artefact-meta">
                revoked 15 May 2026 14:08
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="demo-log">
        <span className="demo-log-line">
          <LogTime t="14 May 14:08" />Preference-centre action · user withdrew
          analytics
        </span>
        <span
          className="demo-log-line err"
          style={{ animationDelay: '.3s' }}
        >
          <LogTime t="14 May 14:08" />Artefact CA_01J2K4F7N9P4R revoked ·
          revocation chain recorded
        </span>
        <span
          className="demo-log-line"
          style={{ animationDelay: '.6s' }}
        >
          <LogTime t="14 May 14:08" />Deletion orchestration triggered ·
          scope=analytics data fields
        </span>
      </div>
    </div>
  )
}

export function Frame6CascadeDeletion() {
  return (
    <div className="demo-frame active" data-frame="5">
      <div className="demo-caption">
        Deletion cascades to{' '}
        <em>exactly the systems analytics authorised</em>.
      </div>
      <p className="demo-sub">
        Not a blanket &ldquo;user opted out&rdquo; webhook. The revoked
        artefact&apos;s data scope determines which integrations receive
        delete requests. Each returns a signed receipt.
      </p>
      <div className="demo-split">
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">Orchestration</div>
          </div>
          <div className="demo-panel-body">
            <div
              style={{
                padding: 14,
                background: 'var(--slate-soft)',
                borderRadius: 6,
                fontFamily: 'var(--mono)',
                fontSize: '10.5px',
                lineHeight: 1.7,
                color: 'var(--ink-2)',
                flex: 1,
              }}
            >
              <div>
                artefact_id:{' '}
                <span style={{ color: 'var(--navy)' }}>
                  CA_01J2K4F7N9P4R
                </span>
              </div>
              <div>data_scope:</div>
              <div style={{ paddingLeft: 12, color: 'var(--teal)' }}>
                · session_analytics
              </div>
              <div style={{ paddingLeft: 12, color: 'var(--teal)' }}>
                · behavioural_events
              </div>
              <div style={{ paddingLeft: 12, color: 'var(--teal)' }}>
                · aggregate_metrics
              </div>
              <div style={{ marginTop: 10 }}>connectors:</div>
              <div style={{ paddingLeft: 12 }}>→ Google Analytics</div>
              <div style={{ paddingLeft: 12 }}>→ Hotjar</div>
              <div style={{ paddingLeft: 12 }}>→ internal sessions DB</div>
            </div>
          </div>
        </div>
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">Signed receipts</div>
          </div>
          <div className="demo-panel-body">
            <Receipt
              name="Google Analytics"
              hash="0xa3b7…f21c"
              delay=".2s"
            />
            <Receipt name="Hotjar" hash="0x82c1…9d4f" delay=".6s" />
            <Receipt
              name="Internal sessions DB"
              hash="0x91d4…7e3a"
              delay="1.0s"
            />
          </div>
        </div>
      </div>
      <div className="demo-log">
        <span className="demo-log-line">
          <LogTime t="14:08:02" />Delete requests dispatched · 3 connectors ·
          scope=analytics
        </span>
        <span
          className="demo-log-line ok"
          style={{ animationDelay: '.3s' }}
        >
          <LogTime t="14:08:04" />GA receipt signed · hash 0xa3b7…f21c
        </span>
        <span
          className="demo-log-line ok"
          style={{ animationDelay: '.6s' }}
        >
          <LogTime t="14:08:05" />Hotjar receipt signed · hash 0x82c1…9d4f
        </span>
        <span
          className="demo-log-line ok"
          style={{ animationDelay: '.9s' }}
        >
          <LogTime t="14:08:05" />Internal DB receipt signed · hash
          0x91d4…7e3a
        </span>
      </div>
    </div>
  )
}

export function Frame7AuditExport() {
  return (
    <div className="demo-frame active" data-frame="6">
      <div className="demo-caption">
        One query. <em>Complete chain of custody.</em> DPB-ready.
      </div>
      <p className="demo-sub">
        If the Data Protection Board opens an inquiry — or a Data Principal
        exercises their rights — the full evidence trail from consent grant
        to deletion receipt is retrievable in a single export.
      </p>
      <div className="demo-split">
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">Audit export preview</div>
          </div>
          <div className="demo-panel-body">
            <div className="demo-audit">
              <div className="demo-audit-title">
                Data Principal export · usr_abc123
              </div>
              <div className="demo-audit-meta">
                Range · 14 Apr 2026 → 14 May 2026 · 4 events
              </div>
              <div className="demo-audit-event">
                <div className="demo-audit-event-time">14 Apr 14:32</div>
                <div className="demo-audit-event-desc">
                  <strong style={{ color: 'var(--navy)' }}>
                    Consent granted
                  </strong>{' '}
                  — Necessary + Analytics accepted. Artefacts:
                  CA_01J2K4F7M8N3Q, CA_01J2K4F7N9P4R
                </div>
              </div>
              <div className="demo-audit-event">
                <div className="demo-audit-event-time">14 Apr → 14 May</div>
                <div className="demo-audit-event-desc">
                  <strong style={{ color: 'var(--navy)' }}>
                    847 tracker observations
                  </strong>{' '}
                  — 843 allowed · 4 violations blocked (marketing attempts)
                </div>
              </div>
              <div className="demo-audit-event">
                <div className="demo-audit-event-time">14 May 14:08</div>
                <div className="demo-audit-event-desc">
                  <strong style={{ color: 'var(--navy)' }}>
                    Analytics withdrawn
                  </strong>{' '}
                  — Artefact CA_01J2K4F7N9P4R revoked via preference centre
                </div>
              </div>
              <div className="demo-audit-event">
                <div className="demo-audit-event-time">14 May 14:08</div>
                <div className="demo-audit-event-desc">
                  <strong style={{ color: 'var(--navy)' }}>
                    Deletion receipts
                  </strong>{' '}
                  — GA (0xa3b7…f21c) · Hotjar (0x82c1…9d4f) · Internal DB
                  (0x91d4…7e3a)
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="demo-panel">
          <div className="demo-panel-head">
            <div className="demo-panel-dot" />
            <div className="demo-panel-title">Compliance posture</div>
          </div>
          <div className="demo-panel-body">
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                flex: 1,
              }}
            >
              <div
                style={{
                  padding: '14px 16px',
                  background: 'var(--teal-light)',
                  borderRadius: 8,
                  border: '1px solid rgba(13,122,107,.2)',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                    color: 'var(--teal)',
                    marginBottom: 6,
                  }}
                >
                  Compliance score
                </div>
                <div
                  style={{
                    fontFamily: 'var(--display)',
                    fontSize: 32,
                    fontWeight: 700,
                    color: 'var(--navy)',
                    letterSpacing: '-.02em',
                  }}
                >
                  94
                  <span
                    style={{
                      fontSize: 18,
                      color: 'var(--ink-3)',
                      fontWeight: 500,
                    }}
                  >
                    /100
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--ink-2)',
                    marginTop: 4,
                  }}
                >
                  Observed reality · not self-reported
                </div>
              </div>
              <div
                style={{
                  padding: '12px 14px',
                  background: 'white',
                  border: '1px solid var(--line)',
                  borderRadius: 7,
                  fontSize: '11.5px',
                  color: 'var(--ink-2)',
                }}
              >
                <strong style={{ color: 'var(--navy)' }}>
                  Artefact lineage
                </strong>{' '}
                · 100% · every revocation links to its grant and deletion
                receipts
              </div>
              <div
                style={{
                  padding: '12px 14px',
                  background: 'white',
                  border: '1px solid var(--line)',
                  borderRadius: 7,
                  fontSize: '11.5px',
                  color: 'var(--ink-2)',
                }}
              >
                <strong style={{ color: 'var(--navy)' }}>
                  Export ready
                </strong>{' '}
                · DPB PDF + JSON available · 1-click
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="demo-log">
        <span className="demo-log-line ok">
          <LogTime t="14 May 14:09" />Audit export · usr_abc123 · JSON + PDF
          generated
        </span>
        <span
          className="demo-log-line"
          style={{ animationDelay: '.3s' }}
        >
          <LogTime t="14 May 14:09" />Signed with ConsentShield root key ·
          verifiable offline
        </span>
        <span
          className="demo-log-line ok"
          style={{ animationDelay: '.6s' }}
        >
          <LogTime t="14 May 14:09" />Chain of custody complete · 4 events · 3
          receipts verified
        </span>
      </div>
    </div>
  )
}

export const FRAMES = [
  Frame1UserArrives,
  Frame2BannerRenders,
  Frame3TwoArtefacts,
  Frame4TrackersClassified,
  Frame5Withdrawal,
  Frame6CascadeDeletion,
  Frame7AuditExport,
] as const

// ─── small reusable sub-pieces ────────────────────────────────────────

function LogTime({ t }: { t: string }) {
  return <span className="demo-log-time">{t}</span>
}

function BrowserBar({ url }: { url: string }) {
  return (
    <div className="demo-browser-bar">
      <div className="demo-browser-dots">
        <span className="demo-browser-dot" />
        <span className="demo-browser-dot" />
        <span className="demo-browser-dot" />
      </div>
      <div className="demo-browser-url">{url}</div>
    </div>
  )
}

function PurposeRow({
  name,
  desc,
  last,
}: {
  name: string
  desc: string
  last?: boolean
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        border: '1px solid var(--line)',
        borderRadius: 6,
        fontSize: '11.5px',
        marginBottom: last ? 0 : 6,
        background: 'white',
      }}
    >
      <strong style={{ color: 'var(--navy)' }}>{name}</strong> · {desc}
    </div>
  )
}

function TrackerRow({
  state,
  name,
  purpose,
}: {
  state: 'allowed' | 'blocked'
  name: string
  purpose: string
}) {
  return (
    <div className={`demo-tracker ${state}`}>
      <div className="demo-tracker-status">
        {state === 'allowed' ? 'ALLOW' : 'BLOCK'}
      </div>
      <div className="demo-tracker-name">{name}</div>
      <div className="demo-tracker-purpose">{purpose}</div>
    </div>
  )
}

function PrefRow({
  label,
  labelMuted,
  right,
  rightColor,
  bg = 'white',
  border = 'var(--line)',
}: {
  label: string
  labelMuted?: boolean
  right: string
  rightColor?: string
  bg?: string
  border?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 5,
        fontSize: '11.5px',
        marginBottom: 6,
        color: labelMuted ? 'var(--ink-3)' : undefined,
      }}
    >
      {labelMuted ? (
        <span>{label}</span>
      ) : (
        <strong style={{ color: 'var(--navy)' }}>{label}</strong>
      )}
      <span
        style={{
          color: rightColor,
          fontWeight: rightColor ? 600 : undefined,
        }}
      >
        {right}
      </span>
    </div>
  )
}

function Receipt({
  name,
  hash,
  delay,
}: {
  name: string
  hash: string
  delay: string
}) {
  return (
    <div className="demo-receipt" style={{ animationDelay: delay }}>
      <div className="demo-receipt-sys">{name}</div>
      <div className="demo-receipt-hash">{hash}</div>
      <div className="demo-receipt-check">✓</div>
    </div>
  )
}
