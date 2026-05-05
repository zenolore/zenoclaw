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

function safeId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class MetricsStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.metricsEnabled === true && this.config.metrics?.writeReports !== false
  }

  get metricsDir() {
    return path.resolve(this.config.dataDir, 'metrics')
  }

  reportFile(reportId) {
    return path.join(this.metricsDir, 'reports', `${safeId(reportId)}.json`)
  }

  save(report) {
    if (!this.enabled) return null
    const payload = typeof report?.toJSON === 'function' ? report.toJSON() : report
    const safePayload = {
      ...payload,
      guardrails: {
        ...(payload.guardrails || {}),
        changesExecutionPath: false,
        metricsOnly: true
      }
    }
    writeJsonAtomic(this.reportFile(safePayload.reportId), safePayload)
    writeJsonAtomic(path.join(this.metricsDir, 'latest.json'), safePayload)
    return safePayload
  }
}

export function createMetricsStore(options = {}) {
  return new MetricsStore(options)
}
