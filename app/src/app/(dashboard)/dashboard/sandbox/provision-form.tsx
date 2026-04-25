'use client'

import { useState, useTransition } from 'react'
import { provisionSandboxOrg, type ProvisionResult } from './actions'

// ADR-1003 Sprint 5.1 — sandbox provisioning form (client component).
// Optional template_code input — when set, the new org applies the
// template right away. If the template's default_storage_mode mismatch
// trips the Sprint 4.1 P0004 gate, we surface the error verbatim so the
// caller knows to ask their admin to flip mode first.

const KNOWN_TEMPLATE_HINTS = [
  { code: '', label: '— None —' },
  { code: 'bfsi_starter', label: 'BFSI Starter (NBFC / bank / broker)' },
  { code: 'healthcare_starter', label: 'Healthcare Starter (clinic / hospital)' },
]

export function ProvisionSandboxForm() {
  const [name, setName] = useState('')
  const [templateCode, setTemplateCode] = useState('')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ProvisionResult | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)
    startTransition(async () => {
      const r = await provisionSandboxOrg(name, templateCode || null)
      setResult(r)
      if (r.ok) setName('')
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3 rounded border border-gray-200 bg-white p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Sandbox org name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Smoke tests"
          maxLength={120}
          required
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="text-xs text-gray-500">
          We&rsquo;ll append <code className="font-mono">(sandbox)</code> automatically
          unless your name already includes it.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Sectoral template (optional)</span>
        <select
          value={templateCode}
          onChange={(e) => setTemplateCode(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {KNOWN_TEMPLATE_HINTS.map((t) => (
            <option key={t.code || 'none'} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">
          Healthcare Starter requires <span className="font-mono">storage_mode=zero_storage</span>;
          a fresh sandbox starts in <span className="font-mono">standard</span>, so applying it
          will fail with a P0004 message until your admin flips the mode.
        </span>
      </label>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-mid disabled:opacity-50"
        >
          {pending ? 'Provisioning…' : 'Provision sandbox org'}
        </button>
      </div>

      {result && !result.ok ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>Provisioning failed.</strong>{' '}
          {result.code ? <span className="font-mono text-xs">[{result.code}]</span> : null}{' '}
          {result.error}
        </p>
      ) : null}

      {result && result.ok ? (
        <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <p>
            <strong>Sandbox org provisioned.</strong>
          </p>
          <p className="mt-1 font-mono text-xs">{result.data.org_id}</p>
          <p className="mt-1 text-xs">
            Storage mode: <span className="font-mono">{result.data.storage_mode}</span>
            {result.data.template_applied ? (
              <>
                {' '}
                &middot; Template:{' '}
                <span className="font-mono">
                  {result.data.template_applied.code} v{result.data.template_applied.version}
                </span>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </form>
  )
}
