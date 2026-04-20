interface TimelineEntry {
  status: string
  label: string
  date: string
  event: string
  impact: string
  variant?: 'done' | 'warning' | ''
}

const ENTRIES: TimelineEntry[] = [
  {
    variant: 'done',
    status: 'Done',
    label: 'Stage 1',
    date: '13 Nov 2025',
    event: 'DPDP Rules notified. Data Protection Board established.',
    impact:
      'Legal obligation confirmed. Planning mode begins across every sector. No further ambiguity on whether DPDP applies.',
  },
  {
    variant: '',
    status: 'Next',
    label: 'Stage 2',
    date: '13 Nov 2026',
    event: 'Consent Manager framework operational. Registration opens.',
    impact:
      'Businesses must appoint or use a registered Consent Manager. The operational compliance posture needs to be live — not a legal memo.',
  },
  {
    variant: 'warning',
    status: 'Deadline',
    label: 'Stage 3',
    date: '13 May 2027',
    event:
      'Full enforcement. Processing obligations, rights architecture, and penalties.',
    impact:
      'Penalties of up to ₹250 crore per violation. Cumulative exposure up to ₹650 crore. The DEPA artefact register is the evidence that proves compliance.',
  },
]

export function Timeline() {
  return (
    <section className="timeline">
      <div className="container">
        <div className="timeline-head">
          <span className="eyebrow">The enforcement clock</span>
          <h2 className="display-md">Three dates define the next 12 months.</h2>
          <p>
            Every commercial conversation about DPDP in 2026 should be anchored
            to these three dates. The middle one is the hinge — Consent Manager
            infrastructure goes live. The last one is the bill.
          </p>
        </div>
        <div className="timeline-grid">
          {ENTRIES.map((e) => (
            <div
              key={e.label}
              className={`tl-card${e.variant ? ` ${e.variant}` : ''}`}
            >
              <span className="tl-status">{e.status}</span>
              <div className="tl-label">{e.label}</div>
              <div className="tl-date">{e.date}</div>
              <div className="tl-event">{e.event}</div>
              <p className="tl-impact">{e.impact}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
