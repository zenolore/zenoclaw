import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createManualReviewRecord, MANUAL_REVIEW_STATUS } from './manual-review-record.js'
import { createManualReviewStore } from './manual-review-store.js'

export class ManualReviewQueue {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.store = options.store || createManualReviewStore({ config: this.config, flags: this.flags })
  }

  get enabled() {
    return this.flags.manualReviewEnabled === true
  }

  enqueue(item = {}) {
    if (!this.enabled) return null
    const record = createManualReviewRecord({
      status: MANUAL_REVIEW_STATUS.PENDING,
      itemId: item.itemId || item.proposalId || item.ruleId || item.strategyId || item.decisionId || null,
      itemType: item.itemType || item.type || 'unknown',
      platform: item.platform || 'unknown',
      taskType: item.taskType || 'unknown',
      priority: item.priority || this.config.review?.defaultPriority || 'normal',
      reason: item.reason || item.suggestedAction || '',
      evidenceRefs: item.evidenceRefs || [],
      metadata: item.metadata || {}
    })
    return this.store.upsert(record)
  }

  decide(review = {}) {
    if (!this.enabled) return null
    const status = review.approved === true
      ? MANUAL_REVIEW_STATUS.APPROVED
      : (review.status || MANUAL_REVIEW_STATUS.REJECTED)
    const record = createManualReviewRecord({
      ...review,
      status,
      decision: status,
      updatedAt: new Date().toISOString()
    })
    return this.store.upsert(record)
  }

  readQueue() {
    return this.store.readQueue()
  }
}

export function createManualReviewQueue(options = {}) {
  return new ManualReviewQueue(options)
}
