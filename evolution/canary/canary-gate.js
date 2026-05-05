import { normalizeEvolutionConfig, EVOLUTION_MODES } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createCanaryDecision, CANARY_DECISION_STATUS } from './canary-decision.js'

const HIGH_RISK_ACTIONS = new Set([
  'publish',
  'delete',
  'submit',
  'confirm',
  'applyPatch',
  'promoteRule'
])

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function isListed(list, value) {
  if (!list.length) return false
  return list.includes(value) || list.includes('*')
}

function hashToUnit(value) {
  let hash = 0
  const text = String(value || '')
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash) / 2147483647
}

function clampRate(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export class CanaryGate {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.random = options.random || Math.random
  }

  get enabled() {
    return this.flags.canaryEnabled === true
  }

  decide(context = {}) {
    const base = {
      mode: this.config.mode,
      platform: context.platform || 'unknown',
      taskType: context.taskType || 'unknown',
      stepName: context.stepName || null,
      metadata: context.metadata || {}
    }

    if (!this.enabled) {
      return createCanaryDecision({
        ...base,
        status: CANARY_DECISION_STATUS.SKIP,
        reason: 'canary_disabled',
        riskLevel: 'none',
        sampleRate: 0
      })
    }

    if (this.config.mode !== EVOLUTION_MODES.CANARY && this.config.mode !== EVOLUTION_MODES.ACTIVE) {
      return createCanaryDecision({
        ...base,
        status: CANARY_DECISION_STATUS.BLOCK,
        reason: 'invalid_canary_mode',
        riskLevel: 'high',
        sampleRate: 0
      })
    }

    const canary = this.config.canary || {}
    const action = context.action || context.stepName || ''
    const blockedPlatforms = normalizeList(canary.blockedPlatforms)
    const allowedPlatforms = normalizeList(canary.allowedPlatforms)
    const highRiskActions = new Set([...HIGH_RISK_ACTIONS, ...normalizeList(canary.highRiskActions)])
    const sampleRate = clampRate(canary.sampleRate)
    const matchedRules = []

    if (isListed(blockedPlatforms, base.platform)) {
      matchedRules.push('blocked_platform')
      return createCanaryDecision({ ...base, status: CANARY_DECISION_STATUS.BLOCK, reason: 'blocked_platform', riskLevel: 'high', sampleRate, matchedRules })
    }

    if (allowedPlatforms.length && !isListed(allowedPlatforms, base.platform)) {
      matchedRules.push('platform_not_allowed')
      return createCanaryDecision({ ...base, status: CANARY_DECISION_STATUS.BLOCK, reason: 'platform_not_allowed', riskLevel: 'medium', sampleRate, matchedRules })
    }

    if (canary.blockHighRiskActions !== false && highRiskActions.has(action)) {
      matchedRules.push('high_risk_action')
      return createCanaryDecision({ ...base, status: CANARY_DECISION_STATUS.BLOCK, reason: 'high_risk_action', riskLevel: 'high', sampleRate, matchedRules })
    }

    const sampleKey = context.sampleKey || `${base.platform}:${base.taskType}:${base.stepName || action}`
    const unit = canary.deterministicSampling === false ? this.random() : hashToUnit(sampleKey)
    if (unit > sampleRate) {
      matchedRules.push('sampled_out')
      return createCanaryDecision({ ...base, status: CANARY_DECISION_STATUS.SKIP, reason: 'sampled_out', riskLevel: 'low', sampleRate, matchedRules, metadata: { ...base.metadata, sampleUnit: unit } })
    }

    matchedRules.push('sampled_in')
    return createCanaryDecision({ ...base, status: CANARY_DECISION_STATUS.ALLOW, reason: 'sampled_in', riskLevel: 'low', sampleRate, matchedRules, metadata: { ...base.metadata, sampleUnit: unit } })
  }
}

export function createCanaryGate(options = {}) {
  return new CanaryGate(options)
}
