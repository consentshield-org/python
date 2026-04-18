import { createServerClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { RightsRequestActions } from './actions'
import { DeletionPanel } from './deletion-panel'

export default async function RightsRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) notFound()

  const { data: req } = await supabase
    .from('rights_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (!req) notFound()

  const { data: events } = await supabase
    .from('rights_request_events')
    .select('id, event_type, notes, actor_id, created_at')
    .eq('request_id', id)
    .order('created_at', { ascending: true })

  const { data: receipts } = await supabase
    .from('deletion_receipts')
    .select('id, target_system, status, requested_at, confirmed_at, failure_reason')
    .eq('trigger_id', id)
    .order('created_at', { ascending: false })

  // ADR-0024 W7 + ADR-0037 V2-D2 — artefact-scoped impact preview.
  // When the rights_requests row carries a session_fingerprint (populated
  // at submit time via deriveRequestFingerprint) we try for an exact
  // per-requestor artefact match first. Falls back to the org-wide
  // informational preview when fingerprint is NULL or matches zero
  // artefacts (different browser / network between consent and rights
  // request).
  const isErasure = req.request_type === 'erasure'
  const matchedArtefacts =
    isErasure && req.session_fingerprint
      ? await loadMatchedArtefacts(supabase, membership.org_id, req.session_fingerprint)
      : []
  const impact = isErasure ? await loadImpactPreview(supabase, membership.org_id) : null

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <div>
        <Link href="/dashboard/rights" className="text-xs text-gray-500 hover:underline">
          ← All rights requests
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          {req.request_type} request from {req.requestor_name}
        </h1>
        <p className="text-sm text-gray-600">{req.requestor_email}</p>
      </div>

      <section className="rounded border border-gray-200 p-4 space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status" value={req.status} />
          <Field label="SLA deadline" value={new Date(req.sla_deadline).toLocaleDateString()} />
          <Field label="Submitted" value={new Date(req.created_at).toLocaleString()} />
          <Field
            label="Email verified"
            value={
              req.email_verified
                ? new Date(req.email_verified_at).toLocaleString()
                : 'Not verified'
            }
          />
          <Field
            label="Identity verified"
            value={
              req.identity_verified
                ? `${new Date(req.identity_verified_at).toLocaleString()} (${req.identity_method ?? '—'})`
                : 'Not verified'
            }
          />
          <Field label="Turnstile verified" value={req.turnstile_verified ? 'Yes' : 'No'} />
        </div>
        {req.requestor_message && (
          <div>
            <p className="font-medium text-xs text-gray-500 uppercase mt-4">Requestor message</p>
            <p className="mt-1 whitespace-pre-wrap">{req.requestor_message}</p>
          </div>
        )}
      </section>

      <RightsRequestActions
        orgId={membership.org_id}
        requestId={req.id}
        currentStatus={req.status}
        identityVerified={req.identity_verified}
      />

      {isErasure && matchedArtefacts.length > 0 ? (
        <MatchedArtefactsPreview artefacts={matchedArtefacts} />
      ) : null}

      {isErasure && impact ? (
        <ImpactPreview
          impact={impact}
          matchedCount={matchedArtefacts.length}
          hasFingerprint={!!req.session_fingerprint}
        />
      ) : null}

      {req.request_type === 'erasure' && (
        <DeletionPanel
          orgId={membership.org_id}
          requestId={req.id}
          canExecute={
            req.identity_verified && req.email_verified && req.status !== 'completed'
          }
          receipts={receipts ?? []}
        />
      )}

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">Audit Trail</h2>
        </div>
        {events && events.length > 0 ? (
          <ol className="divide-y divide-gray-200 text-sm">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.event_type}</span>
                  <span className="text-xs text-gray-500">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                {e.notes && <p className="mt-1 text-xs text-gray-600">{e.notes}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 py-4 text-center text-sm text-gray-500">No events yet.</p>
        )}
      </section>
    </main>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ADR-0037 V2-D2 — matched-artefact preview (per-requestor)
// ═══════════════════════════════════════════════════════════

interface MatchedArtefact {
  artefact_id: string
  purpose_code: string
  framework: string
  data_scope: string[]
  expires_at: string | null
  purpose_display_name: string | null
  connectors: Array<{ display_name: string; data_categories: string[] }>
}

async function loadMatchedArtefacts(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
  fingerprint: string,
): Promise<MatchedArtefact[]> {
  const [artefactsRes, purposesRes, mappingsRes, connectorsRes] = await Promise.all([
    supabase
      .from('consent_artefacts')
      .select('artefact_id, purpose_code, purpose_definition_id, framework, data_scope, expires_at')
      .eq('org_id', orgId)
      .eq('session_fingerprint', fingerprint)
      .eq('status', 'active')
      .order('purpose_code'),
    supabase
      .from('purpose_definitions')
      .select('id, display_name')
      .eq('org_id', orgId),
    supabase
      .from('purpose_connector_mappings')
      .select('purpose_definition_id, connector_id, data_categories')
      .eq('org_id', orgId),
    supabase
      .from('integration_connectors')
      .select('id, display_name, status')
      .eq('org_id', orgId)
      .eq('status', 'active'),
  ])

  const purposeNameById = new Map(
    (purposesRes.data ?? []).map((p) => [p.id as string, p.display_name as string]),
  )
  const connectorNameById = new Map(
    (connectorsRes.data ?? []).map((c) => [c.id as string, c.display_name as string]),
  )
  const mappingsByPurpose = new Map<
    string,
    Array<{ display_name: string; data_categories: string[] }>
  >()
  for (const m of mappingsRes.data ?? []) {
    const name = connectorNameById.get(m.connector_id as string)
    if (!name) continue
    const arr = mappingsByPurpose.get(m.purpose_definition_id as string) ?? []
    arr.push({ display_name: name, data_categories: (m.data_categories as string[]) ?? [] })
    mappingsByPurpose.set(m.purpose_definition_id as string, arr)
  }

  return (artefactsRes.data ?? []).map((a) => ({
    artefact_id: a.artefact_id as string,
    purpose_code: a.purpose_code as string,
    framework: (a.framework as string) ?? 'dpdp',
    data_scope: (a.data_scope as string[]) ?? [],
    expires_at: (a.expires_at as string | null) ?? null,
    purpose_display_name: purposeNameById.get(a.purpose_definition_id as string) ?? null,
    connectors: mappingsByPurpose.get(a.purpose_definition_id as string) ?? [],
  }))
}

function MatchedArtefactsPreview({ artefacts }: { artefacts: MatchedArtefact[] }) {
  const totalFanOut = artefacts.reduce((n, a) => n + a.connectors.length, 0)
  return (
    <section className="rounded border border-green-300 bg-green-50 p-4 space-y-3">
      <div>
        <h2 className="font-medium">
          Matched {artefacts.length} artefact{artefacts.length === 1 ? '' : 's'} for this requestor
        </h2>
        <p className="text-xs text-green-900">
          Active consent artefacts linked to this requestor by session fingerprint
          (sha256 of user-agent + truncated IP + org). Erasure will revoke these and fan
          out to {totalFanOut} connector instruction{totalFanOut === 1 ? '' : 's'}.
        </p>
      </div>
      <div className="overflow-x-auto rounded border border-green-100">
        <table className="w-full text-sm">
          <thead className="bg-white text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Artefact</th>
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Data scope</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Connectors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-green-100 bg-white">
            {artefacts.map((a) => (
              <tr key={a.artefact_id}>
                <td className="px-3 py-2 font-mono text-xs">
                  {a.artefact_id.slice(0, 20)}…
                </td>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{a.purpose_code}</div>
                  {a.purpose_display_name ? (
                    <div className="text-xs text-gray-500">{a.purpose_display_name}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {a.data_scope.map((d) => (
                      <span
                        key={d}
                        className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums text-xs">
                  {a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '∞'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {a.connectors.length === 0 ? (
                    <span className="text-amber-700">no mappings</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {a.connectors.map((c, i) => (
                        <li key={i}>
                          <span className="font-medium">{c.display_name}</span>{' '}
                          <span className="text-gray-500">
                            [{c.data_categories.join(', ')}]
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════
// ADR-0024 W7 — artefact-scoped impact preview (informational)
// ═══════════════════════════════════════════════════════════

interface ImpactPurpose {
  purpose_code: string
  display_name: string
  data_scope: string[]
  connectors: Array<{
    display_name: string
    data_categories: string[]
  }>
}

interface ImpactPreviewData {
  purposes: ImpactPurpose[]
  totalActiveArtefacts: number
  totalConnectorFanOut: number
}

async function loadImpactPreview(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
): Promise<ImpactPreviewData> {
  const [purposesRes, mappingsRes, connectorsRes, activeRes] = await Promise.all([
    supabase
      .from('purpose_definitions')
      .select('id, purpose_code, display_name, data_scope')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('purpose_code'),
    supabase
      .from('purpose_connector_mappings')
      .select('purpose_definition_id, connector_id, data_categories')
      .eq('org_id', orgId),
    supabase
      .from('integration_connectors')
      .select('id, display_name, status')
      .eq('org_id', orgId)
      .eq('status', 'active'),
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'active'),
  ])

  const connectorsById = new Map(
    (connectorsRes.data ?? []).map((c) => [c.id, c.display_name as string]),
  )
  const mappingsByPurpose = new Map<
    string,
    Array<{ display_name: string; data_categories: string[] }>
  >()
  for (const m of mappingsRes.data ?? []) {
    const name = connectorsById.get(m.connector_id as string)
    if (!name) continue // Skip inactive connectors.
    const arr = mappingsByPurpose.get(m.purpose_definition_id as string) ?? []
    arr.push({ display_name: name, data_categories: (m.data_categories as string[]) ?? [] })
    mappingsByPurpose.set(m.purpose_definition_id as string, arr)
  }

  const purposes: ImpactPurpose[] = (purposesRes.data ?? []).map((p) => ({
    purpose_code: p.purpose_code as string,
    display_name: p.display_name as string,
    data_scope: (p.data_scope as string[]) ?? [],
    connectors: mappingsByPurpose.get(p.id as string) ?? [],
  }))

  const totalConnectorFanOut = purposes.reduce((n, p) => n + p.connectors.length, 0)

  return {
    purposes,
    totalActiveArtefacts: activeRes.count ?? 0,
    totalConnectorFanOut,
  }
}

function ImpactPreview({
  impact,
  matchedCount,
  hasFingerprint,
}: {
  impact: ImpactPreviewData
  matchedCount: number
  hasFingerprint: boolean
}) {
  const purposesWithConnectors = impact.purposes.filter((p) => p.connectors.length > 0)
  const unmappedPurposes = impact.purposes.filter((p) => p.connectors.length === 0)

  let caveat: string
  if (matchedCount > 0) {
    caveat = `Fallback / supplement view — the ${matchedCount} matched artefact(s) above are the primary scope. The table below shows org-wide purposes + mappings for context.`
  } else if (hasFingerprint) {
    caveat =
      'No artefacts matched this requestor\u2019s session fingerprint. This happens when the requestor used a different browser or network at consent time. The table below is the org-wide impact preview.'
  } else {
    caveat =
      'No session fingerprint on this rights request (pre-ADR-0037 submission). The table below shows what an erasure would fan out to across this org\u2019s active purposes and mapped connectors.'
  }

  return (
    <section className="rounded border border-gray-200 p-4 space-y-3">
      <div>
        <h2 className="font-medium">Artefact-scoped impact preview</h2>
        <p className="text-xs text-gray-500">{caveat}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
        <Summary
          label="Active purposes"
          value={impact.purposes.length}
          sub={
            unmappedPurposes.length > 0
              ? `${unmappedPurposes.length} without connector mappings`
              : 'all mapped'
          }
        />
        <Summary
          label="Active artefacts (org-wide)"
          value={impact.totalActiveArtefacts}
          sub="upper bound on revocation set"
        />
        <Summary
          label="Connector fan-out"
          value={impact.totalConnectorFanOut}
          sub="receipts per artefact revocation"
        />
      </div>

      {impact.purposes.length === 0 ? (
        <p className="text-sm text-gray-500">No active purposes in this org.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">Data scope</th>
                <th className="px-3 py-2">Connectors that will fire</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purposesWithConnectors.map((p) => (
                <tr key={p.purpose_code}>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{p.purpose_code}</div>
                    <div className="text-xs text-gray-500">{p.display_name}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.data_scope.map((d) => (
                        <span
                          key={d}
                          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ul className="space-y-1 text-xs">
                      {p.connectors.map((c, i) => (
                        <li key={i}>
                          <span className="font-medium">{c.display_name}</span>
                          <span className="ml-2 text-gray-500">
                            [{c.data_categories.join(', ')}]
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
              {unmappedPurposes.map((p) => (
                <tr key={p.purpose_code} className="bg-amber-50 text-amber-900">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{p.purpose_code}</div>
                    <div className="text-xs">{p.display_name}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.data_scope.map((d) => (
                        <span
                          key={d}
                          className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    No connector mapping — revocation will not auto-delete this purpose&apos;s
                    data anywhere.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Summary({
  label,
  value,
  sub,
}: {
  label: string
  value: number
  sub?: string
}) {
  return (
    <div className="rounded bg-gray-50 p-3">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-[10px] text-gray-500">{sub}</p> : null}
    </div>
  )
}
