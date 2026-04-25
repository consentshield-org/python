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
            DEPA — Data Empowerment and Protection Architecture — is the
            iSPIRT-designed consent infrastructure that underpins India Stack
            and the model the MeitY BRD now requires. ConsentShield&apos;s
            schema was designed artefact-first before the first customer row
            was written:{' '}
            <strong>
              one artefact per purpose, time-bounded, independently
              revocable, machine-readable
            </strong>
            , with chain-of-custody from grant to deletion receipt in a
            single query.
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
