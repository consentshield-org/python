import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { R2SettingsForm } from './r2-settings-form'

export default async function ExportStorageSettingsPage() {
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
  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }
  const isAdmin = membership.role === 'org_admin'

  const { data: cfg } = await supabase
    .from('export_configurations')
    .select('bucket_name, path_prefix, region, is_verified, last_export_at, updated_at')
    .eq('org_id', membership.org_id)
    .maybeSingle()

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <div>
        <Link
          href="/dashboard/exports"
          className="text-xs text-gray-500 hover:underline"
        >
          ← Audit Exports
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Export storage settings</h1>
        <p className="text-sm text-gray-600">
          Configure a Cloudflare R2 bucket (S3-compatible) so audit exports
          upload to your own storage. ConsentShield generates a sigv4-signed
          PUT, records the object key on <code>audit_export_manifests</code>, and
          returns a short-lived presigned URL. Credentials are encrypted with a
          per-org derived key before storage (<code>export_configurations.write_credential_enc</code>).
        </p>
      </div>

      {!isAdmin ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Read-only view — admins and owners can configure R2 storage.
        </p>
      ) : null}

      <R2SettingsForm
        isAdmin={isAdmin}
        existing={
          cfg
            ? {
                bucket_name: cfg.bucket_name as string,
                path_prefix: (cfg.path_prefix as string) ?? '',
                region: (cfg.region as string) ?? 'auto',
                is_verified: cfg.is_verified as boolean,
                last_export_at: cfg.last_export_at as string | null,
                updated_at: cfg.updated_at as string,
              }
            : null
        }
      />

      <section className="rounded border border-gray-200 p-4 text-sm space-y-2">
        <h2 className="font-medium">Endpoint reference</h2>
        <p className="text-gray-600">
          Cloudflare R2 endpoints are of the form{' '}
          <code className="font-mono">https://&lt;account-id&gt;.r2.cloudflarestorage.com</code>.
          Region is always <code>auto</code> for R2. Create an R2 API token with
          Object Read + Write permissions on the bucket before configuring.
        </p>
      </section>
    </main>
  )
}
