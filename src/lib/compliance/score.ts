// Compliance score computation
// Weighted composite per definitive architecture Section 8 / v2 blueprint Section 8

export interface ScoreInputs {
  hasActiveBanner: boolean
  hasVerifiedSnippet: boolean
  consentEventsLast24h: number
  hasDataInventory: boolean
  pendingRightsRequests: number
  overdueRightsRequests: number
  trackerViolationsLast24h: number
}

export interface ScoreBreakdown {
  total: number
  components: {
    consent_infrastructure: number // 20%
    consent_enforcement: number // 30%
    rights: number // 15%
    data_lifecycle: number // 15%
    security: number // 10%
    audit_readiness: number // 10%
  }
  level: 'red' | 'amber' | 'green'
}

export function computeComplianceScore(inputs: ScoreInputs): ScoreBreakdown {
  // Consent infrastructure (20%): banner deployed and verified
  let consentInfra = 0
  if (inputs.hasActiveBanner) consentInfra += 50
  if (inputs.hasVerifiedSnippet) consentInfra += 50
  consentInfra = (consentInfra / 100) * 20

  // Consent enforcement (30%): events flowing, no violations
  let consentEnforce = 0
  if (inputs.consentEventsLast24h > 0) consentEnforce += 60
  if (inputs.trackerViolationsLast24h === 0 && inputs.consentEventsLast24h > 0) {
    consentEnforce += 40
  } else if (inputs.trackerViolationsLast24h > 0) {
    // Subtract proportionally for violations
    const penalty = Math.min(40, inputs.trackerViolationsLast24h * 2)
    consentEnforce += Math.max(0, 40 - penalty)
  }
  consentEnforce = (consentEnforce / 100) * 30

  // Rights (15%): no overdue requests
  let rights = 100
  if (inputs.overdueRightsRequests > 0) rights = 0
  else if (inputs.pendingRightsRequests > 5) rights = 50
  rights = (rights / 100) * 15

  // Data lifecycle (15%): inventory exists
  const dataLifecycle = inputs.hasDataInventory ? 15 : 0

  // Security (10%): placeholder until security_scans are populated
  const security = inputs.hasVerifiedSnippet ? 10 : 0

  // Audit readiness (10%): banner + inventory + events combined
  let auditReadiness = 0
  if (inputs.hasActiveBanner) auditReadiness += 30
  if (inputs.hasDataInventory) auditReadiness += 30
  if (inputs.consentEventsLast24h > 0) auditReadiness += 40
  auditReadiness = (auditReadiness / 100) * 10

  const total = Math.round(
    consentInfra + consentEnforce + rights + dataLifecycle + security + auditReadiness,
  )

  const level: ScoreBreakdown['level'] = total >= 80 ? 'green' : total >= 50 ? 'amber' : 'red'

  return {
    total,
    components: {
      consent_infrastructure: Math.round(consentInfra),
      consent_enforcement: Math.round(consentEnforce),
      rights: Math.round(rights),
      data_lifecycle: Math.round(dataLifecycle),
      security: Math.round(security),
      audit_readiness: Math.round(auditReadiness),
    },
    level,
  }
}

export function isoSinceHours(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

export function nowIso(): string {
  return new Date().toISOString()
}

// DPDP enforcement: 13 May 2027
const ENFORCEMENT_DATE = new Date('2027-05-13T00:00:00+05:30')

export function daysUntilEnforcement(now: Date = new Date()): number {
  const ms = ENFORCEMENT_DATE.getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}
