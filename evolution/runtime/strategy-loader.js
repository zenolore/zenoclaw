import fs from 'fs'
import path from 'path'
import { normalizeEvolutionConfig } from './evolution-config.js'
import { getFeatureFlags } from './feature-flags.js'

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function normalizeRule(strategy = {}) {
  const metadata = strategy.metadata || {}
  const rule = metadata.rule || metadata.interruptionRule || strategy.rule || null
  if (rule?.ruleId) return rule
  if (strategy.type !== 'interruption_rule' && strategy.type !== 'popup_rule') return null
  return {
    ruleId: strategy.strategyId || `${strategy.platform || 'unknown'}_${strategy.stepName || 'unknown'}_popup_rule`,
    status: strategy.status || 'active',
    platform: strategy.platform || 'unknown',
    type: metadata.popupType || metadata.type || undefined,
    matchText: Array.isArray(metadata.matchText) ? metadata.matchText : [],
    action: metadata.action || null,
    metadata
  }
}

export class StrategyLoader {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.platform = options.platform || 'unknown'
  }

  get registryFile() {
    return path.resolve(this.config.dataDir, 'memory', 'strategy-registry.json')
  }

  get canReadRules() {
    return this.flags.ruleMemoryEnabled === true && this.config.memory?.readRules === true
  }

  loadActiveInterruptionRules() {
    if (!this.canReadRules) return []
    const registry = readJson(this.registryFile, { strategies: [] })
    return (Array.isArray(registry.strategies) ? registry.strategies : [])
      .filter(strategy => strategy.status === 'active')
      .filter(strategy => !strategy.platform || strategy.platform === this.platform)
      .map(normalizeRule)
      .filter(Boolean)
  }
}

export function createStrategyLoader(options = {}) {
  return new StrategyLoader(options)
}
