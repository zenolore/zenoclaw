import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath))
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

function safeRuleId(ruleId) {
  return String(ruleId || makeId('rule')).replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class RuleVersionStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.ruleMemoryEnabled === true
  }

  get versionsDir() {
    return path.resolve(this.config.dataDir, 'memory', 'rule-versions')
  }

  versionFile(ruleId) {
    return path.join(this.versionsDir, `${safeRuleId(ruleId)}.json`)
  }

  read(ruleId) {
    const filePath = this.versionFile(ruleId)
    if (!fs.existsSync(filePath)) {
      return { ruleId: safeRuleId(ruleId), versions: [] }
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  }

  addVersion(rule = {}) {
    if (!this.enabled) return null
    const ruleId = safeRuleId(rule.ruleId)
    const current = this.read(ruleId)
    const version = {
      ruleId,
      version: current.versions.length + 1,
      status: rule.status || 'candidate',
      platform: rule.platform || 'unknown',
      type: rule.type || 'unknown',
      selector: rule.selector || null,
      matchText: Array.isArray(rule.matchText) ? rule.matchText : [],
      action: rule.action || null,
      buttonText: rule.buttonText || null,
      confidence: Number(rule.confidence || 0),
      sourceFailureId: rule.sourceFailureId || null,
      pageFingerprint: rule.pageFingerprint || null,
      metadata: rule.metadata || {},
      createdAt: rule.createdAt || nowIso()
    }
    const next = {
      ruleId,
      updatedAt: nowIso(),
      versions: [...current.versions, version]
    }
    writeJsonAtomic(this.versionFile(ruleId), next)
    return version
  }
}

export function createRuleVersionStore(options = {}) {
  return new RuleVersionStore(options)
}
