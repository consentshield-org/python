import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { canOperate, type AdminRole } from '@/lib/admin/role-tiers'
import { OrgActionBar } from '@/components/orgs/action-bar'
import { AccountContextCard } from '@/components/account-context/account-context-card'
import { AdminMembersSection, type MemberRow as AdminMemberRow } from './members-section'
import { SdfCard } from './sdf-card'

// ADR-0029 Sprint 1.1 — Organisation detail page (read-only).
//
// Server Component. Fetches the org + peripheral data in parallel:
//   * public.organisations row
//   * org_memberships (for contact list)
//   * web_properties count
//   * integration_connectors count
//   * admin.org_notes (most recent first)
//   * admin.impersonation_sessions for this org (most recent first)
//
// Reason-gated write actions (add note, extend trial, suspend, restore,
// start impersonation) land in Sprint 2.1 + 3.1. This page only shows
// the "Open" affordances as disabled/tooltip until those sprints.

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ orgId: string }>
}

export default async function OrganisationDetailPage({ params }: PageProps) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const [orgRes, membersRes, propertiesRes, integrationsRes, notesRes, sessionsRes, userRes, listMembersRes] =
    await Promise.all([
      supabase
        .from('organisations')
        .select('*, accounts(plan_code, trial_ends_at, razorpay_subscription_id, razorpay_customer_id, status, created_at)')
        .eq('id', orgId)
        .maybeSingle(),
      supabase
        .from('org_memberships')
        .select('user_id, role')
        .eq('org_id', orgId),
      supabase
        .from('web_properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId),
      supabase
        .from('integration_connectors')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId),
      supabase
        .schema('admin')
        .from('org_notes')
        .select('id, body, pinned, admin_user_id, created_at')
        .eq('org_id', orgId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .schema('admin')
        .from('impersonation_sessions')
        .select('id, admin_user_id, reason, reason_detail, started_at, ended_at, status')
        .eq('target_org_id', orgId)
        .order('started_at', { ascending: false })
        .limit(10),
      supabase.auth.getUser(),
      supabase.rpc('list_members'),
    ])

  const org = orgRes.data
  if (!org) notFound()

  const adminRole =
    (userRes.data.user?.app_metadata?.admin_role as AdminRole) ?? 'read_only'

  const noteAuthorIds = Array.from(new Set((notesRes.data ?? []).map((n) => n.admin_user_id)))
  const sessionAdminIds = Array.from(
    new Set((sessionsRes.data ?? []).map((s) => s.admin_user_id)),
  )
  const adminIds = Array.from(new Set([...noteAuthorIds, ...sessionAdminIds]))

  const { data: admins } =
    adminIds.length > 0
      ? await supabase
          .schema('admin')
          .from('admin_users')
          .select('id, display_name')
          .in('id', adminIds)
      : { data: [] as Array<{ id: string; display_name: string | null }> }

  const adminNameById = new Map(
    (admins ?? []).map((a) => [a.id, a.display_name ?? null]),
  )

  const propCount = propertiesRes.count ?? 0
  const integrationCount = integrationsRes.count ?? 0
  const notes = notesRes.data ?? []
  const sessions = sessionsRes.data ?? []
  const members = membersRes.data ?? []

  interface ListMembersRow {
    scope: 'account' | 'org'
    org_id: string | null
    user_id: string
    email: string
    role: string
  }
  const orgMembers: AdminMemberRow[] = (
    (listMembersRes.data ?? []) as ListMembersRow[]
  )
    .filter((r) => r.scope === 'org' && r.org_id === orgId)
    .map((r) => ({ userId: r.user_id, email: r.email, role: r.role }))

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <Link
            href="/orgs"
            className="text-xs text-text-3 hover:text-text"
          >
            ← All organisations
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{org.name}</h1>
          <p className="text-xs text-text-3">
            <code className="font-mono">{org.id}</code>
            {' · '}
            {org.compliance_contact_email ?? 'no contact email'}
          </p>
        </div>
        <OrgActionBar
          orgId={org.id}
          orgName={org.name}
          status={org.status}
          currentAdminRole={adminRole}
        />
      </header>

      {/* ADR-1027 Sprint 2.1 — parent-account context strip. */}
      {org.account_id ? (
        <AccountContextCard accountId={org.account_id} mode="compact" />
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Billing (account)">
          <KV label="Plan">{org.accounts?.plan_code ?? 'free'}</KV>
          <KV label="Org status">{statusBadge(org.status)}</KV>
          <KV label="Account status">{org.accounts?.status ?? '—'}</KV>
          <KV label="Account created">
            {org.accounts?.created_at ? formatDate(org.accounts.created_at) : '—'}
          </KV>
          <KV label="Trial ends">
            {org.accounts?.trial_ends_at ? formatDate(org.accounts.trial_ends_at) : '—'}
          </KV>
          <KV label="Razorpay sub">
            {org.accounts?.razorpay_subscription_id ? (
              <code className="font-mono text-xs">
                {org.accounts.razorpay_subscription_id}
              </code>
            ) : (
              '—'
            )}
          </KV>
        </Card>

        <Card title="Configuration">
          <KV label="Industry">{org.industry ?? '—'}</KV>
          <KV label="Storage mode">{org.storage_mode ?? 'standard'}</KV>
          <KV label="Web properties">{propCount}</KV>
          <KV label="Integrations">{integrationCount}</KV>
          <KV label="Members">{members.length}</KV>
        </Card>

        <SdfCard
          orgId={orgId}
          sdfStatus={(org.sdf_status ?? 'not_designated') as 'not_designated' | 'self_declared' | 'notified' | 'exempt'}
          sdfNotifiedAt={org.sdf_notified_at ?? null}
          sdfNotificationRef={org.sdf_notification_ref ?? null}
          canWrite={canOperate(adminRole)}
        />

        <Card title="Contacts">
          <KV label="DPO">{org.dpo_name ?? '—'}</KV>
          <KV label="Compliance email">
            {org.compliance_contact_email ?? '—'}
          </KV>
          <KV label="Encryption salt">
            <code className="font-mono text-xs text-text-3">
              {org.encryption_salt ? 'set' : 'missing'}
            </code>
          </KV>
          <KV label="Created">{formatDate(org.created_at)}</KV>
          <KV label="Updated">
            {org.updated_at ? formatDate(org.updated_at) : '—'}
          </KV>
        </Card>
      </section>

      <AdminMembersSection
        orgId={orgId}
        members={orgMembers}
        adminRole={adminRole}
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Operator notes">
          {notes.length === 0 ? (
            <p className="text-xs text-text-3">
              No notes yet. Add one from Sprint 2.1 (pending).
            </p>
          ) : (
            <ul className="space-y-3">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className={
                    note.pinned
                      ? 'rounded border border-amber-200 bg-amber-50 p-3'
                      : 'rounded border border-[color:var(--border)] p-3'
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="text-xs text-text-3">
                      <span className="font-medium text-text-2">
                        {adminNameById.get(note.admin_user_id) ??
                          note.admin_user_id.slice(0, 8)}
                      </span>{' '}
                      · {formatDate(note.created_at)}
                      {note.pinned ? ' · pinned' : ''}
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{note.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Support sessions">
          {sessions.length === 0 ? (
            <p className="text-xs text-text-3">
              No impersonation sessions on record.
            </p>
          ) : (
            <ul className="space-y-3">
              {sessions.map((s) => (
                <li key={s.id} className="rounded border border-[color:var(--border)] p-3">
                  <div className="flex items-center justify-between text-xs text-text-3">
                    <span>
                      <span className="font-medium text-text-2">
                        {adminNameById.get(s.admin_user_id) ??
                          s.admin_user_id.slice(0, 8)}
                      </span>{' '}
                      · {formatDate(s.started_at)}
                    </span>
                    {sessionStatusPill(s.status)}
                  </div>
                  <div className="mt-1 text-xs text-text-2">
                    <code className="font-mono">{s.reason}</code> — {s.reason_detail}
                  </div>
                  {s.ended_at ? (
                    <div className="mt-0.5 text-xs text-text-3">
                      ended {formatDate(s.ended_at)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="border-b border-[color:var(--border)] px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="space-y-2 p-4">{children}</div>
    </section>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] py-1 text-sm last:border-b-0">
      <span className="text-xs text-text-3">{label}</span>
      <span className="truncate text-right">{children}</span>
    </div>
  )
}

function statusBadge(status: string) {
  if (status === 'active')
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        Active
      </span>
    )
  if (status === 'suspended')
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Suspended
      </span>
    )
  return (
    <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-text-2">
      {status}
    </span>
  )
}

function sessionStatusPill(status: string) {
  const cls =
    status === 'active'
      ? 'bg-red-100 text-red-700'
      : status === 'expired'
        ? 'bg-amber-100 text-amber-700'
        : status === 'force_ended'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-bg text-text-2'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
