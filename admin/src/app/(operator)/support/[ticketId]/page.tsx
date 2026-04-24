import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { canSupport, type AdminRole } from '@/lib/admin/role-tiers'
import { TicketControls } from '@/components/support/ticket-controls'
import { ReplyForm } from '@/components/support/reply-form'
import { AccountContextCard } from '@/components/account-context/account-context-card'

// ADR-0032 Sprint 1.1 — Support ticket detail + thread + reply.

export const dynamic = 'force-dynamic'

interface Ticket {
  id: string
  org_id: string | null
  subject: string
  status: string
  priority: string
  category: string | null
  reporter_email: string
  reporter_name: string | null
  created_at: string
  resolved_at: string | null
  resolution_summary: string | null
  assigned_admin_user_id: string | null
}

interface TicketMessage {
  id: string
  ticket_id: string
  author_kind: 'admin' | 'customer' | 'system'
  author_id: string | null
  body: string
  is_internal: boolean
  created_at: string
}

interface PageProps {
  params: Promise<{ ticketId: string }>
}

export default async function TicketDetailPage({ params }: PageProps) {
  const { ticketId } = await params
  const supabase = await createServerClient()

  const [ticketRes, messagesRes, adminsRes] = await Promise.all([
    supabase
      .schema('admin')
      .from('support_tickets')
      .select(
        'id, org_id, subject, status, priority, category, reporter_email, reporter_name, created_at, resolved_at, resolution_summary, assigned_admin_user_id',
      )
      .eq('id', ticketId)
      .maybeSingle(),
    supabase
      .schema('admin')
      .from('support_ticket_messages')
      .select('id, ticket_id, author_kind, author_id, body, is_internal, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at'),
    supabase.schema('admin').from('admin_users').select('id, display_name'),
  ])

  if (ticketRes.error || !ticketRes.data) notFound()

  const ticket = ticketRes.data as Ticket
  const messages = (messagesRes.data ?? []) as TicketMessage[]

  const adminById = new Map<string, string>()
  for (const a of adminsRes.data ?? []) adminById.set(a.id, a.display_name)

  // ADR-1027 Sprint 2.2 — resolve org name + parent account id so the
  // ticket header can surface both and link to the account page.
  const orgMeta = ticket.org_id
    ? (
        await supabase
          .from('organisations')
          .select('name, account_id')
          .eq('id', ticket.org_id)
          .maybeSingle()
      ).data
    : null
  const orgName = orgMeta?.name ?? null
  const accountId = orgMeta?.account_id ?? null

  const admins = adminsRes.data ?? []

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const adminRole = (user?.app_metadata?.admin_role as AdminRole) ?? 'read_only'
  const canWrite = canSupport(adminRole)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href="/support" className="hover:underline">
            ← Support Tickets
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">{ticket.subject}</h1>
        <p className="mt-1 text-xs text-text-2">
          <span className="font-mono">{ticket.id}</span>
          {' · '}
          Reporter: {ticket.reporter_email}
          {ticket.reporter_name ? ` (${ticket.reporter_name})` : ''}
          {orgName ? ` · Org: ${orgName}` : ''}
          {' · '}
          Opened {new Date(ticket.created_at).toLocaleString()}
        </p>
      </header>

      {/* ADR-1027 Sprint 2.2 — parent-account context strip. */}
      {accountId ? (
        <AccountContextCard accountId={accountId} mode="compact" />
      ) : null}

      <TicketControls
        ticketId={ticket.id}
        currentStatus={ticket.status}
        currentPriority={ticket.priority}
        currentAssignee={ticket.assigned_admin_user_id}
        admins={admins}
        canWrite={canWrite}
      />

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Thread</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-text-3">
            No messages yet. Post the first reply below.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                adminName={m.author_id ? adminById.get(m.author_id) : null}
                reporterName={ticket.reporter_name ?? ticket.reporter_email}
              />
            ))}
          </ol>
        )}
      </section>

      <ReplyForm ticketId={ticket.id} canWrite={canWrite} />
    </div>
  )
}

function Message({
  message,
  adminName,
  reporterName,
}: {
  message: TicketMessage
  adminName: string | null | undefined
  reporterName: string
}) {
  const isAdmin = message.author_kind === 'admin'
  const isSystem = message.author_kind === 'system'
  const isInternal = message.is_internal === true

  const authorLabel = isAdmin
    ? adminName ?? 'Operator'
    : isSystem
      ? 'System'
      : reporterName

  const wrapperClasses = isInternal
    ? 'ml-auto max-w-[85%] rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3 shadow-sm'
    : isAdmin
      ? 'ml-auto max-w-[85%] rounded-lg bg-teal-50 p-3 shadow-sm'
      : isSystem
        ? 'mx-auto max-w-[85%] rounded-lg bg-bg p-3 text-text-2'
        : 'mr-auto max-w-[85%] rounded-lg bg-bg p-3 shadow-sm'

  const labelClasses = isInternal
    ? 'text-xs font-semibold text-amber-800'
    : isAdmin
      ? 'text-xs font-semibold text-teal-800'
      : isSystem
        ? 'text-xs font-semibold text-text-2'
        : 'text-xs font-semibold text-text-2'

  return (
    <li className={wrapperClasses}>
      <div className="flex items-center justify-between">
        <span className={labelClasses}>
          {isInternal ? `${authorLabel} · 🔒 Internal note` : authorLabel}
        </span>
        <span className="text-xs text-text-3">
          {new Date(message.created_at).toLocaleString()}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text">
        {message.body}
      </p>
    </li>
  )
}
