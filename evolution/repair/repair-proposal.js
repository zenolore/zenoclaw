import crypto from 'crypto'

export const REPAIR_PROPOSAL_STATUS = Object.freeze({
  CANDIDATE: 'candidate',
  RECORDED: 'recorded',
  SKIPPED: 'skipped'
})

export const REPAIR_PROPOSAL_TYPE = Object.freeze({
  SELECTOR_UPDATE: 'selector_update',
  WAIT_OR_RETRY_TUNING: 'wait_or_retry_tuning',
  INTERRUPTION_RULE: 'interruption_rule',
  VERIFICATION_RULE: 'verification_rule',
  DIAGNOSTIC_NOTE: 'diagnostic_note'
})

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export class RepairProposal {
  constructor(input = {}) {
    this.proposalId = input.proposalId || makeId('repair')
    this.status = input.status || REPAIR_PROPOSAL_STATUS.CANDIDATE
    this.type = input.type || REPAIR_PROPOSAL_TYPE.DIAGNOSTIC_NOTE
    this.source = input.source || 'unknown'
    this.platform = input.platform || 'unknown'
    this.taskType = input.taskType || 'unknown'
    this.stepName = input.stepName || 'unknown'
    this.reason = input.reason || ''
    this.confidence = Number(input.confidence || 0)
    this.suggestedAction = input.suggestedAction || ''
    this.patch = input.patch || null
    this.sourceFailureId = input.sourceFailureId || null
    this.sourceVerificationId = input.sourceVerificationId || null
    this.pageFingerprint = input.pageFingerprint || null
    this.guardrails = {
      ...input.guardrails,
      applyAutomatically: false,
      requiresHumanReview: true,
    }
    this.metadata = input.metadata || {}
    this.createdAt = input.createdAt || nowIso()
  }

  toJSON() {
    return {
      proposalId: this.proposalId,
      status: this.status,
      type: this.type,
      source: this.source,
      platform: this.platform,
      taskType: this.taskType,
      stepName: this.stepName,
      reason: this.reason,
      confidence: this.confidence,
      suggestedAction: this.suggestedAction,
      patch: this.patch,
      sourceFailureId: this.sourceFailureId,
      sourceVerificationId: this.sourceVerificationId,
      pageFingerprint: this.pageFingerprint,
      guardrails: this.guardrails,
      metadata: this.metadata,
      createdAt: this.createdAt
    }
  }
}

export function createRepairProposal(input = {}) {
  return new RepairProposal(input)
}
