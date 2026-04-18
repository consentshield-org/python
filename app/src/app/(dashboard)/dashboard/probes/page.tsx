import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ProbesList } from './probes-list'

export default async function ProbesPage() {
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

  const [probesRes, propertiesRes] = await Promise.all([
    supabase
      .from('consent_probes')
      .select(
        'id, property_id, probe_type, consent_state, schedule, is_active, last_run_at, last_result, next_run_at',
      )
      .order('created_at', { ascending: false }),
    supabase
      .from('web_properties')
      .select('id, name, url')
      .order('name'),
  ])

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Consent Probes</h1>
        <p className="text-sm text-gray-600">
          Synthetic compliance tests. Each probe loads one of your web properties in a
          real Chromium browser, sets a specific consent state, and flags any trackers
          that fire despite a denied consent. Powered by Vercel Sandbox + Playwright
          (ADR-0041). Scheduled runs populate Consent Probe Runs history.
        </p>
        {!isAdmin ? (
          <p className="mt-2 text-xs text-gray-500">
            Read-only view — admins and owners can create and edit probes.
          </p>
        ) : null}
      </div>

      <ProbesList
        isAdmin={isAdmin}
        probes={probesRes.data ?? []}
        properties={propertiesRes.data ?? []}
      />

      <section className="rounded border border-gray-200 p-4 text-sm text-gray-600 space-y-2">
        <p>
          <strong>Consent state format.</strong> Comma-separated key:value pairs, where
          value is <code>true</code> or <code>false</code>. Example:
        </p>
        <pre className="rounded bg-gray-50 p-2 text-xs">
analytics: false, marketing: false, functional: true
        </pre>
        <p>
          The probe sets a cookie on the target domain that encodes this state, then
          loads the page. Any non-functional tracker that fires with its category set
          to <code>false</code> is logged as a violation. See{' '}
          <Link href="/dashboard/enforcement" className="underline">
            Enforcement
          </Link>{' '}
          for historical probe runs.
        </p>
      </section>
    </main>
  )
}
