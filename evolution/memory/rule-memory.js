import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createRuleVersionStore } from './rule-version-store.js'

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

export class RuleMemory {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.platform = options.platform || 'unknown'
    this.versionStore = options.versionStore || createRuleVersionStore({
      config: this.config,
      flags: this.flags
    })
  }

  get enabled() {
    return this.flags.ruleMemoryEnabled === true && this.config.memory?.writeCandidateRules !== false
  }

  get candidateFile() {
    return path.resolve(this.config.dataDir, 'memory', 'candidate-rules.jsonl')
  }

  proposeRule(rule = {}) {
    if (!this.enabled) return null
    const record = {
      ruleId: rule.ruleId || makeId('rule'),
      status: rule.status || 'candidate',
      platform: rule.platform || this.platform,
      type: rule.type || 'unknown',
      selector: rule.selector || null,
      matchText: Array.isArray(rule.matchText) ? rule.matchText : [],
      action: rule.action || null,
      buttonText: rule.buttonText || null,
      confidence: Number(rule.confidence || 0),
      reason: rule.reason || '',
      sourceFailureId: rule.sourceFailureId || null,
      pageFingerprint: rule.pageFingerprint || null,
      metadata: rule.metadata || {},
      createdAt: rule.createdAt || nowIso()
    }
    appendJsonLine(this.candidateFile, record)
    const version = this.versionStore.addVersion(record)
    return { ...record, version: version?.version || null }
  }
}

export function createRuleMemory(options = {}) {
  return new RuleMemory(options)
}
