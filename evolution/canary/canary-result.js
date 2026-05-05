import crypto from 'crypto'

export const CANARY_RESULT_STATUS = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  SKIPPED: 'skipped'
})

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export class CanaryResult {
  constructor(input = {}) {
    this.resultId = input.resultId || makeId('canary_result')
    this.decisionId = input.decisionId || input.decision?.decisionId || null
    this.status = input.status || CANARY_RESULT_STATUS.SKIPPED
    this.decisionStatus = input.decisionStatus || input.decision?.status || 'unknown'
    this.allowed = input.allowed === true || input.decision?.allowed === true
    this.platform = input.platform || input.decision?.platform || 'unknown'
    this.taskType = input.taskType || input.decision?.taskType || 'unknown'
    this.stepName = input.stepName || input.decision?.stepName || null
    this.reason = input.reason || ''
    this.outcome = input.outcome || null
    this.error = input.error || null
    this.durationMs = Number(input.durationMs || 0)
    this.guardrails = {
      recordOnly: true,
      changesExecutionPath: false,
      authorizesExecution: false,
      ...(input.guardrails || {}),
      recordOnly: true,
      changesExecutionPath: false,
      authorizesExecution: false
    }
    this.metadata = input.metadata || {}
    this.createdAt = input.createdAt || nowIso()
  }

  toJSON() {
    return {
      resultId: this.resultId,
      decisionId: this.decisionId,
      status: this.status,
      decisionStatus: this.decisionStatus,
      allowed: this.allowed,
      platform: this.platform,
      taskType: this.taskType,
      stepName: this.stepName,
      reason: this.reason,
      outcome: this.outcome,
      error: this.error,
      durationMs: this.durationMs,
      guardrails: this.guardrails,
      metadata: this.metadata,
      createdAt: this.createdAt
    }
  }
}

export function createCanaryResult(input = {}) {
  return new CanaryResult(input)
}
