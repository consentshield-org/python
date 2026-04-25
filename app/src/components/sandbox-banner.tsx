import { createServerClient } from '@/lib/supabase/server'

// ADR-1003 Sprint 5.1 R3 — customer-side sandbox-mode banner.
//
// Server Component. Renders nothing when the active org is a
// production org. When the active org has sandbox=true, surfaces a
// purple "Sandbox mode — not for production data" banner across the
// dashboard shell. Sits below the SuspendedOrgBanner so a sandbox org
// that is also suspended renders both bands (rare in practice).
//
// "Active org" resolution: the customer app uses one org at a time
// surfaced by RLS-scoped queries against organisations. We pick the
// first row the caller can see; if you ever expand to multi-org per
// session this needs the same selector logic the rest of the
// dashboard uses to resolve current_org_id.

export async function SandboxOrgBanner() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // ADR-0044 Phase 0 surfaced sandbox=true on organisations; we read
  // it directly. Limit 1 mirrors the SuspendedOrgBanner pattern.
  const { data: orgs } = await supabase
    .from('organisations')
    .select('id, name, sandbox')
    .order('created_at', { ascending: false })
    .limit(1)

  const org = orgs?.[0] as { id: string; name: string; sandbox: boolean } | undefined
  if (!org || org.sandbox !== true) return null

  return (
    <div className="border-b border-purple-700 bg-purple-700 px-6 py-2 text-white">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-purple-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-purple-900">
            Sandbox
          </span>
          <p className="text-sm">
            <strong>{org.name}</strong> is a sandbox org. Do not put real personal data here.{' '}
            API calls use <code className="rounded bg-purple-900/40 px-1 font-mono text-xs">cs_test_*</code>{' '}
            keys; exports are marked <code className="rounded bg-purple-900/40 px-1 font-mono text-xs">{`{ sandbox: true }`}</code>.
          </p>
        </div>
        <a
          href="/dashboard/sandbox"
          className="flex-shrink-0 rounded border border-white bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
        >
          Manage sandbox orgs
        </a>
      </div>
    </div>
  )
}
