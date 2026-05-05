import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createPromotionDecision, PROMOTION_DECISION_STATUS } from './promotion-decision.js'
import { createPromotionDecisionStore } from './promotion-decision-store.js'

function summarizeReplay(results = []) {
  const summary = { passed: 0, failed: 0, skipped: 0, total: 0 }
  for (const result of Array.isArray(results) ? results : []) {
    summary.total += 1
    if (result?.status === 'passed' || result?.passed === true) summary.passed += 1
    else if (result?.status === 'skipped') summary.skipped += 1
    else summary.failed += 1
  }
  return summary
}

export class PromotionGate {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.store = options.store || createPromotionDecisionStore({ config: this.config, flags: this.flags })
  }

  get enabled() {
    return this.flags.promotionGateEnabled === true
  }

  evaluate(input = {}) {
    const promotion = this.config.promotion || {}
    const candidate = input.candidate || {}
    const replaySummary = summarizeReplay(input.replayResults || [])
    const review = input.review || {}
    const base = {
      candidateId: candidate.candidateId || candidate.ruleId || candidate.strategyId || input.candidateId || null,
      candidateType: candidate.type || input.candidateType || 'unknown',
      platform: candidate.platform || input.platform || 'unknown',
      taskType: candidate.taskType || input.taskType || 'unknown',
      fromStatus: candidate.status || 'candidate',
      targetStatus: promotion.targetStatus || 'candidate_verified',
      replaySummary,
      reviewSummary: {
        required: promotion.requireManualReview !== false,
        approved: review.approved === true,
        reviewId: review.reviewId || null
      },
      metadata: input.metadata || {}
    }

    if (!this.enabled) {
      return this._record(createPromotionDecision({ ...base, status: PROMOTION_DECISION_STATUS.SKIPPED, reason: 'promotion_gate_disabled' }))
    }

    const matchedRules = []
    if (promotion.allowAutoPromote === true) {
      matchedRules.push('auto_promote_requested_blocked')
      return this._record(createPromotionDecision({ ...base, status: PROMOTION_DECISION_STATUS.REJECTED, reason: 'auto_promote_not_allowed', matchedRules }))
    }

    if (candidate.status && candidate.status !== 'candidate') {
      matchedRules.push('invalid_source_status')
      return this._record(createPromotionDecision({ ...base, status: PROMOTION_DECISION_STATUS.REJECTED, reason: 'invalid_source_status', matchedRules }))
    }

    const minReplayPasses = Number(promotion.minReplayPasses ?? 3)
    const maxReplayFailures = Number(promotion.maxReplayFailures ?? 0)
    if (replaySummary.passed < minReplayPasses) {
      matchedRules.push('insufficient_replay_passes')
      return this._record(createPromotionDecision({ ...base, status: PROMOTION_DECISION_STATUS.REJECTED, reason: 'insufficient_replay_passes', matchedRules }))
    }

    if (replaySummary.failed > maxReplayFailures) {
      matchedRules.push('too_many_replay_failures')
      return this._record(createPromotionDecision({ ...base, status: PROMOTION_DECISION_STATUS.REJECTED, reason: 'too_many_replay_failures', matchedRules }))
    }

    if (promotion.requireManualReview !== false && review.approved !== true) {
      matchedRules.push('manual_review_required')
      return this._record(createPromotionDecision({ ...base, status: PROMOTION_DECISION_STATUS.REJECTED, reason: 'manual_review_required', matchedRules }))
    }

    matchedRules.push('promotion_criteria_met')
    return this._record(createPromotionDecision({ ...base, status: PROMOTION_DECISION_STATUS.APPROVED, reason: 'promotion_criteria_met', matchedRules }))
  }

  _record(decision) {
    this.store.record(decision)
    return decision
  }
}

export function createPromotionGate(options = {}) {
  return new PromotionGate(options)
}
