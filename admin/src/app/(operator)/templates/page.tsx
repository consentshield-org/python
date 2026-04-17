import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { TemplatesFilterBar } from '@/components/templates/filter-bar'

// ADR-0030 Sprint 1.1 — Sectoral Templates list.
//
// Read-only in this sprint. Create/Edit/Publish/Deprecate land in
// Sprint 2.1. All admin roles can read; writes are gated at the RPC
// layer (platform_operator only) and the UI will surface that in 2.1.

export const dynamic = 'force-dynamic'

interface Template {
  id: string
  template_code: string
  display_name: string
  description: string
  sector: string
  version: number
  status: 'draft' | 'published' | 'deprecated'
  purpose_definitions: Array<{ purpose_code?: string }> | Record<string, unknown>
  created_at: string
  published_at: string | null
  deprecated_at: string | null
}

interface PageProps {
  searchParams: Promise<{
    status?: 'draft' | 'published' | 'deprecated'
    sector?: string
  }>
}

export default async function TemplatesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createServerClient()

  let query = supabase
    .schema('admin')
    .from('sectoral_templates')
    .select(
      'id, template_code, display_name, description, sector, version, status, purpose_definitions, created_at, published_at, deprecated_at',
    )
    .order('sector')
    .order('template_code')
    .order('version', { ascending: false })

  if (params.status) query = query.eq('status', params.status)
  if (params.sector) query = query.eq('sector', params.sector)

  const { data, error } = await query

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-semibold">Sectoral Templates</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }

  const templates = (data ?? []) as Template[]

  const counts = {
    published: templates.filter((t) => t.status === 'published').length,
    draft: templates.filter((t) => t.status === 'draft').length,
    deprecated: templates.filter((t) => t.status === 'deprecated').length,
  }

  const sectors = Array.from(new Set(templates.map((t) => t.sector))).sort()

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sectoral Templates</h1>
          <p className="text-sm text-zinc-600">
            Pre-composed purpose-definition packs for customer onboarding.
            Versioned; published templates are immutable.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            {counts.published} published
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            {counts.draft} drafts
          </span>
          <span className="rounded-full bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700">
            {counts.deprecated} deprecated
          </span>
        </div>
      </header>

      <TemplatesFilterBar sectors={sectors} />

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        {templates.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            No templates match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Template code</th>
                  <th className="px-4 py-2">Display name</th>
                  <th className="px-4 py-2">Sector</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Purposes</th>
                  <th className="px-4 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-zinc-200 hover:bg-zinc-50"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/templates/${t.id}`}
                        className="font-mono text-xs text-red-700 hover:underline"
                      >
                        {t.template_code}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{t.display_name}</td>
                    <td className="px-4 py-2 text-xs">{t.sector}</td>
                    <td className="px-4 py-2">v{t.version}</td>
                    <td className="px-4 py-2">
                      <StatusPill status={t.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-600">
                      {Array.isArray(t.purpose_definitions)
                        ? t.purpose_definitions.length
                        : 0}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-600">
                      {formatDate(
                        t.deprecated_at ?? t.published_at ?? t.created_at,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: 'draft' | 'published' | 'deprecated' }) {
  const classes =
    status === 'published'
      ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
      : status === 'draft'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
        : 'rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700'
  return <span className={classes}>{status}</span>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}
