import type { ReactNode } from 'react'

interface Row {
  capability: string
  neg: string
  pos: ReactNode
}

const ROWS: Row[] = [
  {
    capability: 'Consent data model',
    neg: 'A single event row with an array of accepted purpose labels.',
    pos: (
      <>
        One independently addressable <strong>artefact per purpose</strong>,
        with scope, expiry, and revocation chain.
      </>
    ),
  },
  {
    capability: 'Consent expiry',
    neg: 'Not tracked. Consent is indefinitely open-ended.',
    pos: (
      <>
        Every artefact has an explicit expiry.{' '}
        <strong>30-day ahead alerts; deletion on lapse</strong> if configured.
      </>
    ),
  },
  {
    capability: 'Consent withdrawal',
    neg: 'Fire a webhook, hope for the best.',
    pos: (
      <>
        Revoke the artefact, cascade deletion to{' '}
        <strong>exactly the systems it authorised</strong>, verify via re-scan.
      </>
    ),
  },
  {
    capability: 'Data deletion',
    neg: 'A reminder that retention expired.',
    pos: (
      <>
        Orchestrate deletion across connected systems{' '}
        <strong>scoped to the artefact&apos;s data scope</strong>, collect
        signed receipts.
      </>
    ),
  },
  {
    capability: 'Consent verification',
    neg: '"Banner is live" checkbox.',
    pos: (
      <>
        Active monitoring —{' '}
        <strong>
          are third-party trackers respecting consent decisions
        </strong>{' '}
        in real time?
      </>
    ),
  },
  {
    capability: 'Framework coverage',
    neg: 'GDPR only, or DPDP layered on a GDPR schema.',
    pos: (
      <>
        One artefact model covers <strong>DPDP, ABDM, and GDPR</strong>.
        Different framework labels, one audit trail.
      </>
    ),
  },
  {
    capability: 'Audit trail',
    neg: 'Self-reported configuration history.',
    pos: (
      <>
        Chain of custody from{' '}
        <strong>consent grant to deletion receipt</strong>, queryable in a
        single pass.
      </>
    ),
  },
]

export function DepaCompare() {
  return (
    <section className="depa-compare">
      <div className="depa-compare-head">
        <span className="eyebrow">DEPA-native vs GDPR-adapted</span>
        <h2 className="display-md">
          A structural difference, not a feature difference.
        </h2>
        <p>
          Every Indian compliance tool will have a feature list overlapping
          with ConsentShield&apos;s. What they can&apos;t match is the data
          model underneath — because you can&apos;t retrofit DEPA onto a GDPR
          event-array schema. It has to be there from the first row.
        </p>
      </div>
      <div className="depa-table">
        <div className="depa-table-wrap">
          <div className="depa-row head">
            <div className="depa-cell">Capability</div>
            <div className="depa-cell">GDPR-adapted (most tools)</div>
            <div className="depa-cell teal">
              ConsentShield — DEPA-native
            </div>
          </div>
          {ROWS.map((r) => (
            <div key={r.capability} className="depa-row">
              <div className="depa-cell capability">{r.capability}</div>
              <div className="depa-cell neg">{r.neg}</div>
              <div className="depa-cell pos">{r.pos}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
