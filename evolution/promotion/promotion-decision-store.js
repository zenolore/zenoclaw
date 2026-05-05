import fs from 'fs'
import path from 'path'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

export class PromotionDecisionStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.promotionGateEnabled === true && this.config.promotion?.writeDecisions !== false
  }

  get decisionFile() {
    return path.resolve(this.config.dataDir, 'promotion', 'decisions.jsonl')
  }

  record(decision) {
    if (!this.enabled) return null
    const payload = typeof decision?.toJSON === 'function' ? decision.toJSON() : decision
    const safePayload = {
      ...payload,
      guardrails: {
        ...(payload.guardrails || {}),
        applyAutomatically: false,
        changesExecutionPath: false
      }
    }
    appendJsonLine(this.decisionFile, safePayload)
    return safePayload
  }
}

export function createPromotionDecisionStore(options = {}) {
  return new PromotionDecisionStore(options)
}
