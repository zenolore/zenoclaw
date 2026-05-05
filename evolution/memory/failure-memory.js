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

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

export class FailureMemory {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.platform = options.platform || 'unknown'
    this.taskType = options.taskType || 'unknown'
  }

  get enabled() {
    return this.flags.ruleMemoryEnabled === true && this.config.memory?.writeFailures !== false
  }

  get failureFile() {
    return path.resolve(this.config.dataDir, 'memory', 'failures.jsonl')
  }

  recordFailure(failure = {}) {
    if (!this.enabled) return null
    const record = {
      failureId: failure.failureId || makeId('failure'),
      traceId: failure.traceId || null,
      stepId: failure.stepId || null,
      platform: failure.platform || this.platform,
      taskType: failure.taskType || this.taskType,
      stepName: failure.stepName || 'unknown',
      errorCode: failure.errorCode || null,
      errorMessage: failure.errorMessage || failure.error?.message || String(failure.error || ''),
      pageFingerprint: failure.pageFingerprint || null,
      pageSummary: failure.pageSummary || null,
      interruption: failure.interruption || null,
      artifactIds: Array.isArray(failure.artifactIds) ? failure.artifactIds : [],
      metadata: failure.metadata || {},
      createdAt: failure.createdAt || nowIso()
    }
    appendJsonLine(this.failureFile, record)
    return record
  }
}

export function createFailureMemory(options = {}) {
  return new FailureMemory(options)
}
