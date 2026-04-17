import { createServerClient } from '@/lib/supabase/server'
import { TemplatePicker } from '@/components/templates/template-picker'

// ADR-0030 Sprint 3.1 — customer-side template picker.
//
// Shows the currently-applied template (if any) + all published
// templates available to the org's sector (with general fallback).
// Applying a template writes the choice into org.settings.

export const dynamic = 'force-dynamic'

interface TemplateRow {
  template_code: string
  display_name: string
  description: string
  version: number
  purpose_definitions: Array<unknown>
}

interface AppliedTemplate {
  code: string
  version: number
  applied_at?: string
}

export default async function CustomerTemplatePage() {
  const supabase = await createServerClient()

  // Resolve the org's industry so we can filter templates.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const orgId = (user?.app_metadata?.org_id as string | undefined) ?? null

  const { data: org } = orgId
    ? await supabase
        .from('organisations')
        .select('id, name, industry, settings')
        .eq('id', orgId)
        .maybeSingle()
    : { data: null }

  const sector = (org?.industry as string | undefined) ?? 'general'

  const applied =
    (org?.settings as { sectoral_template?: AppliedTemplate } | null)
      ?.sectoral_template ?? null

  const { data: available, error } = await supabase.rpc(
    'list_sectoral_templates_for_sector',
    { p_sector: sector },
  )

  if (error) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">Sector template</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }

  const templates = (available ?? []) as TemplateRow[]

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Sector template</h1>
        <p className="mt-1 text-sm text-gray-600">
          A sector template is a pre-composed bundle of purpose definitions,
          legal bases, and default retentions tailored to your industry.
          Applying a template records the choice; individual purposes are
          managed in the Data Inventory.
        </p>
      </header>

      {applied ? (
        <section className="mb-6 rounded border border-teal-200 bg-teal-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-teal-800">
            Active template
          </p>
          <p className="mt-1 text-sm text-teal-900">
            <strong>{applied.code}</strong> · v{applied.version}
            {applied.applied_at ? (
              <span className="ml-2 text-xs text-teal-700">
                · applied {new Date(applied.applied_at).toLocaleDateString()}
              </span>
            ) : null}
          </p>
        </section>
      ) : (
        <section className="mb-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No template applied yet. Pick one below to get a curated starting
          set of purposes.
        </section>
      )}

      <TemplatePicker
        templates={templates.map((t) => ({
          code: t.template_code,
          displayName: t.display_name,
          description: t.description,
          version: t.version,
          purposeCount: Array.isArray(t.purpose_definitions)
            ? t.purpose_definitions.length
            : 0,
          isActive:
            applied?.code === t.template_code &&
            applied?.version === t.version,
        }))}
        sector={sector}
      />

      <p className="mt-6 text-xs text-gray-500">
        Purposes from the chosen template are not yet auto-expanded into your
        Data Inventory — a future release will walk this pointer and
        materialise them. For now, applying records the selection so operator
        reports and exports know which starting set you chose.
      </p>
    </div>
  )
}
