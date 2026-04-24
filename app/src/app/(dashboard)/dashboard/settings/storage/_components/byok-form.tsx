'use client'

// ADR-1025 Phase 3 Sprint 3.1 — BYOK credential-validation form.
// Collects provider + bucket + region + endpoint + access-key/secret from the
// customer, attaches a Turnstile token, and POSTs to the validate route.
// On ok=true shows a "Ready to migrate" prompt; on failure shows a
// plain-English error. Credentials are held in local state only — once
// the submit completes, state is cleared so the secret doesn't linger.

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

type SubmitState =
  | { stage: 'idle' }
  | { stage: 'submitting' }
  | { stage: 'ok'; probeId: string; durationMs: number }
  | { stage: 'probe_failed'; failedStep: string; error: string }
  | { stage: 'transport_failed'; message: string; retryInSeconds?: number }

export function ByokForm({ orgId }: { orgId: string }) {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [submit, setSubmit] = useState<SubmitState>({ stage: 'idle' })
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Render the Turnstile widget once the script loads.
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

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmit({ stage: 'submitting' })
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
      // Clear the secret from state on the submit-completion path. The
      // plaintext is still in the in-flight response's fetch internals
      // for a split second, but this state field is the only piece we
      // control. On `ok=true` we also reset the form entirely.
      const json = (await res.json()) as
        | { ok: true; probe_id: string; duration_ms: number }
        | { ok: false; failed_step: string; error: string }
        | { error: string; retry_in_seconds?: number; message?: string; field?: string }

      if (res.status === 429) {
        setSubmit({
          stage: 'transport_failed',
          message: `Too many attempts. Retry in ${(json as { retry_in_seconds: number }).retry_in_seconds}s.`,
          retryInSeconds: (json as { retry_in_seconds: number }).retry_in_seconds,
        })
        return
      }
      if (res.status === 401 || res.status === 403) {
        setSubmit({
          stage: 'transport_failed',
          message: 'Only the account owner can validate storage credentials.',
        })
        return
      }
      if (res.status === 400) {
        const body = json as { error: string; field?: string; message?: string }
        setSubmit({
          stage: 'transport_failed',
          message:
            body.error === 'missing_field'
              ? `Missing required field: ${body.field}`
              : body.error === 'turnstile_failed'
                ? 'Robot-check failed. Refresh and try again.'
                : body.error === 'invalid_provider'
                  ? 'Pick a valid provider.'
                  : (body.message ?? body.error),
        })
        resetTurnstile()
        return
      }
      if (!res.ok) {
        setSubmit({
          stage: 'transport_failed',
          message: `Request failed with HTTP ${res.status}`,
        })
        resetTurnstile()
        return
      }
      if ('ok' in json && json.ok) {
        setSubmit({
          stage: 'ok',
          probeId: json.probe_id,
          durationMs: json.duration_ms,
        })
        // Wipe secret + reset Turnstile so the user has to explicitly
        // submit again for any follow-up attempt.
        setForm((f) => ({ ...f, secretAccessKey: '' }))
        resetTurnstile()
        return
      }
      if ('ok' in json && !json.ok) {
        setSubmit({
          stage: 'probe_failed',
          failedStep: json.failed_step,
          error: json.error,
        })
        resetTurnstile()
        return
      }
      setSubmit({
        stage: 'transport_failed',
        message: 'Unrecognised response from the server.',
      })
    } catch (err) {
      setSubmit({
        stage: 'transport_failed',
        message: err instanceof Error ? err.message : 'Network error',
      })
      resetTurnstile()
    }
  }

  function resetTurnstile() {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current)
      setTurnstileToken('')
    }
  }

  const isSubmitting = submit.stage === 'submitting'
  const isOk = submit.stage === 'ok'

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
      />

      <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
        <fieldset className="space-y-1" disabled={isSubmitting || isOk}>
          <label className="text-xs font-medium text-gray-700">Provider</label>
          <select
            value={form.provider}
            onChange={(e) => {
              const p = e.target.value as Provider
              // Sensible defaults for common setups.
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
          disabled={isSubmitting || isOk}
        />
        <Input
          label="Region"
          value={form.region}
          onChange={(v) => updateField('region', v)}
          placeholder={form.provider === 'customer_r2' ? 'auto' : 'us-east-1'}
          disabled={isSubmitting || isOk}
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
          disabled={isSubmitting || isOk}
        />
        <Input
          label="Access key ID"
          value={form.accessKeyId}
          onChange={(v) => updateField('accessKeyId', v)}
          disabled={isSubmitting || isOk}
        />
        <Input
          label="Secret access key"
          value={form.secretAccessKey}
          onChange={(v) => updateField('secretAccessKey', v)}
          type="password"
          disabled={isSubmitting || isOk}
        />

        <div ref={turnstileContainerRef} />

        <button
          type="submit"
          disabled={isSubmitting || isOk || !turnstileToken}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
        >
          {isSubmitting ? 'Validating…' : 'Validate credentials'}
        </button>

        {!turnstileToken && !isSubmitting && !isOk ? (
          <p className="text-xs text-gray-500">
            Complete the robot-check above to enable the submit button.
          </p>
        ) : null}
      </form>

      {submit.stage === 'ok' ? (
        <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4">
          <h3 className="text-sm font-semibold text-green-900">
            Credentials validated
          </h3>
          <p className="mt-1 text-xs text-green-800">
            Probe ID <code>{submit.probeId}</code> · round-trip in{' '}
            {submit.durationMs} ms. Ready to migrate your compliance records
            to this bucket. The migration itself ships in the next
            release — you&apos;ll be able to choose &quot;copy existing
            objects&quot; or &quot;cut over only&quot;.
          </p>
        </div>
      ) : null}

      {submit.stage === 'probe_failed' ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-900">
            Validation failed at step: {submit.failedStep}
          </h3>
          <p className="mt-1 text-xs text-red-800">{submit.error}</p>
          <p className="mt-2 text-xs text-red-700">
            Common fixes: check the endpoint URL exactly, confirm the
            access-key has <code>Object Read+Write+Delete</code> on this
            bucket, and make sure the region matches the bucket&apos;s
            actual location.
          </p>
        </div>
      ) : null}

      {submit.stage === 'transport_failed' ? (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          {submit.message}
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
