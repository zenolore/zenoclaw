import fs from 'fs'
import path from 'path'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'

function nowIso() {
  return new Date().toISOString()
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

export class StrategyRegistry {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.ruleMemoryEnabled === true && this.config.memory?.writeStrategies !== false
  }

  get registryFile() {
    return path.resolve(this.config.dataDir, 'memory', 'strategy-registry.json')
  }

  read() {
    if (!fs.existsSync(this.registryFile)) {
      return { strategies: [], updatedAt: null }
    }
    return JSON.parse(fs.readFileSync(this.registryFile, 'utf-8'))
  }

  register(strategy = {}) {
    if (!this.enabled) return null
    const current = this.read()
    const strategyId = strategy.strategyId || `${strategy.platform || 'unknown'}_${strategy.stepName || 'unknown'}_${strategy.type || 'generic'}`
    const record = {
      strategyId,
      status: strategy.status || 'candidate',
      platform: strategy.platform || 'unknown',
      stepName: strategy.stepName || 'unknown',
      type: strategy.type || 'generic',
      ruleIds: Array.isArray(strategy.ruleIds) ? strategy.ruleIds : [],
      successCount: Number(strategy.successCount || 0),
      failureCount: Number(strategy.failureCount || 0),
      confidence: Number(strategy.confidence || 0),
      metadata: strategy.metadata || {},
      updatedAt: nowIso(),
      createdAt: strategy.createdAt || nowIso()
    }
    const existingIndex = current.strategies.findIndex(item => item.strategyId === strategyId)
    const strategies = [...current.strategies]
    if (existingIndex >= 0) {
      strategies[existingIndex] = { ...strategies[existingIndex], ...record, createdAt: strategies[existingIndex].createdAt }
    } else {
      strategies.push(record)
    }
    const next = { strategies, updatedAt: nowIso() }
    writeJsonAtomic(this.registryFile, next)
    return record
  }
}

export function createStrategyRegistry(options = {}) {
  return new StrategyRegistry(options)
}
