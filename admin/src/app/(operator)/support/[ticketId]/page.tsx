import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { TicketControls } from '@/components/support/ticket-controls'
import { ReplyForm } from '@/components/support/reply-form'

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
      .select('id, ticket_id, author_kind, author_id, body, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at'),
    supabase.schema('admin').from('admin_users').select('id, display_name'),
  ])

  if (ticketRes.error || !ticketRes.data) notFound()

  const ticket = ticketRes.data as Ticket
  const messages = (messagesRes.data ?? []) as TicketMessage[]

  const adminById = new Map<string, string>()
  for (const a of adminsRes.data ?? []) adminById.set(a.id, a.display_name)

  const orgName = ticket.org_id
    ? (
        await supabase
          .from('organisations')
          .select('name')
          .eq('id', ticket.org_id)
          .maybeSingle()
      ).data?.name ?? null
    : null

  const admins = adminsRes.data ?? []

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const adminRole =
    (user?.app_metadata?.admin_role as
      | 'platform_operator'
      | 'support'
      | 'read_only'
      | undefined) ?? 'read_only'
  const canWrite = adminRole === 'platform_operator' || adminRole === 'support'

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <p className="text-xs text-zinc-500">
          <Link href="/support" className="hover:underline">
            ← Support Tickets
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">{ticket.subject}</h1>
        <p className="mt-1 text-xs text-zinc-600">
          <span className="font-mono">{ticket.id}</span>
          {' · '}
          Reporter: {ticket.reporter_email}
          {ticket.reporter_name ? ` (${ticket.reporter_name})` : ''}
          {orgName ? ` · Org: ${orgName}` : ''}
          {' · '}
          Opened {new Date(ticket.created_at).toLocaleString()}
        </p>
      </header>

      <TicketControls
        ticketId={ticket.id}
        currentStatus={ticket.status}
        currentPriority={ticket.priority}
        currentAssignee={ticket.assigned_admin_user_id}
        admins={admins}
        canWrite={canWrite}
      />

      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Thread</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
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
  const authorLabel = isAdmin
    ? adminName ?? 'Operator'
    : isSystem
      ? 'System'
      : reporterName

  const wrapperClasses = isAdmin
    ? 'ml-auto max-w-[85%] rounded-lg bg-teal-50 p-3 shadow-sm'
    : isSystem
      ? 'mx-auto max-w-[85%] rounded-lg bg-zinc-100 p-3 text-zinc-700'
      : 'mr-auto max-w-[85%] rounded-lg bg-zinc-50 p-3 shadow-sm'

  const labelClasses = isAdmin
    ? 'text-xs font-semibold text-teal-800'
    : isSystem
      ? 'text-xs font-semibold text-zinc-600'
      : 'text-xs font-semibold text-zinc-700'

  return (
    <li className={wrapperClasses}>
      <div className="flex items-center justify-between">
        <span className={labelClasses}>{authorLabel}</span>
        <span className="text-xs text-zinc-500">
          {new Date(message.created_at).toLocaleString()}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
        {message.body}
      </p>
    </li>
  )
}
