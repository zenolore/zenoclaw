import fs from 'fs'
import path from 'path'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath))
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath))
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

function safeId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class RollbackStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.rollbackEnabled === true && this.config.rollback?.writePlans !== false
  }

  get rollbackDir() {
    return path.resolve(this.config.dataDir, 'rollback')
  }

  planFile(rollbackId) {
    return path.join(this.rollbackDir, 'plans', `${safeId(rollbackId)}.json`)
  }

  get historyFile() {
    return path.join(this.rollbackDir, 'history.jsonl')
  }

  record(plan) {
    if (!this.enabled) return null
    const payload = typeof plan?.toJSON === 'function' ? plan.toJSON() : plan
    const safePayload = {
      ...payload,
      guardrails: {
        ...(payload.guardrails || {}),
        executeAutomatically: false,
        changesExecutionPath: false,
        requiresHumanReview: true
      }
    }
    writeJsonAtomic(this.planFile(safePayload.rollbackId), safePayload)
    appendJsonLine(this.historyFile, safePayload)
    return safePayload
  }
}

export function createRollbackStore(options = {}) {
  return new RollbackStore(options)
}
