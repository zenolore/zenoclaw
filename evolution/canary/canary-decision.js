import crypto from 'crypto'

export const CANARY_DECISION_STATUS = Object.freeze({
  ALLOW: 'allow',
  BLOCK: 'block',
  SKIP: 'skip'
})

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export class CanaryDecision {
  constructor(input = {}) {
    this.decisionId = input.decisionId || makeId('canary_decision')
    this.status = input.status || CANARY_DECISION_STATUS.SKIP
    this.allowed = this.status === CANARY_DECISION_STATUS.ALLOW
    this.mode = input.mode || 'off'
    this.platform = input.platform || 'unknown'
    this.taskType = input.taskType || 'unknown'
    this.stepName = input.stepName || null
    this.reason = input.reason || 'not_evaluated'
    this.riskLevel = input.riskLevel || 'unknown'
    this.sampleRate = Number.isFinite(input.sampleRate) ? input.sampleRate : 0
    this.matchedRules = Array.isArray(input.matchedRules) ? input.matchedRules : []
    this.guardrails = {
      dryRunOnly: input.guardrails?.dryRunOnly !== false,
      changesExecutionPath: false,
      requiresCanaryMode: true,
      ...(input.guardrails || {}),
      changesExecutionPath: false
    }
    this.metadata = input.metadata || {}
    this.createdAt = input.createdAt || nowIso()
  }

  toJSON() {
    return {
      decisionId: this.decisionId,
      status: this.status,
      allowed: this.allowed,
      mode: this.mode,
      platform: this.platform,
      taskType: this.taskType,
      stepName: this.stepName,
      reason: this.reason,
      riskLevel: this.riskLevel,
      sampleRate: this.sampleRate,
      matchedRules: this.matchedRules,
      guardrails: this.guardrails,
      metadata: this.metadata,
      createdAt: this.createdAt
    }
  }
}

export function createCanaryDecision(input = {}) {
  return new CanaryDecision(input)
}
