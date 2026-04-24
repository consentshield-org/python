// ADR-1025 Phase 2 Sprint 2.2 — dashboard storage panel.
// ADR-1025 Phase 4 Sprint 4.2 close-out — usage display (bytes + ceiling).
//
// Compact widget showing the compliance-record storage destination for the
// viewer's org: provider, verification state, last-export watermark, live
// usage (once a monthly snapshot exists), and a link to settings. Reads
// `public.export_configurations` + `public.storage_usage_snapshots` via
// the authenticated user's Supabase client — both tables have `org_select`
// RLS policies scoping reads to the viewer's org.
//
// Three visual states:
//   1. No row yet      → "Storage provisioning…" (provisioning trigger in flight)
//   2. Row + !verified → "Storage initialising" (row exists; probe pending)
//   3. Row + verified  → provider + bucket + last-export + latest usage

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

interface UsageSnapshotRow {
  snapshot_date: string
  payload_bytes: number
  metadata_bytes: number
  object_count: number
  plan_ceiling_bytes: number | null
  over_ceiling: boolean
}

const PROVIDER_LABELS: Record<string, string> = {
  cs_managed_r2: 'ConsentShield-managed R2',
  customer_r2: 'Your Cloudflare R2',
  customer_s3: 'Your AWS S3',
}

export async function StoragePanel({ orgId }: { orgId: string }) {
  const supabase = await createServerClient()
  const [{ data: row, error }, { data: usage }] = await Promise.all([
    supabase
      .from('export_configurations')
      .select('storage_provider, bucket_name, is_verified, last_export_at, created_at')
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase
      .from('storage_usage_snapshots')
      .select(
        'snapshot_date, payload_bytes, metadata_bytes, object_count, plan_ceiling_bytes, over_ceiling',
      )
      .eq('org_id', orgId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const usageRow = usage as UsageSnapshotRow | null

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
          {usageRow ? (
            <UsageRow usage={usageRow} />
          ) : row.is_verified ? (
            <FieldRow
              label="Usage"
              value={
                <span className="text-gray-500">
                  First snapshot arrives on the 1st of each month
                </span>
              }
            />
          ) : null}
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

function UsageRow({ usage }: { usage: UsageSnapshotRow }) {
  const totalBytes = Number(usage.payload_bytes) + Number(usage.metadata_bytes)
  const ceilingBytes =
    usage.plan_ceiling_bytes != null ? Number(usage.plan_ceiling_bytes) : null
  const pct =
    ceilingBytes != null && ceilingBytes > 0
      ? Math.min(100, Math.round((totalBytes / ceilingBytes) * 100))
      : null
  const barColour = usage.over_ceiling
    ? 'bg-red-500'
    : pct != null && pct >= 80
      ? 'bg-amber-500'
      : 'bg-green-500'

  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-24 shrink-0 text-gray-500">Usage</dt>
      <dd className="flex-1">
        <div className="flex items-baseline justify-between">
          <span className="text-gray-900">
            {formatBytes(totalBytes)}
            {ceilingBytes != null ? (
              <span className="text-gray-500"> / {formatBytes(ceilingBytes)}</span>
            ) : (
              <span className="text-gray-500"> (no ceiling)</span>
            )}
          </span>
          <span className="text-[10px] text-gray-500">
            {Number(usage.object_count).toLocaleString()} objects · as of{' '}
            {usage.snapshot_date}
          </span>
        </div>
        {pct != null ? (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full ${barColour}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        {usage.over_ceiling ? (
          <p className="mt-1 text-[10px] text-red-700">
            Over plan ceiling — contact support to upgrade or review usage.
          </p>
        ) : null}
      </dd>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  const gib = 1024 * 1024 * 1024
  if (n < gib * 1024) return `${(n / gib).toFixed(2)} GiB`
  return `${(n / (gib * 1024)).toFixed(2)} TiB`
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
