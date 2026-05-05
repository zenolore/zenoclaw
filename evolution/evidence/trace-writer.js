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

export class TraceWriter {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.traceId = options.traceId || makeId('trace')
    this.platform = options.platform || 'unknown'
    this.taskType = options.taskType || 'unknown'
    this.startedAt = options.startedAt || nowIso()
    this.steps = []
    this.events = []
    this._stepSeq = 0
    this._closed = false
  }

  get enabled() {
    return this.flags.traceEnabled === true || this.flags.evidenceEnabled === true
  }

  get traceDir() {
    return path.resolve(this.config.dataDir, 'traces', this.traceId)
  }

  get traceFile() {
    return path.join(this.traceDir, 'trace.json')
  }

  startStep(stepName, extra = {}) {
    const step = {
      traceId: this.traceId,
      stepId: `step_${String(++this._stepSeq).padStart(3, '0')}`,
      platform: this.platform,
      taskType: this.taskType,
      stepName,
      status: 'running',
      startedAt: nowIso(),
      finishedAt: null,
      elapsedMs: 0,
      errorCode: null,
      errorMessage: null,
      evidence: [],
      ...extra
    }
    this.steps.push(step)
    return step
  }

  finishStep(step, status = 'success', extra = {}) {
    if (!step) return null
    const finishedAt = nowIso()
    step.status = status
    step.finishedAt = finishedAt
    step.elapsedMs = new Date(finishedAt).getTime() - new Date(step.startedAt).getTime()
    Object.assign(step, extra)
    return step
  }

  failStep(step, error, extra = {}) {
    return this.finishStep(step, 'failed', {
      errorCode: error?.code || extra.errorCode || null,
      errorMessage: error?.message || String(error || 'unknown error'),
      ...extra
    })
  }

  addEvidence(step, key, value) {
    if (!step) return null
    const item = { key, value, at: nowIso() }
    step.evidence.push(item)
    return item
  }

  addEvent(event, payload = {}) {
    const item = {
      traceId: this.traceId,
      event,
      at: nowIso(),
      ...payload
    }
    this.events.push(item)
    return item
  }

  snapshot() {
    return {
      traceId: this.traceId,
      platform: this.platform,
      taskType: this.taskType,
      mode: this.config.mode,
      evidenceLevel: this.flags.evidenceLevel,
      startedAt: this.startedAt,
      updatedAt: nowIso(),
      steps: this.steps,
      events: this.events
    }
  }

  flush() {
    if (!this.enabled || this._closed) return false
    writeJsonAtomic(this.traceFile, this.snapshot())
    return true
  }

  close() {
    const result = this.flush()
    this._closed = true
    return result
  }
}

export function createTraceWriter(options = {}) {
  return new TraceWriter(options)
}
