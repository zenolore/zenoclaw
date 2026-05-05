import crypto from 'crypto'

export const MANUAL_REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  NEEDS_CHANGES: 'needs_changes'
})

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export class ManualReviewRecord {
  constructor(input = {}) {
    this.reviewId = input.reviewId || makeId('manual_review')
    this.status = input.status || MANUAL_REVIEW_STATUS.PENDING
    this.itemId = input.itemId || null
    this.itemType = input.itemType || 'unknown'
    this.platform = input.platform || 'unknown'
    this.taskType = input.taskType || 'unknown'
    this.priority = input.priority || 'normal'
    this.reason = input.reason || ''
    this.reviewer = input.reviewer || null
    this.decision = input.decision || null
    this.notes = input.notes || ''
    this.evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []
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
    this.updatedAt = input.updatedAt || this.createdAt
  }

  toJSON() {
    return {
      reviewId: this.reviewId,
      status: this.status,
      itemId: this.itemId,
      itemType: this.itemType,
      platform: this.platform,
      taskType: this.taskType,
      priority: this.priority,
      reason: this.reason,
      reviewer: this.reviewer,
      decision: this.decision,
      notes: this.notes,
      evidenceRefs: this.evidenceRefs,
      guardrails: this.guardrails,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    }
  }
}

export function createManualReviewRecord(input = {}) {
  return new ManualReviewRecord(input)
}
