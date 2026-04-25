export function Story() {
  return (
    <section className="story">
      <div className="container">
        <div className="story-head">
          <span className="eyebrow">The three-part compliance lifecycle</span>
          <h2 className="display-md">Collect. Enforce. Prove.</h2>
          <p>
            Three jobs that every Indian business processing personal data now
            has to do. ConsentShield is the operational layer that makes each
            one automatic — and the chain between them auditable.
          </p>
        </div>
        <div className="story-grid">
          <StoryCard
            num="01"
            title="Collect"
            body="DEPA-native consent artefacts — one per purpose, not a checkbox array. Each artefact has defined scope, expiry, and revocation chain. Installable in hours via a CDN-hosted snippet."
            points={[
              'No-code banner builder per web property',
              'Purpose Definition Registry foundation',
              'ABDM + DPDP + GDPR, one artefact model',
            ]}
            icon={
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7h16v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M4 11h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            }
          />
          <StoryCard
            num="02"
            title="Enforce"
            body="Real-time tracker monitoring against a signature database. When a user withdraws consent, ConsentShield revokes the artefact, evicts it from the validity cache, and issues a signed deletion request to each connected system. Connectors perform the actual delete and post back a signed receipt; tracker observations are correlated against revoked artefacts to flag any downstream firing."
            points={[
              'Tracker detection for GA, Meta, CleverTap, Razorpay, others',
              'Artefact-scoped deletion with signed receipts',
              'Consent probe testing + security posture scans',
            ]}
            icon={
              <svg viewBox="0 0 24 24" fill="none">
                <circle
                  cx="12"
                  cy="12"
                  r="8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M12 8v4l3 2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
          <StoryCard
            num="03"
            title="Prove"
            body={
              <>
                One-click DPB-ready evidence package. The full artefact
                register, consent logs, tracker observations, violation
                history, and deletion receipts — written to{' '}
                <strong>your</strong> storage, not ours. ConsentShield is a
                stateless oracle.
              </>
            }
            points={[
              'Customer owns the canonical compliance record',
              'Chain of custody from consent to deletion',
              'Audit export formatted for DPB inspection',
            ]}
            icon={
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 4h11l4 4v12a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M8 12l2.5 2.5L16 9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
        </div>
      </div>
    </section>
  )
}

function StoryCard({
  num,
  title,
  body,
  points,
  icon,
}: {
  num: string
  title: string
  body: React.ReactNode
  points: string[]
  icon: React.ReactNode
}) {
  return (
    <div className="story-card">
      <span className="story-num">{num}</span>
      <div className="story-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="story-points">
        {points.map((p) => (
          <div key={p} className="story-point">
            <span className="story-point-dot">→</span>
            {p}
          </div>
        ))}
      </div>
    </div>
  )
}
