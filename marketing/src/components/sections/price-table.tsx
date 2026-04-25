import type { ReactNode } from 'react'

type Cell = '✓' | '—' | ReactNode

interface Row {
  feature: string
  starter: Cell
  growth: Cell
  pro: Cell
  enterprise: Cell
}

interface Group {
  name: string
  rows: Row[]
}

const GROUPS: Group[] = [
  {
    name: 'Compliance foundation',
    rows: [
      {
        feature: 'Consent banner + DEPA artefacts',
        starter: '✓',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Purpose Definition Registry',
        starter: '✓',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Tracker enforcement',
        starter: '✓',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Privacy notice + data inventory',
        starter: '✓',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: '72-hour breach workflow',
        starter: '✓',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
    ],
  },
  {
    name: 'Enforcement depth',
    rows: [
      {
        feature: 'Rights management + SLA',
        starter: '—',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Consent expiry management',
        starter: '—',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Withdrawal verification',
        starter: '—',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Security posture scans',
        starter: '—',
        growth: '✓',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Artefact-scoped deletion',
        starter: '—',
        growth: '3 connectors',
        pro: '13 connectors',
        enterprise: 'Unlimited',
      },
    ],
  },
  {
    name: 'Multi-framework + ecosystem',
    rows: [
      {
        feature: 'GDPR module',
        starter: '—',
        growth: '—',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Consent probe testing',
        starter: '—',
        growth: '—',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'Compliance API',
        starter: '—',
        growth: '—',
        pro: '✓',
        enterprise: '✓',
      },
      {
        feature: 'BFSI template (NBFC + Broking)',
        starter: '—',
        growth: '—',
        pro: '✓',
        enterprise: '✓',
      },
    ],
  },
  {
    name: 'Enterprise-only',
    rows: [
      {
        feature: 'White-label + custom domains (phased — ADR-0800)',
        starter: '—',
        growth: '—',
        pro: '—',
        enterprise: '✓',
      },
      {
        feature: 'DPO matchmaking (Proposed · Q3/Q4 2026)',
        starter: '—',
        growth: '—',
        pro: '—',
        enterprise: '✓',
      },
      {
        feature: 'BFSI Regulatory Exemption Engine',
        starter: '—',
        growth: '—',
        pro: '—',
        enterprise: '✓',
      },
    ],
  },
]

export function PriceTable() {
  return (
    <div className="price-table-wrap">
      <div className="price-table">
        <div className="price-thead">
          <div className="price-th label">Capability</div>
          <div className="price-th">
            <div className="price-th-name">Starter</div>
            <div className="price-th-amt">
              ₹2,999
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ink-3)',
                }}
              >
                /mo
              </span>
            </div>
            <div className="price-th-per">₹24,000–50,000/yr</div>
          </div>
          <div
            className="price-th"
            style={{
              background: 'rgba(15,45,91,.04)',
              borderLeft: '1px solid var(--line)',
              borderRight: '1px solid var(--line)',
            }}
          >
            <div className="price-th-name" style={{ color: 'var(--teal)' }}>
              Growth
            </div>
            <div className="price-th-amt">
              ₹5,999
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ink-3)',
                }}
              >
                /mo
              </span>
            </div>
            <div className="price-th-per">
              ₹50,000–1,00,000/yr · Most chosen
            </div>
          </div>
          <div className="price-th">
            <div className="price-th-name">Pro</div>
            <div className="price-th-amt">
              ₹9,999
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ink-3)',
                }}
              >
                /mo
              </span>
            </div>
            <div className="price-th-per">₹1,00,000–3,00,000/yr</div>
          </div>
          <div className="price-th">
            <div className="price-th-name">Enterprise</div>
            <div className="price-th-amt">
              ₹24,999
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ink-3)',
                }}
              >
                +/mo
              </span>
            </div>
            <div className="price-th-per">₹3,00,000–5,00,000/yr</div>
          </div>
        </div>

        {GROUPS.map((g) => (
          <GroupRows key={g.name} group={g} />
        ))}
      </div>
    </div>
  )
}

function GroupRows({ group }: { group: Group }) {
  return (
    <>
      <div className="price-trow group">
        <div className="price-tcell">{group.name}</div>
        <div className="price-tcell"></div>
        <div className="price-tcell"></div>
        <div className="price-tcell"></div>
        <div className="price-tcell"></div>
      </div>
      {group.rows.map((r) => (
        <div key={r.feature} className="price-trow">
          <div className="price-tcell feat">{r.feature}</div>
          <PriceCell value={r.starter} />
          <PriceCell value={r.growth} />
          <PriceCell value={r.pro} />
          <PriceCell value={r.enterprise} />
        </div>
      ))}
    </>
  )
}

function PriceCell({ value }: { value: Cell }) {
  if (value === '✓')
    return <div className="price-tcell check">✓</div>
  if (value === '—')
    return <div className="price-tcell dash">—</div>
  return (
    <div
      className="price-tcell"
      style={{
        justifyContent: 'center',
        fontSize: 12,
        color: 'var(--ink-2)',
      }}
    >
      {value}
    </div>
  )
}
