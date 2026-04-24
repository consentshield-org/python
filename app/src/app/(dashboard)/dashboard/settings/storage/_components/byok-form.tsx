'use client'

// ADR-1025 Phase 3 Sprints 3.1 + 3.2 — BYOK form.
//
// Stages:
//   entering    → collect credentials + Turnstile; click "Validate"
//   validating  → POST /byok-validate; spinner
//   validated   → validation succeeded; choose mode + click "Start migration"
//   migrating   → POST /byok-migrate; live-poll the migration status
//   done        → migration terminal (completed / failed)
//
// On successful migration, Secret stays in memory through the
// validate → migrate hop (we don't force re-entry) but is wiped from
// state the moment the migration row is created — after that the
// server holds only the encrypted target_credential_enc column.

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: string | HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
        },
      ) => string
      reset: (widgetId?: string) => void
    }
  }
}

type Provider = 'customer_r2' | 'customer_s3'
type Mode = 'forward_only' | 'copy_existing'

interface FormState {
  provider: Provider
  bucket: string
  region: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
}

const INITIAL: FormState = {
  provider: 'customer_r2',
  bucket: '',
  region: 'auto',
  endpoint: '',
  accessKeyId: '',
  secretAccessKey: '',
}

type Stage =
  | { name: 'entering' }
  | { name: 'validating' }
  | { name: 'validated'; probeId: string; durationMs: number }
  | {
      name: 'migrating'
      migrationId: string
      state: 'queued' | 'copying' | 'completed' | 'failed'
      mode: Mode
      objectsCopied: number
      objectsTotal: number | null
      errorText: string | null
    }
  | {
      name: 'done'
      terminalState: 'completed' | 'failed'
      errorText: string | null
      objectsCopied: number
    }
  | { name: 'probe_failed'; failedStep: string; error: string }
  | { name: 'transport_failed'; message: string }

export function ByokForm({ orgId }: { orgId: string }) {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [mode, setMode] = useState<Mode>('forward_only')
  const [stage, setStage] = useState<Stage>({ name: 'entering' })
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Turnstile widget lifecycle
  useEffect(() => {
    const tryRender = () => {
      if (
        window.turnstile &&
        turnstileContainerRef.current &&
        !widgetIdRef.current
      ) {
        widgetIdRef.current = window.turnstile.render(
          turnstileContainerRef.current,
          {
            sitekey: turnstileSiteKey,
            callback: (t: string) => setTurnstileToken(t),
            'error-callback': () => setTurnstileToken(''),
          },
        )
      }
    }
    tryRender()
    const id = setInterval(tryRender, 300)
    return () => clearInterval(id)
  }, [turnstileSiteKey])

  // Migration status polling
  useEffect(() => {
    if (stage.name !== 'migrating') return
    let cancelled = false
    const migrationId = stage.migrationId
    async function tick() {
      try {
        const res = await fetch(
          `/api/orgs/${orgId}/storage/migrations/${migrationId}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const json = (await res.json()) as {
          state: 'queued' | 'copying' | 'completed' | 'failed'
          mode: Mode
          objects_copied: number
          objects_total: number | null
          error_text: string | null
        }
        if (cancelled) return
        if (json.state === 'completed' || json.state === 'failed') {
          setStage({
            name: 'done',
            terminalState: json.state,
            errorText: json.error_text,
            objectsCopied: json.objects_copied,
          })
        } else {
          setStage((prev) =>
            prev.name === 'migrating'
              ? {
                  ...prev,
                  state: json.state,
                  mode: json.mode,
                  objectsCopied: json.objects_copied,
                  objectsTotal: json.objects_total,
                  errorText: json.error_text,
                }
              : prev,
          )
        }
      } catch {
        /* transient; next tick retries */
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 3_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [stage, orgId])

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function resetTurnstile() {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current)
      setTurnstileToken('')
    }
  }

  async function handleValidate(e: React.FormEvent) {
    e.preventDefault()
    setStage({ name: 'validating' })
    try {
      const res = await fetch(`/api/orgs/${orgId}/storage/byok-validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          bucket: form.bucket.trim(),
          region: form.region.trim(),
          endpoint: form.endpoint.trim(),
          access_key_id: form.accessKeyId.trim(),
          secret_access_key: form.secretAccessKey,
          turnstile_token: turnstileToken,
        }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        probe_id?: string
        duration_ms?: number
        failed_step?: string
        error?: string
        retry_in_seconds?: number
        message?: string
        field?: string
      }
      if (res.status === 429) {
        setStage({
          name: 'transport_failed',
          message: `Too many attempts. Retry in ${json.retry_in_seconds ?? 60}s.`,
        })
        resetTurnstile()
        return
      }
      if (res.status === 401 || res.status === 403) {
        setStage({
          name: 'transport_failed',
          message: 'Only the account owner can validate storage credentials.',
        })
        return
      }
      if (res.status === 400) {
        setStage({
          name: 'transport_failed',
          message:
            json.error === 'missing_field'
              ? `Missing required field: ${json.field}`
              : json.error === 'turnstile_failed'
                ? 'Robot-check failed. Refresh and try again.'
                : json.error === 'invalid_provider'
                  ? 'Pick a valid provider.'
                  : (json.message ?? json.error ?? 'Bad request'),
        })
        resetTurnstile()
        return
      }
      if (res.ok && json.ok) {
        setStage({
          name: 'validated',
          probeId: json.probe_id!,
          durationMs: json.duration_ms!,
        })
        return
      }
      if (res.ok && json.ok === false) {
        setStage({
          name: 'probe_failed',
          failedStep: json.failed_step ?? 'put',
          error: json.error ?? 'unknown',
        })
        resetTurnstile()
        return
      }
      setStage({
        name: 'transport_failed',
        message: `Unexpected response (HTTP ${res.status})`,
      })
    } catch (err) {
      setStage({
        name: 'transport_failed',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  async function handleStartMigration() {
    // Need a fresh Turnstile token — the validate submission consumed the
    // previous one. Wait for the widget to issue a new token before firing.
    if (!turnstileToken) {
      setStage({
        name: 'transport_failed',
        message: 'Complete the robot-check above before starting migration.',
      })
      return
    }
    setStage({ name: 'validating' }) // re-use the spinner stage
    try {
      const res = await fetch(`/api/orgs/${orgId}/storage/byok-migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          bucket: form.bucket.trim(),
          region: form.region.trim(),
          endpoint: form.endpoint.trim(),
          access_key_id: form.accessKeyId.trim(),
          secret_access_key: form.secretAccessKey,
          mode,
          turnstile_token: turnstileToken,
        }),
      })
      const json = (await res.json()) as {
        migration_id?: string
        error?: string
        failed_step?: string
        message?: string
      }
      if (res.status === 409) {
        setStage({
          name: 'transport_failed',
          message:
            json.error === 'migration_already_active'
              ? 'A migration is already in progress for this org. Wait for it to finish.'
              : (json.message ?? json.error ?? 'Conflict'),
        })
        return
      }
      if (!res.ok) {
        setStage({
          name: 'transport_failed',
          message: json.message ?? json.error ?? `HTTP ${res.status}`,
        })
        resetTurnstile()
        return
      }
      // Wipe the secret from state now that the server has the
      // encrypted copy.
      setForm((f) => ({ ...f, secretAccessKey: '' }))
      resetTurnstile()
      setStage({
        name: 'migrating',
        migrationId: json.migration_id!,
        state: 'queued',
        mode,
        objectsCopied: 0,
        objectsTotal: null,
        errorText: null,
      })
    } catch (err) {
      setStage({
        name: 'transport_failed',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  const formDisabled =
    stage.name !== 'entering' && stage.name !== 'probe_failed'

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
      />

      <form onSubmit={handleValidate} className="space-y-4" autoComplete="off">
        <fieldset className="space-y-1" disabled={formDisabled}>
          <label className="text-xs font-medium text-gray-700">Provider</label>
          <select
            value={form.provider}
            onChange={(e) => {
              const p = e.target.value as Provider
              setForm((f) => ({
                ...f,
                provider: p,
                region: p === 'customer_r2' ? 'auto' : 'us-east-1',
                endpoint:
                  p === 'customer_r2'
                    ? ''
                    : 'https://s3.us-east-1.amazonaws.com',
              }))
            }}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="customer_r2">Cloudflare R2</option>
            <option value="customer_s3">AWS S3</option>
          </select>
          <p className="text-xs text-gray-500">
            R2 endpoints look like{' '}
            <code>https://&lt;account-id&gt;.r2.cloudflarestorage.com</code>.
            S3 endpoints look like{' '}
            <code>https://s3.&lt;region&gt;.amazonaws.com</code>.
          </p>
        </fieldset>

        <Input
          label="Bucket"
          value={form.bucket}
          onChange={(v) => updateField('bucket', v)}
          placeholder="my-compliance-records"
          disabled={formDisabled}
        />
        <Input
          label="Region"
          value={form.region}
          onChange={(v) => updateField('region', v)}
          disabled={formDisabled}
        />
        <Input
          label="Endpoint URL"
          value={form.endpoint}
          onChange={(v) => updateField('endpoint', v)}
          placeholder={
            form.provider === 'customer_r2'
              ? 'https://<account-id>.r2.cloudflarestorage.com'
              : 'https://s3.us-east-1.amazonaws.com'
          }
          disabled={formDisabled}
        />
        <Input
          label="Access key ID"
          value={form.accessKeyId}
          onChange={(v) => updateField('accessKeyId', v)}
          disabled={formDisabled}
        />
        <Input
          label="Secret access key"
          value={form.secretAccessKey}
          onChange={(v) => updateField('secretAccessKey', v)}
          type="password"
          disabled={formDisabled}
        />

        <div ref={turnstileContainerRef} />

        {stage.name === 'entering' || stage.name === 'probe_failed' ? (
          <button
            type="submit"
            disabled={!turnstileToken}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
          >
            Validate credentials
          </button>
        ) : null}
        {stage.name === 'validating' ? (
          <p className="text-sm text-gray-500">Validating…</p>
        ) : null}
      </form>

      {/* Validated — show mode picker + start button */}
      {stage.name === 'validated' ? (
        <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4">
          <h3 className="text-sm font-semibold text-green-900">
            Credentials validated
          </h3>
          <p className="mt-1 text-xs text-green-800">
            Round-trip probe <code>{stage.probeId}</code> completed in{' '}
            {stage.durationMs} ms. Choose how to migrate existing records:
          </p>
          <fieldset className="mt-4 space-y-2">
            <label className="flex items-start gap-2 text-xs text-gray-800">
              <input
                type="radio"
                name="mode"
                value="forward_only"
                checked={mode === 'forward_only'}
                onChange={() => setMode('forward_only')}
                className="mt-0.5"
              />
              <span>
                <strong>Forward-only cut-over.</strong> Fast (seconds).
                Future consent events + audit exports write to your bucket.
                Existing records stay in the ConsentShield-managed bucket
                for 30 days so audit-export downloads keep working, then
                are deleted.
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-gray-800">
              <input
                type="radio"
                name="mode"
                value="copy_existing"
                checked={mode === 'copy_existing'}
                onChange={() => setMode('copy_existing')}
                className="mt-0.5"
              />
              <span>
                <strong>Copy existing records.</strong> Streams every
                object from the old bucket to your new bucket (roughly
                2× bandwidth), then cuts over. Takes minutes to hours
                depending on object count. Resumable — a crash mid-copy
                picks up where it left off.
              </span>
            </label>
          </fieldset>
          <button
            type="button"
            onClick={handleStartMigration}
            disabled={!turnstileToken}
            className="mt-4 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
          >
            Start migration
          </button>
          {!turnstileToken ? (
            <p className="mt-2 text-xs text-green-800">
              The robot-check widget above needs to issue a fresh token.
              If the button stays disabled, refresh the widget.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Migrating — live progress panel */}
      {stage.name === 'migrating' ? (
        <div className="mt-6 rounded-md border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-sm font-semibold text-blue-900">
            Migration in progress
          </h3>
          <p className="mt-1 text-xs text-blue-800">
            State: <code>{stage.state}</code> · mode:{' '}
            <code>{stage.mode}</code>
          </p>
          {stage.mode === 'copy_existing' ? (
            <p className="mt-1 text-xs text-blue-800">
              {stage.objectsCopied} object
              {stage.objectsCopied === 1 ? '' : 's'} copied
              {stage.objectsTotal != null
                ? ` of ~${stage.objectsTotal}`
                : ''}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-blue-700">
            You can leave this page — the migration continues in the
            background. The status panel on the main dashboard reflects
            completion.
          </p>
        </div>
      ) : null}

      {/* Done */}
      {stage.name === 'done' ? (
        <div
          className={`mt-6 rounded-md border p-4 ${
            stage.terminalState === 'completed'
              ? 'border-green-200 bg-green-50'
              : 'border-red-200 bg-red-50'
          }`}
        >
          <h3
            className={`text-sm font-semibold ${
              stage.terminalState === 'completed'
                ? 'text-green-900'
                : 'text-red-900'
            }`}
          >
            {stage.terminalState === 'completed'
              ? 'Migration complete'
              : 'Migration failed'}
          </h3>
          {stage.terminalState === 'completed' ? (
            <p className="mt-1 text-xs text-green-800">
              {stage.objectsCopied > 0
                ? `Copied ${stage.objectsCopied} objects to your bucket. `
                : null}
              Future consent events will land in your storage. You can
              retire the old ConsentShield-managed bucket at your
              convenience — we&apos;ll auto-delete it after the 30-day
              retention window.
            </p>
          ) : (
            <p className="mt-1 text-xs text-red-800">
              {stage.errorText ?? 'Unknown error'}
            </p>
          )}
        </div>
      ) : null}

      {stage.name === 'probe_failed' ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-900">
            Validation failed at step: {stage.failedStep}
          </h3>
          <p className="mt-1 text-xs text-red-800">{stage.error}</p>
        </div>
      ) : null}

      {stage.name === 'transport_failed' ? (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          {stage.message}
        </div>
      ) : null}
    </>
  )
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500"
      />
    </div>
  )
}
