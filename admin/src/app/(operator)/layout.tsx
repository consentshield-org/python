import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ActiveSessionBanner } from '@/components/impersonation/active-session-banner'

// Operator shell. Red admin-mode strip + red sidebar border per the
// admin wireframe (docs/admin/design/consentshield-admin-screens.html).
//
// ADR-0026 Sprint 3.1 — layout skeleton.
// ADR-0028 Sprint 1.1 — session-aware chip + sign-out + live nav links
// for panels that have shipped.

interface NavItem {
  label: string
  href: string
  adr: string
  live: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Operations Dashboard', href: '/', adr: 'ADR-0028', live: true },
  { label: 'Organisations', href: '/orgs', adr: 'ADR-0029', live: true },
  { label: 'Support Tickets', href: '#', adr: 'ADR-0032', live: false },
  { label: 'Sectoral Templates', href: '/templates', adr: 'ADR-0030', live: true },
  { label: 'Connector Catalogue', href: '#', adr: 'ADR-0031', live: false },
  { label: 'Tracker Signatures', href: '#', adr: 'ADR-0031', live: false },
  { label: 'Pipeline Operations', href: '#', adr: 'ADR-0033', live: false },
  { label: 'Billing Operations', href: '#', adr: 'ADR-0034', live: false },
  { label: 'Abuse & Security', href: '#', adr: 'ADR-0035', live: false },
  { label: 'Feature Flags & Kill Switches', href: '/flags', adr: 'ADR-0036', live: true },
  { label: 'Audit Log', href: '/audit-log', adr: 'ADR-0028', live: true },
]

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The proxy has already enforced is_admin + AAL2 (or bypassed AAL2 in
  // dev). We read the session purely for display purposes here — the
  // security gate is upstream.
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Defence-in-depth; the proxy should have redirected already.
    redirect('/login')
  }

  const adminRole = (user.app_metadata?.admin_role as string | undefined) ?? 'platform_operator'

  // Resolve display_name via admin.admin_users. Falls back to the email
  // local-part if the row is missing (pre-bootstrap state — should not
  // happen in normal flow but keeps the layout resilient).
  const { data: adminRow } = await supabase
    .schema('admin')
    .from('admin_users')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()

  const displayName =
    adminRow?.display_name ?? user.email?.split('@')[0] ?? 'operator'

  return (
    <div className="min-h-screen">
      {/* Impersonation banner — renders nothing when no session is active */}
      <ActiveSessionBanner />

      {/* Admin-mode strip (Rule 25 visual cue) */}
      <div className="bg-red-700 py-1 text-center text-xs font-mono uppercase tracking-wider text-white">
        ConsentShield — Operator Console (Admin Mode)
      </div>

      <div className="flex min-h-[calc(100vh-28px)]">
        <aside className="flex w-64 flex-col border-r-2 border-red-700 bg-white">
          <div className="border-b border-zinc-200 p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-red-700">
              Admin
            </p>
            <p className="mt-1 text-sm font-semibold">ConsentShield</p>
          </div>

          {/* Session chip */}
          <div className="border-b border-zinc-200 p-3">
            <div className="rounded border border-red-200 bg-red-50 p-2">
              <p className="truncate text-sm font-semibold text-zinc-900">
                {displayName}
              </p>
              <p className="truncate text-xs text-red-800">
                {adminRole} · AAL2 verified
              </p>
            </div>
          </div>

          <nav className="flex-1 p-2">
            <ul className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className={
                      item.live
                        ? 'block rounded px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-100'
                        : 'pointer-events-none block rounded px-3 py-2 text-sm text-zinc-400'
                    }
                    title={`Ships in ${item.adr}`}
                  >
                    {item.label}
                    {!item.live && (
                      <span className="ml-2 text-xs text-zinc-400">· soon</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Footer: sign out */}
          <form action="/api/auth/signout" method="post" className="border-t border-zinc-200 p-3">
            <button
              type="submit"
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Sign out
            </button>
          </form>
        </aside>

        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  )
}
