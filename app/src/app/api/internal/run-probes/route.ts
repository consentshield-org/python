import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Sandbox } from '@vercel/sandbox'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  computeViolations,
  matchSignatures,
  overallStatus,
  type Signature,
} from '@/lib/probes/signature-match'

// ADR-0041 — probe orchestrator on Vercel Functions.
// Called by pg_cron (bearer-authenticated via PROBE_CRON_SECRET). For each
// active probe due a run, creates an ephemeral Vercel Sandbox, copies in
// sandbox-scripts/**, runs Playwright scenario, collects stdout JSON,
// runs signature matching locally, and writes consent_probe_runs row.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ORCHESTRATOR_KEY = process.env.CS_ORCHESTRATOR_ROLE_KEY!
const PROBE_CRON_SECRET = process.env.PROBE_CRON_SECRET ?? ''
const VERCEL_TEAM = process.env.VERCEL_TEAM_ID
const VERCEL_PROJECT = process.env.VERCEL_PROJECT_ID
const SANDBOX_TIMEOUT_MS = 120_000

interface Probe {
  id: string
  org_id: string
  property_id: string
  probe_type: string
  consent_state: Record<string, boolean>
  schedule: string
  is_active: boolean
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!PROBE_CRON_SECRET || !auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice('Bearer '.length).trim()
  if (token !== PROBE_CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  const { data: probes, error: probeErr } = await supabase
    .from('consent_probes')
    .select('id, org_id, property_id, probe_type, consent_state, schedule, is_active')
    .eq('is_active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${new Date().toISOString()}`)
    .limit(20)
  if (probeErr) {
    return NextResponse.json({ error: probeErr.message }, { status: 500 })
  }
  if (!probes || probes.length === 0) {
    return NextResponse.json({ status: 'no_probes_due' }, { status: 200 })
  }

  const { data: sigRows, error: sigErr } = await supabase
    .from('tracker_signatures')
    .select('service_slug, category, is_functional, detection_rules')
    .eq('is_active', true)
  if (sigErr) {
    return NextResponse.json({ error: sigErr.message }, { status: 500 })
  }
  const signatures = (sigRows ?? []) as Signature[]

  const results: Array<{ probe_id: string; status: string; violations?: number; error?: string }> = []

  for (const probe of probes as Probe[]) {
    try {
      const r = await runProbe(supabase, probe, signatures)
      results.push(r)
    } catch (e) {
      results.push({
        probe_id: probe.id,
        status: 'failed',
        error: e instanceof Error ? e.message : 'unknown',
      })
    }
  }

  return NextResponse.json({ processed: probes.length, results }, { status: 200 })
}

async function runProbe(
  supabase: SupabaseClient,
  probe: Probe,
  signatures: Signature[],
): Promise<{ probe_id: string; status: string; violations: number }> {
  const { data: property } = await supabase
    .from('web_properties')
    .select('url')
    .eq('id', probe.property_id)
    .single()
  const propertyRow = property as { url?: string } | null
  if (!propertyRow?.url) {
    throw new Error('property_not_found_or_no_url')
  }

  const targetUrl = propertyRow.url
  const config = {
    url: targetUrl,
    consent_cookie_name: 'cs_consent',
    consent_state: probe.consent_state ?? {},
    wait_ms: 3000,
  }

  // Create the sandbox.
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: SANDBOX_TIMEOUT_MS,
    teamId: VERCEL_TEAM,
    projectId: VERCEL_PROJECT,
  })

  try {
    // Copy sandbox-scripts/* in.
    const scriptsDir = path.join(process.cwd(), 'sandbox-scripts')
    await copyDirectoryToSandbox(sandbox, scriptsDir, '/work')

    // Install deps inside the sandbox.
    const install = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'cd /work && npm install --omit=dev && npx playwright install chromium'],
    })
    if (install.exitCode !== 0) {
      const err = await install.stderr()
      throw new Error(`sandbox install failed: ${err.slice(0, 400)}`)
    }

    // Write probe config to /tmp/probe-input.json.
    await sandbox.writeFiles([
      { path: '/tmp/probe-input.json', content: Buffer.from(JSON.stringify(config)) },
    ])

    const runResult = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'cd /work && node probe-runner.mjs'],
    })
    if (runResult.exitCode !== 0) {
      const err = await runResult.stderr()
      throw new Error(`sandbox probe failed: ${err.slice(0, 400)}`)
    }

    const raw = (await runResult.stdout()).trim()
    let parsed: {
      url: string
      status: number | null
      page_load_ms: number
      title: string | null
      user_agent: string
      consent_state: Record<string, boolean>
      network_urls: string[]
      script_srcs: string[]
      iframe_srcs: string[]
      img_srcs: string[]
      cookies: Array<{ name: string; domain: string; path: string }>
    }
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`sandbox stdout not JSON: ${raw.slice(0, 200)}`)
    }

    const allUrls = [
      ...parsed.network_urls,
      ...parsed.script_srcs,
      ...parsed.iframe_srcs,
      ...parsed.img_srcs,
    ]
    const detections = matchSignatures(allUrls, signatures)
    const violations = computeViolations(detections, parsed.consent_state ?? {})
    const status = overallStatus(violations)

    const result = {
      browser_version: parsed.user_agent,
      user_agent: parsed.user_agent,
      page_load_ms: parsed.page_load_ms,
      title: parsed.title,
      http_status: parsed.status,
      detected_trackers: detections.map((d) => ({
        service_slug: d.slug,
        category: d.category,
        is_functional: d.functional,
        url: d.url,
        matched_pattern: d.matched_pattern,
      })),
      violations,
      overall_status: status,
    }

    await supabase.from('consent_probe_runs').insert({
      org_id: probe.org_id,
      probe_id: probe.id,
      property_id: probe.property_id,
      run_at: new Date().toISOString(),
      consent_state: probe.consent_state,
      overall_status: status,
      result,
    })

    const nextRun = computeNextRun(probe.schedule)
    await supabase
      .from('consent_probes')
      .update({
        last_run_at: new Date().toISOString(),
        last_result: { overall_status: status, violations: violations.length },
        next_run_at: nextRun.toISOString(),
      })
      .eq('id', probe.id)

    return { probe_id: probe.id, status, violations: violations.length }
  } finally {
    try {
      await sandbox.stop()
    } catch {
      // best-effort
    }
  }
}

async function copyDirectoryToSandbox(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string,
): Promise<void> {
  for (const entry of readdirSync(localDir)) {
    const localPath = path.join(localDir, entry)
    const remotePath = `${remoteDir}/${entry}`
    const s = statSync(localPath)
    if (s.isDirectory()) {
      await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', remotePath] })
      await copyDirectoryToSandbox(sandbox, localPath, remotePath)
    } else {
      const content = readFileSync(localPath)
      await sandbox.writeFiles([{ path: remotePath, content }])
    }
  }
}

function computeNextRun(schedule: string): Date {
  const now = Date.now()
  switch (schedule) {
    case 'hourly':
      return new Date(now + 60 * 60 * 1000)
    case 'daily':
      return new Date(now + 24 * 60 * 60 * 1000)
    case 'weekly':
    default:
      return new Date(now + 7 * 24 * 60 * 60 * 1000)
  }
}
