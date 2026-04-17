import { createServerClient } from '@/lib/supabase/server'
import { FlagsTabs } from '@/components/flags/flags-tabs'

// ADR-0036 Sprint 1.1 — Feature Flags & Kill Switches panel.
//
// Server Component reading admin.feature_flags (joined with
// admin.admin_users to show "Set by") and admin.kill_switches. Both
// tables are readable by any admin role; writes are gated at the RPC
// layer (platform_operator only).
//
// Tab selection is ?tab=flags (default) or ?tab=kill-switches, used
// by deep links from the Ops Dashboard KillSwitchesCard.

export const dynamic = 'force-dynamic'

interface FeatureFlag {
  id: string
  flag_key: string
  scope: 'global' | 'org'
  org_id: string | null
  value: unknown
  description: string
  set_by: string
  set_at: string
  expires_at: string | null
  set_by_name: string | null
  org_name: string | null
}

interface KillSwitch {
  switch_key: string
  display_name: string
  description: string
  enabled: boolean
  reason: string | null
  set_at: string
  set_by_name: string | null
}

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function FlagsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const activeTab: 'flags' | 'kill-switches' =
    params.tab === 'kill-switches' ? 'kill-switches' : 'flags'

  const supabase = await createServerClient()

  // Role for the UI to gate write actions visually. RPC still enforces.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const adminRole =
    (user?.app_metadata?.admin_role as
      | 'platform_operator'
      | 'support'
      | 'read_only'
      | undefined) ?? 'read_only'

  const [flagsRes, switchesRes, adminsRes, orgsRes] = await Promise.all([
    supabase
      .schema('admin')
      .from('feature_flags')
      .select('id, flag_key, scope, org_id, value, description, set_by, set_at, expires_at')
      .order('flag_key'),
    supabase
      .schema('admin')
      .from('kill_switches')
      .select('switch_key, display_name, description, enabled, reason, set_at, set_by')
      .order('switch_key'),
    supabase.schema('admin').from('admin_users').select('id, display_name'),
    supabase.from('organisations').select('id, name').order('name'),
  ])

  const adminById = new Map<string, string>()
  for (const a of adminsRes.data ?? []) {
    adminById.set(a.id, a.display_name)
  }

  const orgById = new Map<string, string>()
  const orgs: Array<{ id: string; name: string }> = []
  for (const o of orgsRes.data ?? []) {
    orgById.set(o.id, o.name)
    orgs.push({ id: o.id, name: o.name })
  }

  const flags: FeatureFlag[] = (flagsRes.data ?? []).map((f) => ({
    id: f.id,
    flag_key: f.flag_key,
    scope: f.scope,
    org_id: f.org_id,
    value: f.value,
    description: f.description,
    set_by: f.set_by,
    set_at: f.set_at,
    expires_at: f.expires_at,
    set_by_name: adminById.get(f.set_by) ?? null,
    org_name: f.org_id ? orgById.get(f.org_id) ?? null : null,
  }))

  const switches: KillSwitch[] = (switchesRes.data ?? []).map((s) => ({
    switch_key: s.switch_key,
    display_name: s.display_name,
    description: s.description,
    enabled: s.enabled,
    reason: s.reason,
    set_at: s.set_at,
    set_by_name: s.set_by ? adminById.get(s.set_by) ?? null : null,
  }))

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Feature Flags &amp; Kill Switches</h1>
          <p className="text-sm text-zinc-600">
            platform_operator role required for all writes · reason ≥ 10 chars
          </p>
        </div>
      </header>

      <FlagsTabs
        activeTab={activeTab}
        flags={flags}
        switches={switches}
        orgs={orgs}
        adminRole={adminRole}
      />
    </div>
  )
}
