import crypto from 'crypto'

export const PROMOTION_DECISION_STATUS = Object.freeze({
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SKIPPED: 'skipped'
})

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export class PromotionDecision {
  constructor(input = {}) {
    this.decisionId = input.decisionId || makeId('promotion_decision')
    this.status = input.status || PROMOTION_DECISION_STATUS.SKIPPED
    this.approved = this.status === PROMOTION_DECISION_STATUS.APPROVED
    this.candidateId = input.candidateId || null
    this.candidateType = input.candidateType || 'unknown'
    this.platform = input.platform || 'unknown'
    this.taskType = input.taskType || 'unknown'
    this.fromStatus = input.fromStatus || 'candidate'
    this.targetStatus = input.targetStatus || 'candidate_verified'
    this.reason = input.reason || 'not_evaluated'
    this.replaySummary = input.replaySummary || { passed: 0, failed: 0, skipped: 0, total: 0 }
    this.reviewSummary = input.reviewSummary || { required: true, approved: false }
    this.matchedRules = Array.isArray(input.matchedRules) ? input.matchedRules : []
    this.guardrails = {
      applyAutomatically: false,
      changesExecutionPath: false,
      requiresHumanReview: true,
      ...(input.guardrails || {}),
      applyAutomatically: false,
      changesExecutionPath: false,
      requiresHumanReview: true
    }
    this.metadata = input.metadata || {}
    this.createdAt = input.createdAt || nowIso()
  }

  toJSON() {
    return {
      decisionId: this.decisionId,
      status: this.status,
      approved: this.approved,
      candidateId: this.candidateId,
      candidateType: this.candidateType,
      platform: this.platform,
      taskType: this.taskType,
      fromStatus: this.fromStatus,
      targetStatus: this.targetStatus,
      reason: this.reason,
      replaySummary: this.replaySummary,
      reviewSummary: this.reviewSummary,
      matchedRules: this.matchedRules,
      guardrails: this.guardrails,
      metadata: this.metadata,
      createdAt: this.createdAt
    }
  }
}

export function createPromotionDecision(input = {}) {
  return new PromotionDecision(input)
}
