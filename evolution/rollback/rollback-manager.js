import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createRollbackPlan } from './rollback-plan.js'
import { createRollbackStore } from './rollback-store.js'

function buildSteps(input = {}) {
  const targetType = input.targetType || 'unknown'
  const targetId = input.targetId || 'unknown'
  const previousVersion = input.previousVersion || 'previous'
  return [
    { order: 1, action: 'locate_current_target', targetType, targetId },
    { order: 2, action: 'verify_previous_version_available', targetType, targetId, previousVersion },
    { order: 3, action: 'prepare_manual_restore', targetType, targetId, previousVersion },
    { order: 4, action: 'require_human_confirmation', targetType, targetId }
  ]
}

export class RollbackManager {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.store = options.store || createRollbackStore({ config: this.config, flags: this.flags })
  }

  get enabled() {
    return this.flags.rollbackEnabled === true
  }

  plan(input = {}) {
    if (!this.enabled) return null
    const plan = createRollbackPlan({
      targetType: input.targetType || 'unknown',
      targetId: input.targetId || null,
      platform: input.platform || 'unknown',
      currentVersion: input.currentVersion || null,
      previousVersion: input.previousVersion || null,
      reason: input.reason || 'manual_rollback_requested',
      steps: input.steps || buildSteps(input),
      evidenceRefs: input.evidenceRefs || [],
      metadata: input.metadata || {}
    })
    return this.store.record(plan)
  }

  execute() {
    throw new Error('rollback_execute_not_supported_without_human_review')
  }
}

export function createRollbackManager(options = {}) {
  return new RollbackManager(options)
}
