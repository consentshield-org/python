'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/properties', label: 'Web Properties' },
  { href: '/dashboard/banners', label: 'Banners' },
  { href: '/dashboard/notices', label: 'Privacy Notices' },
  { href: '/dashboard/purposes', label: 'Purpose Definitions' },
  { href: '/dashboard/artefacts', label: 'Consent Artefacts' },
  { href: '/dashboard/enforcement', label: 'Enforcement' },
  { href: '/dashboard/probes', label: 'Consent Probes' },
  { href: '/dashboard/inventory', label: 'Data Inventory' },
  { href: '/dashboard/compliance/retention', label: 'Retention & Exemptions' },
  { href: '/dashboard/template', label: 'Sector template' },
  { href: '/dashboard/rights', label: 'Rights Requests' },
  { href: '/dashboard/dpia', label: 'DPIA Records' },
  { href: '/dashboard/auditors', label: 'Auditor Engagements' },
  { href: '/dashboard/integrations', label: 'Integrations' },
  { href: '/dashboard/billing', label: 'Billing' },
  { href: '/dashboard/support', label: 'Support' },
  { href: '/dashboard/support-sessions', label: 'Support sessions' },
  { href: '/dashboard/settings/account', label: 'Account settings' },
  { href: '/dashboard/settings/members', label: 'Team & invites' },
  { href: '/dashboard/settings/api-keys', label: 'API keys' },
  { href: '/dashboard/settings/notifications', label: 'Notification channels' },
  { href: '/dashboard/settings/billing', label: 'Billing settings' },
]

export function DashboardNav() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-56 border-r border-gray-200 bg-gray-50 p-4 flex flex-col">
      <div className="mb-6">
        <h1 className="text-lg font-bold">ConsentShield</h1>
        <p className="text-xs text-gray-500">DPDP compliance</p>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm ${
                active
                  ? 'bg-black text-white'
                  : 'text-gray-700 hover:bg-gray-200'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <button
        onClick={handleSignOut}
        className="mt-4 rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-200"
      >
        Sign out
      </button>
    </aside>
  )
}
