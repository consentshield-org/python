export function Contrast() {
  return (
    <section className="contrast">
      <div className="container">
        <div className="contrast-head">
          <span className="eyebrow">The category shift</span>
          <h2 className="display-md">
            Documentation tools check a box.
            <br />
            Enforcement engines check reality.
          </h2>
          <p>
            Every other DPDP tool in India is a documentation tool. They
            record what you <em>say</em> your compliance posture is.
            ConsentShield records what your website <em>actually does</em>.
          </p>
        </div>
        <div className="contrast-grid">
          <div className="contrast-side neg">
            <div className="contrast-tag">Documentation tool</div>
            <div className="contrast-q">
              &ldquo;Have you configured your consent banner?&rdquo;
            </div>
            <p className="contrast-a">
              A self-reported checkbox. The tool has no idea whether trackers
              on your site are respecting the banner. If a marketing script
              fires before consent — or keeps firing after withdrawal — you
              find out when a Data Principal files a complaint.
            </p>
          </div>
          <div className="contrast-side pos">
            <div className="contrast-tag">ConsentShield</div>
            <div className="contrast-q">
              &ldquo;Is your banner being respected by the trackers on your
              site right now?&rdquo;
            </div>
            <p className="contrast-a">
              Real-time observation. Every third-party script that loads is
              classified against a signature database. Violations surface in
              the dashboard before they surface in a DPB notice. Withdrawal
              verification confirms deletion actually happened.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
