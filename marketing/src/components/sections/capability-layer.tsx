export interface Feature {
  name: string
  desc: React.ReactNode
}

export function CapabilityLayer({
  tag,
  title,
  lede,
  features,
}: {
  tag: string
  title: React.ReactNode
  lede: React.ReactNode
  features: Feature[]
}) {
  return (
    <section className="capability-layer">
      <div className="layer-head">
        <div>
          <span className="layer-tag">{tag}</span>
          <h2>{title}</h2>
        </div>
        <p className="lede">{lede}</p>
      </div>
      <div className="feature-grid">
        {features.map((f) => (
          <div key={f.name} className="feature">
            <h4 className="feature-name">{f.name}</h4>
            <p className="feature-desc">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
