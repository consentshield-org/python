'use client'

import { useState } from 'react'

// Pill-style Monthly/Annual toggle. In the HTML spec the toggle is
// cosmetic — the pricing table shows both monthly and annual ranges
// in every row, so flipping doesn't mutate numbers. We preserve that
// intent: local state tracks which pill is lit; no down-stream effect.
export function PriceToggle() {
  const [mode, setMode] = useState<'monthly' | 'annual'>('monthly')
  return (
    <div className="price-toggle">
      <button
        type="button"
        onClick={() => setMode('monthly')}
        className={mode === 'monthly' ? 'active' : ''}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => setMode('annual')}
        className={mode === 'annual' ? 'active' : ''}
      >
        Annual{' '}
        <span style={{ color: 'var(--teal)', fontWeight: 600 }}>−20%</span>
      </button>
    </div>
  )
}
