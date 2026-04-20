interface Principle {
  num: string
  title: string
  desc: string
}

const PRINCIPLES: Principle[] = [
  {
    num: 'P01',
    title: 'Artefact scoped',
    desc: 'One artefact per purpose. Analytics, marketing, and personalisation are separately addressable — not bundled into one event row.',
  },
  {
    num: 'P02',
    title: 'Data scoped',
    desc: 'Each artefact declares which data fields it covers, drawn from the Purpose Definition Registry. Revocation stops exactly those flows.',
  },
  {
    num: 'P03',
    title: 'Time bounded',
    desc: 'Every artefact has an explicit expiry. Consent is not indefinitely open-ended. 30-day ahead re-consent alerts; auto-deletion on lapse.',
  },
  {
    num: 'P04',
    title: 'Unified framework',
    desc: 'The same artefact model works across DPDP, ABDM, and GDPR. One audit trail — different framework labels.',
  },
  {
    num: 'P05',
    title: 'Chain of custody',
    desc: 'Every revocation links to the artefact, the deletion requests it triggered, and the receipts that confirmed completion — in one query.',
  },
]

export function DepaMoat() {
  return (
    <section className="depa-moat">
      <div className="depa-inner">
        <div className="depa-head">
          <span className="eyebrow on-dark">The architectural moat</span>
          <h2 className="display-md" style={{ color: 'white' }}>
            Built on DEPA — not retrofitted from GDPR.
          </h2>
          <p className="lede">
            Every India-focused competitor uses a GDPR-adapted consent model: a
            single event row with an array of accepted purposes. This works for
            cookie banners. It does not satisfy DEPA&apos;s core requirement —{' '}
            <strong>
              that each data flow is authorised by a discrete, independently
              revocable, time-bounded, machine-readable artefact
            </strong>
            .
          </p>
        </div>
        <div className="depa-principles">
          {PRINCIPLES.map((p) => (
            <div key={p.num} className="depa-p">
              <div className="depa-p-num">{p.num}</div>
              <div className="depa-p-title">{p.title}</div>
              <div className="depa-p-desc">{p.desc}</div>
            </div>
          ))}
        </div>
        <div className="depa-footnote">
          <p>
            DEPA-native artefacts are not a feature. They are a foundational
            architectural choice that cannot be retrofitted onto GDPR-style
            data models. ConsentShield&apos;s schema was designed with DEPA at
            the core before the first customer row was written.
          </p>
        </div>
      </div>
    </section>
  )
}
