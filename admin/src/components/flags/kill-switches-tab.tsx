'use client'

import { useState } from 'react'
import {
  ModalShell,
  Field,
  ReasonField,
  FormFooter,
} from '@/components/common/modal-form'
import { toggleKillSwitch } from '@/app/(operator)/flags/actions'

export interface KillSwitch {
  switch_key: string
  display_name: string
  description: string
  enabled: boolean
  reason: string | null
  set_at: string
  set_by_name: string | null
}

type Modal = { kind: 'engage' | 'disengage'; sw: KillSwitch } | null

export function KillSwitchesTab({
  switches,
  adminRole,
}: {
  switches: KillSwitch[]
  adminRole: 'platform_operator' | 'support' | 'read_only'
}) {
  const [modal, setModal] = useState<Modal>(null)
  const canWrite = adminRole === 'platform_operator'
  const engagedCount = switches.filter((s) => s.enabled).length

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-zinc-200 p-4">
        <h3 className="text-sm font-semibold">Kill switches</h3>
        {engagedCount === 0 ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            All normal
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {engagedCount} engaged
          </span>
        )}
      </header>

      <div className="flex flex-col gap-3 p-4">
        {switches.map((sw) => (
          <div
            key={sw.switch_key}
            className={
              sw.enabled
                ? 'rounded border-2 border-red-300 bg-red-50 p-3'
                : 'rounded border border-zinc-200 bg-white p-3'
            }
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="font-mono text-sm font-semibold">
                  {sw.switch_key}
                </div>
                <div className="text-sm text-zinc-700">{sw.display_name}</div>
                <div className="mt-1 text-xs text-zinc-600">{sw.description}</div>
                {sw.enabled && sw.reason ? (
                  <div className="mt-2 rounded bg-white p-2 text-xs text-red-900">
                    <strong>Reason:</strong> {sw.reason}
                    {sw.set_by_name ? (
                      <span className="ml-2 text-zinc-600">
                        · by {sw.set_by_name}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div
                  className={
                    sw.enabled
                      ? 'text-xs font-medium text-red-700'
                      : 'text-xs font-medium text-green-700'
                  }
                >
                  ● {sw.enabled ? 'Engaged' : 'Normal'}
                </div>
                {sw.enabled ? (
                  <button
                    type="button"
                    onClick={() => setModal({ kind: 'disengage', sw })}
                    disabled={!canWrite}
                    className="rounded border border-green-600 bg-white px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Disengage
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setModal({ kind: 'engage', sw })}
                    disabled={!canWrite}
                    title={canWrite ? undefined : 'platform_operator role required'}
                    className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Engage kill
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        <p className="border-t border-zinc-200 pt-3 text-xs text-zinc-500">
          Engaging a kill switch requires reason ≥ 10 chars (audit-logged).
          Confirmation prompt asks the operator to type the switch_key to
          confirm. Worker and Edge Functions read state from Cloudflare KV;
          sync runs every 2 minutes via the <code>admin-sync-config-to-kv</code>
          cron.
        </p>
      </div>

      {modal?.kind === 'engage' ? (
        <EngageModal sw={modal.sw} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'disengage' ? (
        <DisengageModal sw={modal.sw} onClose={() => setModal(null)} />
      ) : null}
    </div>
  )
}

function EngageModal({ sw, onClose }: { sw: KillSwitch; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonOk = reason.trim().length >= 10
  const confirmationOk = confirmation === sw.switch_key

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await toggleKillSwitch({
      switchKey: sw.switch_key,
      enabled: true,
      reason,
    })
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title={`Engage kill switch: ${sw.switch_key}`}
      subtitle={sw.display_name}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <strong>{sw.description}</strong>
          <br />
          Propagates to Worker and Edge Functions within ~2 minutes via the
          Cloudflare KV sync cron.
        </div>

        <ReasonField reason={reason} onChange={setReason} />

        <Field label={`Type "${sw.switch_key}" to confirm`}>
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            placeholder={sw.switch_key}
            className="rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
          />
        </Field>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Engage kill"
          submitDanger
          disabled={!reasonOk || !confirmationOk}
        />
      </form>
    </ModalShell>
  )
}

function DisengageModal({
  sw,
  onClose,
}: {
  sw: KillSwitch
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await toggleKillSwitch({
      switchKey: sw.switch_key,
      enabled: false,
      reason,
    })
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title={`Disengage kill switch: ${sw.switch_key}`}
      subtitle={sw.display_name}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Disengage"
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}
