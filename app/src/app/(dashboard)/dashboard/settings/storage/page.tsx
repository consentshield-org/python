// ADR-1025 Phase 3 Sprint 3.1 — storage settings page.
//
// Server component. Shows current provisioning state + gates the BYOK
// switch behind account_owner (folded to 'org_admin' via effective_org_role).
// Non-owners see the current state read-only with a who-can-change note.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ByokForm } from './_components/byok-form'

const PROVIDER_LABELS: Record<string, string> = {
  cs_managed_r2: 'ConsentShield-managed Cloudflare R2',
  customer_r2: 'Your Cloudflare R2',
  customer_s3: 'Your AWS S3',
}

interface ExportConfigRow {
  storage_provider: string
  bucket_name: string
  region: string | null
  is_verified: boolean
  last_export_at: string | null
  updated_at: string | null
}

export default async function StorageSettingsPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()
  if (!membership) redirect('/onboarding')

  const orgId = membership.org_id as string

  // Effective role folds account_owner → 'org_admin'.
  const { data: effectiveRole } = await supabase.rpc('effective_org_role', {
    p_org_id: orgId,
  })
  const canManage = effectiveRole === 'org_admin'

  const { data: row } = await supabase
    .from('export_configurations')
    .select(
      'storage_provider, bucket_name, region, is_verified, last_export_at, updated_at',
    )
    .eq('org_id', orgId)
    .maybeSingle()

  const typedRow = row as ExportConfigRow | null
  const providerLabel = typedRow
    ? (PROVIDER_LABELS[typedRow.storage_provider] ?? typedRow.storage_provider)
    : null
  const isManaged = typedRow?.storage_provider === 'cs_managed_r2'

  return (
    <main className="flex-1 p-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Storage</h1>
        <p className="mt-1 text-sm text-gray-600">
          Where ConsentShield delivers your compliance records (consent
          events, artefacts, audit logs). You own this bucket; we never
          retain a copy beyond the delivery window.
        </p>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">
          Current destination
        </h2>
        {typedRow ? (
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Provider" value={providerLabel!} />
            <Row
              label="Bucket"
              value={
                <code className="text-gray-800">{typedRow.bucket_name}</code>
              }
            />
            {typedRow.region ? (
              <Row label="Region" value={typedRow.region} />
            ) : null}
            <Row
              label="Status"
              value={
                typedRow.is_verified ? (
                  <span className="text-green-800">Ready</span>
                ) : (
                  <span className="text-amber-800">Initialising</span>
                )
              }
            />
          </dl>
        ) : (
          <p className="mt-2 text-xs text-gray-600">
            No storage destination yet. If you just finished the wizard,
            this usually appears within 30 seconds.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">
          Bring your own storage
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          If you prefer to keep compliance records in your own Cloudflare
          R2 or AWS S3 bucket, supply credentials below. We&apos;ll run a
          one-round-trip probe (PUT → GET → DELETE) to confirm they work
          before switching you over.
        </p>

        {!canManage ? (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Only the account owner can change the storage destination.
            Ask your account owner to visit this page.
          </p>
        ) : isManaged ? (
          <div className="mt-4">
            <ByokForm orgId={orgId} />
          </div>
        ) : (
          <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            You&apos;re already on BYOK storage ({providerLabel}). To
            rotate credentials or switch providers, contact support — we
            need to coordinate the migration cut-over.
          </div>
        )}
      </section>
    </main>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-24 shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value}</dd>
    </div>
  )
}
