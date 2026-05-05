import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createRepairProposal, REPAIR_PROPOSAL_TYPE } from './repair-proposal.js'
import { createRepairProposalStore } from './repair-proposal-store.js'

function safeString(value) {
  return String(value || '').toLowerCase()
}

function inferFailureType(failure = {}) {
  const message = safeString(failure.errorMessage || failure.error?.message)
  if (message.includes('selector') || message.includes('waiting for selector') || message.includes('element')) {
    return REPAIR_PROPOSAL_TYPE.SELECTOR_UPDATE
  }
  if (message.includes('timeout') || message.includes('navigation') || message.includes('wait')) {
    return REPAIR_PROPOSAL_TYPE.WAIT_OR_RETRY_TUNING
  }
  if (failure.interruption?.hasPopup || message.includes('popup') || message.includes('dialog')) {
    return REPAIR_PROPOSAL_TYPE.INTERRUPTION_RULE
  }
  return REPAIR_PROPOSAL_TYPE.DIAGNOSTIC_NOTE
}

function actionForType(type) {
  if (type === REPAIR_PROPOSAL_TYPE.SELECTOR_UPDATE) {
    return 'Review current PageModel fields/clickables and propose a safer selector candidate.'
  }
  if (type === REPAIR_PROPOSAL_TYPE.WAIT_OR_RETRY_TUNING) {
    return 'Review timeout/wait condition and propose a more specific readiness signal.'
  }
  if (type === REPAIR_PROPOSAL_TYPE.INTERRUPTION_RULE) {
    return 'Review popup text/buttons and propose a safe interruption rule candidate.'
  }
  if (type === REPAIR_PROPOSAL_TYPE.VERIFICATION_RULE) {
    return 'Review failed shadow verification rule and adjust verifier expectation or page rule.'
  }
  return 'Collect more evidence before proposing an executable repair.'
}

export class RepairProposer {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.platform = options.platform || 'unknown'
    this.taskType = options.taskType || 'publish'
    this.store = options.store || createRepairProposalStore({ config: this.config, flags: this.flags })
    this.traceWriter = options.traceWriter || null
    this.log = options.log || null
  }

  get enabled() {
    return this.flags.repairAgentEnabled === true && this.config.repair?.generateProposals !== false
  }

  proposeFromFailure(failure = {}) {
    if (!this.enabled) return null
    const type = inferFailureType(failure)
    const proposal = createRepairProposal({
      type,
      source: 'failure',
      platform: failure.platform || this.platform,
      taskType: failure.taskType || this.taskType,
      stepName: failure.stepName || 'unknown',
      reason: failure.errorMessage || failure.error?.message || 'step_failed',
      confidence: type === REPAIR_PROPOSAL_TYPE.DIAGNOSTIC_NOTE ? 0.35 : 0.55,
      suggestedAction: actionForType(type),
      sourceFailureId: failure.failureId || null,
      pageFingerprint: failure.pageFingerprint || null,
      metadata: {
        errorCode: failure.errorCode || null,
        artifactIds: Array.isArray(failure.artifactIds) ? failure.artifactIds : [],
        pageSummary: failure.pageSummary || null
      }
    })
    return this._record(proposal)
  }

  proposeFromVerification(verification = {}) {
    if (!this.enabled) return null
    const payload = typeof verification?.toJSON === 'function' ? verification.toJSON() : verification
    const failedRules = Array.isArray(payload.ruleResults)
      ? payload.ruleResults.filter(rule => rule.passed !== true)
      : []
    if (failedRules.length === 0) return null
    const proposal = createRepairProposal({
      type: REPAIR_PROPOSAL_TYPE.VERIFICATION_RULE,
      source: 'shadow_verification',
      platform: payload.metadata?.platform || this.platform,
      taskType: this.taskType,
      stepName: payload.stepName || 'unknown',
      reason: payload.summary || 'shadow_verification_failed',
      confidence: 0.5,
      suggestedAction: actionForType(REPAIR_PROPOSAL_TYPE.VERIFICATION_RULE),
      sourceVerificationId: payload.verifierId || null,
      pageFingerprint: payload.pageFingerprint || null,
      metadata: {
        status: payload.status || null,
        failedRules
      }
    })
    return this._record(proposal)
  }

  _record(proposal) {
    try {
      const record = this.store.record(proposal)
      if (!record) return null
      this.traceWriter?.addEvent?.('repair_proposal_recorded', record)
      return record
    } catch (err) {
      this.log?.debug?.(`[RepairProposer] proposal skipped: ${err.message}`)
      return null
    }
  }
}

export function createRepairProposer(options = {}) {
  return new RepairProposer(options)
}
