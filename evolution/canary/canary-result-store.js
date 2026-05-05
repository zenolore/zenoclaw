import fs from 'fs'
import path from 'path'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath))
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath))
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

export class CanaryResultStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.canaryResultEnabled === true && this.config.canaryResult?.writeResults !== false
  }

  get canaryDir() {
    return path.resolve(this.config.dataDir, 'canary')
  }

  get historyFile() {
    return path.join(this.canaryDir, 'results.jsonl')
  }

  get latestFile() {
    return path.join(this.canaryDir, 'latest-result.json')
  }

  record(result) {
    if (!this.enabled) return null
    const payload = typeof result?.toJSON === 'function' ? result.toJSON() : result
    const safePayload = {
      ...payload,
      guardrails: {
        ...(payload.guardrails || {}),
        recordOnly: true,
        changesExecutionPath: false,
        authorizesExecution: false
      }
    }
    appendJsonLine(this.historyFile, safePayload)
    writeJsonAtomic(this.latestFile, safePayload)
    return safePayload
  }
}

export function createCanaryResultStore(options = {}) {
  return new CanaryResultStore(options)
}
