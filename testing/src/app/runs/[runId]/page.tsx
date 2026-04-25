import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAllRuns, getRunById } from '../../../data/runs'
import { StatusPill } from '../../../components/status-pill'
import { formatDate, formatDateTime } from '../../../data/types'

interface PageProps {
  params: Promise<{ runId: string }>
}

export function generateStaticParams() {
  return getAllRuns().map((r) => ({ runId: r.runId }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { runId } = await params
  const run = getRunById(runId)
  if (!run) return { title: 'Run not found' }
  return {
    title: `${run.branch} · ${run.commitSha} · ${formatDate(run.date)}`,
    description: `ConsentShield E2E run ${run.runId} — ${run.tally.expected} expected, ${run.tally.unexpected} unexpected.`
  }
}

export default async function RunPage({ params }: PageProps) {
  const { runId } = await params
  const run = getRunById(runId)
  if (!run) notFound()

  const archiveDisabled = run.archiveUrl === null

  return (
    <article className="max-w-3xl">
      <p className="text-sm text-slate-500">
        <Link href="/" className="underline hover:text-ink">
          ← Runs
        </Link>
      </p>

      <header className="mt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-navy">
            {run.branch} · <span className="font-mono">{run.commitSha}</span>
          </h1>
          <StatusPill status={run.status} />
          {run.partnerReproduction ? (
            <span className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
              Partner reproduction
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-500 font-mono">
          runId: {run.runId} · sealRoot:{' '}
          {run.archiveSealRoot ?? <span className="italic text-slate-400">pending upload</span>}
        </p>
        <p className="mt-1 text-sm text-slate-500">Run started: {formatDateTime(run.date)}</p>
      </header>

      <section className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-4 rounded-lg border border-slate-200 p-5">
        <Stat label="Total" value={run.tally.total} />
        <Stat label="Expected" value={run.tally.expected} accent="text-emerald-700" />
        <Stat
          label="Unexpected"
          value={run.tally.unexpected}
          accent={run.tally.unexpected > 0 ? 'text-red-700' : undefined}
        />
        <Stat label="Flaky" value={run.tally.flaky} />
        <Stat
          label="Mutation score"
          value={run.mutationScore === null ? '—' : `${run.mutationScore}%`}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Coverage</h2>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <Dt>Browsers</Dt>
          <Dd>
            {run.browsers.length === 0
              ? 'none'
              : run.browsers.map((b) => (
                  <span
                    key={b}
                    className="mr-1.5 inline-flex items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700"
                  >
                    {b}
                  </span>
                ))}
          </Dd>
          <Dt>Verticals</Dt>
          <Dd>
            {run.verticals.length === 0
              ? '—'
              : run.verticals.map((v) => (
                  <Link
                    key={v}
                    href={`/verticals/${v}`}
                    className="mr-1.5 inline-flex items-center rounded border border-teal/30 bg-teal-light px-1.5 py-0.5 text-xs text-teal hover:border-teal"
                  >
                    {v}
                  </Link>
                ))}
          </Dd>
          <Dt>Sprints exercised</Dt>
          <Dd>
            {run.sprints.map((s) => (
              <Link
                key={s}
                href={`/sprints/${s}`}
                className="mr-1.5 inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:border-slate-500"
              >
                Sprint {s}
              </Link>
            ))}
          </Dd>
          <Dt>Phases</Dt>
          <Dd>
            {run.phases.map((p) => (
              <Link
                key={p}
                href={`/phases/${p}`}
                className="mr-1.5 inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:border-slate-500"
              >
                Phase {p}
              </Link>
            ))}
          </Dd>
        </dl>
      </section>

      {run.mutation && run.mutation.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Mutation testing breakdown</h2>
          <p className="mt-2 text-sm text-slate-600">
            Per-module Stryker score. The aggregate &ldquo;score&rdquo; column reads as
            <em> killed / (killed + survived + timeout + noCoverage)</em>; equivalent
            mutants are documented in the ADR and counted under
            &ldquo;survived&rdquo;. See{' '}
            <a
              className="underline hover:text-ink"
              href="https://consentshield.in/docs/test-verification/mutation-testing"
              target="_blank"
              rel="noopener noreferrer"
            >
              /docs/test-verification/mutation-testing
            </a>{' '}
            for what each module covers and what survivors mean.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Module</th>
                  <th className="px-3 py-2 text-right">Sprint</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Killed</th>
                  <th className="px-3 py-2 text-right">Survived</th>
                  <th className="px-3 py-2 text-right">Equivalent</th>
                  <th className="px-3 py-2 text-right">Timeout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {run.mutation.map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 text-ink">{m.label}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">{m.sprint}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold ${
                        m.score >= 90
                          ? 'text-emerald-700'
                          : m.score >= 80
                          ? 'text-amber-700'
                          : 'text-red-700'
                      }`}
                    >
                      {m.score.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">{m.killed}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        m.survived > m.equivalent ? 'text-red-700' : 'text-slate-700'
                      }`}
                    >
                      {m.survived}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{m.equivalent}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{m.timeout}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {run.notes ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Notes</h2>
          <p className="mt-3 text-slate-700 whitespace-pre-wrap">{run.notes}</p>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Evidence archive</h2>
        <div className="mt-3 rounded-lg border border-slate-200 p-5">
          {archiveDisabled ? (
            <p className="text-sm text-slate-700">
              Sealed archive not yet uploaded for this run. The entry remains in the index so
              reviewers can see the run occurred; ask{' '}
              <a className="underline hover:text-ink" href="mailto:support@consentshield.in">
                support@consentshield.in
              </a>{' '}
              for an off-index copy.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <a
                href={run.archiveUrl ?? '#'}
                className="inline-flex items-center gap-2 rounded bg-navy text-white px-4 py-2 text-sm font-medium hover:bg-navy-dark"
              >
                Download sealed archive
              </a>
              <p className="text-sm text-slate-700">
                Verify integrity with the bundled CLI:
              </p>
              <pre className="bg-slate-900 text-slate-100 rounded p-3 text-xs overflow-x-auto">
                <code>bunx tsx scripts/e2e-verify-evidence.ts path/to/extracted/archive</code>
              </pre>
              <p className="text-sm text-slate-500">
                Exit 0 = intact · exit 1 = tampered · exit 2 = IO / usage error.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Reproduce this run</h2>
        <ol className="mt-3 list-decimal list-outside pl-6 space-y-2 text-sm text-slate-700">
          <li>
            Clone the ConsentShield repo at commit{' '}
            <span className="font-mono">{run.commitSha}</span>:
            <pre className="mt-2 bg-slate-900 text-slate-100 rounded p-3 text-xs overflow-x-auto">
              <code>{`git clone https://github.com/aiSpirit-systems/consentshield.git
cd consentshield && git checkout ${run.commitSha}`}</code>
            </pre>
          </li>
          <li>Follow <a className="underline hover:text-ink" href="https://consentshield.in/docs/test-verification" target="_blank" rel="noopener noreferrer">/docs/test-verification</a> from step 2 onward (bootstrap + run + verify).</li>
          <li>
            Compare your <span className="font-mono">manifest.json</span> pass/fail shape
            against the tally above. Trace IDs and timings WILL differ. Per-test outcomes
            should match.
          </li>
        </ol>
      </section>
    </article>
  )
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`font-mono font-semibold text-lg ${accent ?? 'text-ink'}`}>{value}</div>
    </div>
  )
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="text-slate-500 uppercase tracking-wider text-xs">{children}</dt>
}
function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="text-ink">{children}</dd>
}
