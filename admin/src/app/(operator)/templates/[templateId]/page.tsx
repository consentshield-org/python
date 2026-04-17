import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0030 Sprint 1.1 — Sectoral Template detail (read-only).
//
// Shows metadata + purposes table. Edit / Publish / Deprecate action
// bar lands in Sprint 2.1.

export const dynamic = 'force-dynamic'

interface Purpose {
  purpose_code?: string
  display_name?: string
  framework?: string
  data_scope?: string[] | string
  default_expiry?: string | number | null
  auto_delete?: boolean
  [k: string]: unknown
}

interface Template {
  id: string
  template_code: string
  display_name: string
  description: string
  sector: string
  version: number
  status: 'draft' | 'published' | 'deprecated'
  purpose_definitions: Purpose[] | Record<string, unknown>
  notes: string | null
  created_at: string
  created_by: string
  published_at: string | null
  published_by: string | null
  deprecated_at: string | null
  superseded_by_id: string | null
}

interface PageProps {
  params: Promise<{ templateId: string }>
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { templateId } = await params
  const supabase = await createServerClient()

  const { data: tpl, error } = await supabase
    .schema('admin')
    .from('sectoral_templates')
    .select(
      'id, template_code, display_name, description, sector, version, status, purpose_definitions, notes, created_at, created_by, published_at, published_by, deprecated_at, superseded_by_id',
    )
    .eq('id', templateId)
    .maybeSingle()

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-xl font-semibold">Sectoral Template</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }

  if (!tpl) notFound()

  const template = tpl as Template

  // Resolve admin display names for created_by / published_by.
  const adminIds = [template.created_by, template.published_by].filter(
    (v): v is string => !!v,
  )
  const { data: admins } = adminIds.length
    ? await supabase
        .schema('admin')
        .from('admin_users')
        .select('id, display_name')
        .in('id', adminIds)
    : { data: [] as Array<{ id: string; display_name: string }> }

  const adminName = new Map<string, string>()
  for (const a of admins ?? []) adminName.set(a.id, a.display_name)

  // Resolve successor display (deprecated templates may have superseded_by_id)
  const { data: successor } = template.superseded_by_id
    ? await supabase
        .schema('admin')
        .from('sectoral_templates')
        .select('id, template_code, version')
        .eq('id', template.superseded_by_id)
        .maybeSingle()
    : { data: null }

  const purposes: Purpose[] = Array.isArray(template.purpose_definitions)
    ? template.purpose_definitions
    : []

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs text-zinc-500">
            <Link href="/templates" className="hover:underline">
              ← Sectoral Templates
            </Link>
          </p>
          <h1 className="mt-1 text-xl font-semibold">
            {template.display_name}{' '}
            <span className="text-sm font-normal text-zinc-500">
              v{template.version}
            </span>
          </h1>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            {template.template_code} · {template.sector}
          </p>
        </div>
        <StatusPill status={template.status} />
      </header>

      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Description</h2>
        <p className="mt-2 text-sm text-zinc-700">{template.description}</p>
        {template.notes ? (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Notes
            </h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
              {template.notes}
            </p>
          </>
        ) : null}
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoTile label="Created">
          {formatDate(template.created_at)}
          <br />
          <span className="text-xs text-zinc-500">
            {adminName.get(template.created_by) ?? template.created_by.slice(0, 8)}
          </span>
        </InfoTile>
        <InfoTile label="Published">
          {template.published_at ? (
            <>
              {formatDate(template.published_at)}
              <br />
              <span className="text-xs text-zinc-500">
                {template.published_by
                  ? adminName.get(template.published_by) ??
                    template.published_by.slice(0, 8)
                  : '—'}
              </span>
            </>
          ) : (
            <span className="text-zinc-400">—</span>
          )}
        </InfoTile>
        <InfoTile label="Deprecated">
          {template.deprecated_at ? (
            <>
              {formatDate(template.deprecated_at)}
              {successor ? (
                <>
                  <br />
                  <Link
                    href={`/templates/${successor.id}`}
                    className="text-xs text-red-700 hover:underline"
                  >
                    → {successor.template_code} v{successor.version}
                  </Link>
                </>
              ) : null}
            </>
          ) : (
            <span className="text-zinc-400">—</span>
          )}
        </InfoTile>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-200 p-4">
          <h2 className="text-sm font-semibold">
            Purpose definitions
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {purposes.length} purpose{purposes.length === 1 ? '' : 's'}
            </span>
          </h2>
        </header>
        {purposes.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            No purposes defined.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Display</th>
                  <th className="px-4 py-2">Framework</th>
                  <th className="px-4 py-2">Data scope</th>
                  <th className="px-4 py-2">Default expiry</th>
                  <th className="px-4 py-2">Auto-delete</th>
                </tr>
              </thead>
              <tbody>
                {purposes.map((p, i) => (
                  <tr key={p.purpose_code ?? i} className="border-t border-zinc-200">
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.purpose_code ?? '—'}
                    </td>
                    <td className="px-4 py-2">{p.display_name ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{p.framework ?? '—'}</td>
                    <td className="px-4 py-2">
                      <DataScopePills scope={p.data_scope} />
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {p.default_expiry ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {p.auto_delete === true
                        ? 'Yes'
                        : p.auto_delete === false
                          ? 'No'
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="border-t border-zinc-200 p-3 text-xs text-zinc-500">
          data_scope values are <strong>category declarations only</strong>, never actual
          personal data values (Rule 3).
        </footer>
      </section>

      <p className="text-xs text-zinc-500">
        Edit / Publish / Deprecate action bar ships in ADR-0030 Sprint 2.1.
      </p>
    </div>
  )
}

function StatusPill({ status }: { status: 'draft' | 'published' | 'deprecated' }) {
  const classes =
    status === 'published'
      ? 'rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700'
      : status === 'draft'
        ? 'rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800'
        : 'rounded-full bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700'
  return <span className={classes}>{status}</span>
}

function InfoTile({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-sm text-zinc-800">{children}</p>
    </div>
  )
}

function DataScopePills({ scope }: { scope?: string[] | string }) {
  const items = Array.isArray(scope)
    ? scope
    : typeof scope === 'string' && scope
      ? [scope]
      : []
  if (items.length === 0) return <span className="text-xs text-zinc-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700"
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}
