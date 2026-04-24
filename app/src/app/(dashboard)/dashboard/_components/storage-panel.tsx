// ADR-1025 Phase 2 Sprint 2.2 — dashboard storage panel.
//
// Compact widget showing the compliance-record storage destination for the
// viewer's org: provider, verification state, last-export watermark, and
// a link to settings. Reads `public.export_configurations` via the
// authenticated user's Supabase client (the `org_select` RLS policy in
// migration 20260413000007 scopes the read to the viewer's org).
//
// Three visual states:
//   1. No row yet      → "Storage provisioning…" (provisioning trigger in flight)
//   2. Row + !verified → "Storage initialising" (row exists; probe pending)
//   3. Row + verified  → provider + bucket + last-export timestamp

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { nowIso } from '@consentshield/compliance'

interface ExportConfigRow {
  storage_provider: string
  bucket_name: string
  is_verified: boolean
  last_export_at: string | null
  created_at: string | null
}

const PROVIDER_LABELS: Record<string, string> = {
  cs_managed_r2: 'ConsentShield-managed R2',
  customer_r2: 'Your Cloudflare R2',
  customer_s3: 'Your AWS S3',
}

export async function StoragePanel({ orgId }: { orgId: string }) {
  const supabase = await createServerClient()
  const { data: row, error } = await supabase
    .from('export_configurations')
    .select('storage_provider, bucket_name, is_verified, last_export_at, created_at')
    .eq('org_id', orgId)
    .maybeSingle()

  const providerLabel = row
    ? (PROVIDER_LABELS[row.storage_provider as string] ?? row.storage_provider)
    : null

  return (
    <section
      aria-labelledby="storage-panel-heading"
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="storage-panel-heading"
          className="text-sm font-semibold text-gray-900"
        >
          Compliance-record storage
        </h2>
        <StatusBadge row={row as ExportConfigRow | null} />
      </div>

      {error ? (
        <p className="text-xs text-red-600">Couldn&apos;t load storage status.</p>
      ) : null}

      {!row ? (
        <p className="text-xs text-gray-600">
          Provisioning your bucket in the background. This usually takes &lt; 30
          seconds. If this message persists, refresh the page or contact support.
        </p>
      ) : (
        <dl className="space-y-2 text-xs">
          <FieldRow
            label="Provider"
            value={providerLabel ?? (row.storage_provider as string)}
          />
          <FieldRow
            label="Bucket"
            value={<code className="text-gray-800">{row.bucket_name as string}</code>}
          />
          <FieldRow
            label="Last delivery"
            value={
              row.last_export_at
                ? formatRelative(row.last_export_at as string)
                : 'Never — nothing to export yet'
            }
          />
        </dl>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Link
          href="/dashboard/exports"
          className="text-xs font-medium text-blue-700 hover:text-blue-900"
        >
          View exports →
        </Link>
        <Link
          href="/dashboard/settings/storage"
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Manage storage
        </Link>
      </div>
    </section>
  )
}

function StatusBadge({ row }: { row: ExportConfigRow | null }) {
  if (!row) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        <Spinner />
        Provisioning
      </span>
    )
  }
  if (!row.is_verified) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        <Spinner />
        Initialising
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800">
      <Dot />
      Ready
    </span>
  )
}

function FieldRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-24 shrink-0 text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value}</dd>
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 animate-pulse rounded-full bg-current"
    />
  )
}

function Dot() {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full bg-current"
    />
  )
}

function formatRelative(iso: string): string {
  const now = new Date(nowIso()).getTime()
  const then = new Date(iso).getTime()
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
