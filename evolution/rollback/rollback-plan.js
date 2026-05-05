import crypto from 'crypto'

export const ROLLBACK_PLAN_STATUS = Object.freeze({
  PLANNED: 'planned',
  RECORDED: 'recorded',
  SKIPPED: 'skipped'
})

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export class RollbackPlan {
  constructor(input = {}) {
    this.rollbackId = input.rollbackId || makeId('rollback')
    this.status = input.status || ROLLBACK_PLAN_STATUS.PLANNED
    this.targetType = input.targetType || 'unknown'
    this.targetId = input.targetId || null
    this.platform = input.platform || 'unknown'
    this.currentVersion = input.currentVersion || null
    this.previousVersion = input.previousVersion || null
    this.reason = input.reason || ''
    this.steps = Array.isArray(input.steps) ? input.steps : []
    this.evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []
    this.guardrails = {
      executeAutomatically: false,
      changesExecutionPath: false,
      requiresHumanReview: true,
      ...(input.guardrails || {}),
      executeAutomatically: false,
      changesExecutionPath: false,
      requiresHumanReview: true
    }
    this.metadata = input.metadata || {}
    this.createdAt = input.createdAt || nowIso()
  }

  toJSON() {
    return {
      rollbackId: this.rollbackId,
      status: this.status,
      targetType: this.targetType,
      targetId: this.targetId,
      platform: this.platform,
      currentVersion: this.currentVersion,
      previousVersion: this.previousVersion,
      reason: this.reason,
      steps: this.steps,
      evidenceRefs: this.evidenceRefs,
      guardrails: this.guardrails,
      metadata: this.metadata,
      createdAt: this.createdAt
    }
  }
}

export function createRollbackPlan(input = {}) {
  return new RollbackPlan(input)
}
