import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ActiveSessionBanner } from '@/components/impersonation/active-session-banner'
import { LogoIcon, Wordmark } from '@/components/brand/logo'

// Operator shell — visual spec: docs/admin/design/consentshield-admin-screens.html.
//
// Wireframe design tokens (navy sidebar + teal primary + red admin-accent,
// DM Sans body) live in admin/src/app/globals.css @theme.
//
// Layout structure matches wireframe:
//   - Fixed admin-mode strip at top (24px, red, uppercase)
//   - Body offset below the strip
//   - Left sidebar: navy-dark + 3px red border-right
//       · Logo mark (red square icon + "ConsentShield" + "ADMIN" subtitle)
//       · Session chip (translucent outline, AAL indicator)
//       · Nav (translucent white with red active state + 3px left border)
//       · User row at bottom + sign-out
//   - Main area: white surface topbar + content
//
// ADR-0028 Sprint 1.1 — session-aware chip + sign-out + live nav links.

interface NavItem {
  label: string
  href: string
  adr: string
  live: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Operations Dashboard', href: '/', adr: 'ADR-0028', live: true },
  { label: 'Organisations', href: '/orgs', adr: 'ADR-0029', live: true },
  { label: 'Accounts', href: '/accounts', adr: 'ADR-0048', live: true },
  { label: 'Support Tickets', href: '/support', adr: 'ADR-0032', live: true },
  { label: 'Sectoral Templates', href: '/templates', adr: 'ADR-0030', live: true },
  { label: 'Connector Catalogue', href: '/connectors', adr: 'ADR-0031', live: true },
  { label: 'Tracker Signatures', href: '/signatures', adr: 'ADR-0031', live: true },
  { label: 'Pipeline Operations', href: '/pipeline', adr: 'ADR-0033', live: true },
  { label: 'Billing', href: '/billing', adr: 'ADR-0050', live: true },
  { label: 'Billing Operations', href: '/billing/operations', adr: 'ADR-0034', live: true },
  { label: 'Abuse & Security', href: '/security', adr: 'ADR-0033', live: true },
  { label: 'Feature Flags & Kill Switches', href: '/flags', adr: 'ADR-0036', live: true },
  { label: 'Admin Users', href: '/admins', adr: 'ADR-0045', live: true },
  { label: 'Audit Log', href: '/audit-log', adr: 'ADR-0028', live: true },
]

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminRole =
    (user.app_metadata?.admin_role as string | undefined) ?? 'platform_operator'

  const { data: adminRow } = await supabase
    .schema('admin')
    .from('admin_users')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()

  const displayName =
    adminRow?.display_name ?? user.email?.split('@')[0] ?? 'operator'
  const avatarInitials = displayName
    .split(/\s+/)
    .filter((p: string) => p.length > 0)
    .map((p: string) => p.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      {/* Admin-mode strip — fixed top banner, red, uppercase (Rule 25 visual) */}
      <div
        className="fixed top-0 left-0 right-0 z-50 flex h-6 items-center justify-center bg-admin-accent text-[11px] font-semibold uppercase tracking-[.04em] text-white"
      >
        ConsentShield · Operator Console
      </div>

      {/* Impersonation banner (renders null when inactive) */}
      <ActiveSessionBanner />

      <div className="flex h-[calc(100vh-24px)] pt-6">
        <aside
          className="flex w-60 flex-col border-r-[3px] border-admin-accent"
          style={{ background: 'var(--navy-dark)' }}
        >
          {/* Logo — brand icon + wordmark. Brand-PDF spec: navy rounded-sq + teal
              shield + white check for primary contexts; on the navy sidebar we use
              the gradient variant so the icon reads distinctly against navy-dark. */}
          <div className="border-b border-white/[.08] px-[18px] pb-[14px] pt-[18px]">
            <div className="flex items-center gap-[10px]">
              <LogoIcon size={32} variant="gradient" />
              <Wordmark theme="dark" size={16} tagline="Admin Console" />
            </div>
          </div>

          {/* Session chip */}
          <div
            className="mx-[18px] mt-3 rounded-md border border-admin-accent/40 px-[10px] py-2 text-[11px]"
            style={{ background: 'rgba(255,255,255,.06)' }}
          >
            <div className="flex items-center justify-between text-white/50">
              <span>Role</span>
              <span className="font-medium text-white">{adminRole}</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-[#86EFAC]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              AAL2 verified
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-3">
            <ul className="space-y-0.5 px-[10px]">
              {NAV_ITEMS.map((item) => (
                <li key={item.label}>
                  <NavLink item={item} />
                </li>
              ))}
            </ul>
          </nav>

          {/* Footer: user row + sign out */}
          <div className="border-t border-white/[.08] px-[18px] py-[14px]">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-admin-accent text-[11px] font-semibold text-white">
                {avatarInitials || 'OP'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-white">
                  {displayName}
                </div>
                <div className="truncate text-[10px] text-admin-accent-soft">
                  {user.email}
                </div>
              </div>
            </div>
            <form action="/api/auth/signout" method="post" className="mt-3">
              <button
                type="submit"
                className="w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </>
  )
}

function NavLink({ item }: { item: NavItem }) {
  if (!item.live) {
    return (
      <span
        className="flex cursor-not-allowed items-center gap-2 rounded-md px-[10px] py-2 text-[13px] text-white/30"
        title={`Ships in ${item.adr}`}
      >
        <span className="flex-1">{item.label}</span>
        <span
          className="rounded-[10px] px-1.5 py-px text-[10px] font-semibold text-white/60"
          style={{ background: 'rgba(255,255,255,.15)' }}
        >
          soon
        </span>
      </span>
    )
  }
  return (
    <Link
      href={item.href}
      className="flex items-center gap-2 rounded-md px-[10px] py-2 text-[13px] text-white/55 transition-colors hover:bg-white/[.07] hover:text-white/90"
    >
      {item.label}
    </Link>
  )
}
