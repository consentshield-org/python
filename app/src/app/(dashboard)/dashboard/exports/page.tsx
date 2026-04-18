import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ExportButton } from './export-button'

interface ManifestRow {
  id: string
  format_version: number
  section_counts: Record<string, number> | null
  content_bytes: number | null
  delivery_target: string | null
  r2_bucket: string | null
  r2_object_key: string | null
  created_at: string
}

export default async function ExportsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const orgId = membership.org_id as string
  const [{ data: manifests }, { data: exportConfig }] = await Promise.all([
    supabase
      .from('audit_export_manifests')
      .select('id, format_version, section_counts, content_bytes, delivery_target, created_at, r2_bucket, r2_object_key')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('export_configurations')
      .select('bucket_name, path_prefix, region, is_verified, last_export_at')
      .eq('org_id', orgId)
      .maybeSingle(),
  ])

  const rows = (manifests ?? []) as ManifestRow[]

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Audit Exports</h1>
          <p className="text-sm text-gray-600">
            Download a ZIP of your compliance snapshot (DPDP + DEPA evidence).
            See ADR-0017 and ADR-0037 for the section list.
          </p>
        </div>
        <Link
          href="/dashboard/exports/settings"
          className="shrink-0 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Storage settings
        </Link>
      </div>

      <section className="rounded border border-gray-200 p-4 text-sm">
        <p className="font-medium">Delivery target</p>
        {exportConfig?.is_verified ? (
          <p className="mt-1 text-gray-600">
            Your next export uploads to{' '}
            <code className="font-mono">
              {exportConfig.bucket_name}
              {exportConfig.path_prefix ? `/${exportConfig.path_prefix}` : ''}
            </code>{' '}
            <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">
              verified
            </span>
            . ConsentShield returns an object key + short-lived presigned URL after
            upload.
          </p>
        ) : exportConfig ? (
          <p className="mt-1 text-amber-800">
            R2 configuration saved but{' '}
            <strong>not verified</strong>. Next export will fall back to direct
            download until you run Verify on the settings page.
          </p>
        ) : (
          <p className="mt-1 text-gray-600">
            No R2 configuration — exports deliver as direct HTTP downloads. Configure
            R2 in <Link href="/dashboard/exports/settings" className="underline">
              storage settings
            </Link>{' '}
            to have future exports land in your own bucket (Rule 4 — customer owns
            the compliance record).
          </p>
        )}
      </section>

      <div className="rounded border border-gray-200 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Generate a new export</p>
          <p className="text-xs text-gray-500">
            Aggregates org profile, data inventory, banners, consent-event
            summaries, rights requests, deletion receipts, security scans,
            and probe runs into one ZIP.
          </p>
        </div>
        <ExportButton orgId={orgId} />
      </div>

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">History</h2>
          <p className="text-xs text-gray-500">
            ConsentShield stores pointers to past exports, never the bytes.
          </p>
        </div>
        {rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Sections</th>
                <th className="px-4 py-2 font-medium">Format</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-200">
                  <td className="px-4 py-2 text-xs text-gray-700">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.content_bytes ? `${(r.content_bytes / 1024).toFixed(1)} KB` : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {r.delivery_target === 'r2' && r.r2_bucket ? (
                      <>
                        r2: <span className="font-mono">{r.r2_bucket}/{r.r2_object_key ?? '…'}</span>
                      </>
                    ) : (
                      (r.delivery_target ?? '—')
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {r.section_counts
                      ? Object.entries(r.section_counts).map(([k, v]) => `${k}: ${v}`).join(', ')
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">v{r.format_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No exports yet. Generate one above.
          </p>
        )}
      </section>
    </main>
  )
}
