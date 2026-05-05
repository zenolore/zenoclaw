import crypto from 'crypto'

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

function ratio(numerator, denominator) {
  if (!denominator) return 0
  return Number((numerator / denominator).toFixed(4))
}

function countStatus(items = [], predicate) {
  return (Array.isArray(items) ? items : []).filter(predicate).length
}

export class LearningMetricsReport {
  constructor(input = {}) {
    this.reportId = input.reportId || makeId('metrics')
    this.period = input.period || 'ad_hoc'
    this.failureRecovery = input.failureRecovery || { recovered: 0, total: 0, rate: 0 }
    this.verification = input.verification || { passed: 0, warned: 0, failed: 0, total: 0, passRate: 0, warnRate: 0, failRate: 0 }
    this.repairProposal = input.repairProposal || { approved: 0, rejected: 0, total: 0, approvalRate: 0 }
    this.replay = input.replay || { passed: 0, failed: 0, skipped: 0, total: 0, passRate: 0 }
    this.canary = input.canary || { allowed: 0, blocked: 0, skipped: 0, total: 0, allowRate: 0 }
    this.guardrails = {
      changesExecutionPath: false,
      metricsOnly: true,
      ...(input.guardrails || {}),
      changesExecutionPath: false,
      metricsOnly: true
    }
    this.metadata = input.metadata || {}
    this.createdAt = input.createdAt || nowIso()
  }

  toJSON() {
    return {
      reportId: this.reportId,
      period: this.period,
      failureRecovery: this.failureRecovery,
      verification: this.verification,
      repairProposal: this.repairProposal,
      replay: this.replay,
      canary: this.canary,
      guardrails: this.guardrails,
      metadata: this.metadata,
      createdAt: this.createdAt
    }
  }
}

export function computeLearningMetrics(input = {}) {
  const failures = Array.isArray(input.failures) ? input.failures : []
  const verifications = Array.isArray(input.verifications) ? input.verifications : []
  const proposals = Array.isArray(input.proposals) ? input.proposals : []
  const replayResults = Array.isArray(input.replayResults) ? input.replayResults : []
  const canaryResults = Array.isArray(input.canaryResults) ? input.canaryResults : []

  const recovered = countStatus(failures, item => item.recovered === true || item.status === 'recovered')
  const verificationPassed = countStatus(verifications, item => item.passed === true || item.status === 'passed')
  const verificationWarned = countStatus(verifications, item => item.status === 'warn')
  const verificationFailed = countStatus(verifications, item => item.passed === false || item.status === 'failed' || item.status === 'fail')
  const proposalApproved = countStatus(proposals, item => item.status === 'approved' || item.approved === true)
  const proposalRejected = countStatus(proposals, item => item.status === 'rejected')
  const replayPassed = countStatus(replayResults, item => item.passed === true || item.status === 'passed')
  const replaySkipped = countStatus(replayResults, item => item.status === 'skipped')
  const replayFailed = replayResults.length - replayPassed - replaySkipped
  const canaryAllowed = countStatus(canaryResults, item => item.allowed === true || item.status === 'allow')
  const canaryBlocked = countStatus(canaryResults, item => item.status === 'block')
  const canarySkipped = countStatus(canaryResults, item => item.status === 'skip' || item.status === 'skipped')

  return new LearningMetricsReport({
    period: input.period || 'ad_hoc',
    failureRecovery: { recovered, total: failures.length, rate: ratio(recovered, failures.length) },
    verification: {
      passed: verificationPassed,
      warned: verificationWarned,
      failed: verificationFailed,
      total: verifications.length,
      passRate: ratio(verificationPassed, verifications.length),
      warnRate: ratio(verificationWarned, verifications.length),
      failRate: ratio(verificationFailed, verifications.length)
    },
    repairProposal: {
      approved: proposalApproved,
      rejected: proposalRejected,
      total: proposals.length,
      approvalRate: ratio(proposalApproved, proposals.length)
    },
    replay: { passed: replayPassed, failed: replayFailed, skipped: replaySkipped, total: replayResults.length, passRate: ratio(replayPassed, replayResults.length) },
    canary: { allowed: canaryAllowed, blocked: canaryBlocked, skipped: canarySkipped, total: canaryResults.length, allowRate: ratio(canaryAllowed, canaryResults.length) },
    metadata: input.metadata || {}
  })
}

export function createLearningMetricsReport(input = {}) {
  return new LearningMetricsReport(input)
}
