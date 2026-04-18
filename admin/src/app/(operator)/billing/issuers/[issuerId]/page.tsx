import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { type AdminRole } from '@/lib/admin/role-tiers'
import { IssuerDetailClient } from './client'

// ADR-0050 Sprint 2.1 chunk 2 — Issuer detail + edit.

export const dynamic = 'force-dynamic'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface IssuerEnvelope {
  issuer: {
    id: string
    legal_name: string
    gstin: string
    pan: string
    registered_state_code: string
    registered_address: string
    invoice_prefix: string
    fy_start_month: number
    logo_r2_key: string | null
    signatory_name: string
    signatory_designation: string | null
    bank_account_masked: string | null
    is_active: boolean
    activated_at: string | null
    retired_at: string | null
    retired_reason: string | null
    created_at: string
    updated_at: string
  }
  invoice_count: number
}

interface PageProps {
  params: Promise<{ issuerId: string }>
}

export default async function IssuerDetailPage({ params }: PageProps) {
  const { issuerId } = await params
  if (!UUID_RE.test(issuerId)) notFound()

  const supabase = await createServerClient()
  const [detailRes, userRes] = await Promise.all([
    supabase.schema('admin').rpc('billing_issuer_detail', { p_id: issuerId }),
    supabase.auth.getUser(),
  ])

  if (detailRes.error) {
    if (detailRes.error.message?.toLowerCase().includes('not found')) notFound()
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {detailRes.error.message}
        </p>
      </div>
    )
  }

  const env = detailRes.data as IssuerEnvelope
  const adminRole =
    (userRes.data.user?.app_metadata?.admin_role as AdminRole) ?? 'read_only'
  const isOwner = adminRole === 'platform_owner'
  const issuer = env.issuer

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <div className="flex items-center gap-2 text-[11px] text-text-3">
          <Link href="/billing" className="hover:underline">
            Billing
          </Link>
          <span>/</span>
          <Link href="/billing/issuers" className="hover:underline">
            Issuer entities
          </Link>
          <span>/</span>
          <span>{issuer.legal_name}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold">{issuer.legal_name}</h1>
          {issuer.retired_at ? (
            <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-text-3">
              retired {new Date(issuer.retired_at).toLocaleDateString()}
            </span>
          ) : issuer.is_active ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
              active
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              inactive
            </span>
          )}
        </div>
        <p className="font-mono text-[11px] text-text-3">{issuer.id}</p>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Identity — immutable">
          <KV label="Legal name">{issuer.legal_name}</KV>
          <KV label="GSTIN">
            <code className="font-mono text-xs">{issuer.gstin}</code>
          </KV>
          <KV label="PAN">
            <code className="font-mono text-xs">{issuer.pan}</code>
          </KV>
          <KV label="State code">{issuer.registered_state_code}</KV>
          <KV label="Invoice prefix">
            <code className="font-mono text-xs">{issuer.invoice_prefix}</code>
          </KV>
          <KV label="FY start month">{issuer.fy_start_month}</KV>
          <p className="pt-2 text-[11px] leading-relaxed text-text-3">
            To change any of these fields, retire this issuer and create
            a new one. Invoices referencing this entity keep their
            lineage.
          </p>
        </Card>

        <Card title="Lifecycle">
          <KV label="Created">
            {new Date(issuer.created_at).toLocaleString()}
          </KV>
          <KV label="Last updated">
            {new Date(issuer.updated_at).toLocaleString()}
          </KV>
          <KV label="Activated">
            {issuer.activated_at
              ? new Date(issuer.activated_at).toLocaleString()
              : '—'}
          </KV>
          <KV label="Retired">
            {issuer.retired_at
              ? new Date(issuer.retired_at).toLocaleString()
              : '—'}
          </KV>
          {issuer.retired_reason ? (
            <KV label="Retired reason">
              <span className="text-xs text-text-2">{issuer.retired_reason}</span>
            </KV>
          ) : null}
          <KV label="Invoices referencing">{env.invoice_count}</KV>
        </Card>
      </section>

      <IssuerDetailClient
        issuer={issuer}
        invoiceCount={env.invoice_count}
        isOwner={isOwner}
      />
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="space-y-1.5 px-4 py-3">{children}</div>
    </section>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-xs text-text-3">{label}</span>
      <span className="text-xs text-text-1">{children}</span>
    </div>
  )
}
