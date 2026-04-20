'use client'

import { useState } from 'react'
import { FeatureFlagsTab, type FeatureFlag } from './feature-flags-tab'
import { KillSwitchesTab, type KillSwitch } from './kill-switches-tab'

type AdminRole = 'platform_operator' | 'support' | 'read_only'

export function FlagsTabs({
  activeTab,
  flags,
  switches,
  orgs,
  accounts,
  adminRole,
}: {
  activeTab: 'flags' | 'kill-switches'
  flags: FeatureFlag[]
  switches: KillSwitch[]
  orgs: Array<{ id: string; name: string }>
  accounts: Array<{ id: string; name: string }>
  adminRole: AdminRole
}) {
  const [tab, setTab] = useState<'flags' | 'kill-switches'>(activeTab)

  return (
    <>
      <div className="flex items-center gap-1 border-b border-[color:var(--border)]">
        <TabButton active={tab === 'flags'} onClick={() => setTab('flags')}>
          Feature flags
        </TabButton>
        <TabButton
          active={tab === 'kill-switches'}
          onClick={() => setTab('kill-switches')}
        >
          Kill switches
        </TabButton>
      </div>

      {tab === 'flags' ? (
        <FeatureFlagsTab
          flags={flags}
          orgs={orgs}
          accounts={accounts}
          adminRole={adminRole}
        />
      ) : (
        <KillSwitchesTab switches={switches} adminRole={adminRole} />
      )}
    </>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'border-b-2 border-red-700 px-4 py-2 text-sm font-semibold text-red-800'
          : 'border-b-2 border-transparent px-4 py-2 text-sm text-text-2 hover:text-text'
      }
    >
      {children}
    </button>
  )
}
