'use client'

// Shared modal + form primitives for admin action modals.
//
// Hoisted from admin/src/components/orgs/action-bar.tsx when ADR-0036
// (Feature Flags & Kill Switches) added a second consumer. Both the
// Organisations action bar and the Feature Flags / Kill Switches
// surfaces reuse the same modal shell, reason field, and form footer
// so the audit-logged-admin-action UX is consistent.

export function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <header className="border-b border-zinc-200 p-4">
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-zinc-600">{subtitle}</p>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  )
}

export function ReasonField({
  reason,
  onChange,
}: {
  reason: string
  onChange: (s: string) => void
}) {
  const remaining = Math.max(0, 10 - reason.trim().length)
  return (
    <Field label={`Reason (≥ 10 chars — ${remaining} more needed)`}>
      <textarea
        value={reason}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        required
        placeholder="Why this action? Appears verbatim in the audit log."
        className="rounded border border-zinc-300 px-3 py-2 text-sm"
      />
    </Field>
  )
}

export function FormFooter({
  pending,
  onClose,
  submit,
  submitDanger = false,
  disabled = false,
}: {
  pending: boolean
  onClose: () => void
  submit: string
  submitDanger?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-zinc-200 pt-4">
      <button
        type="button"
        onClick={onClose}
        className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending || disabled}
        className={
          submitDanger
            ? 'rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50'
            : 'rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50'
        }
      >
        {pending ? 'Submitting…' : submit}
      </button>
    </div>
  )
}
