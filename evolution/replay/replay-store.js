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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class ReplayStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.replayEnabled === true && this.config.replay?.writeCases !== false
  }

  get replayDir() {
    return path.resolve(this.config.dataDir, 'replay')
  }

  caseFile(caseId) {
    return path.join(this.replayDir, 'cases', `${safeName(caseId)}.json`)
  }

  resultFile(runId) {
    return path.join(this.replayDir, 'results', `${safeName(runId)}.json`)
  }

  saveCase(replayCase) {
    if (!this.enabled) return null
    const payload = typeof replayCase?.toJSON === 'function' ? replayCase.toJSON() : replayCase
    writeJsonAtomic(this.caseFile(payload.caseId), payload)
    return payload
  }

  readCase(caseId) {
    return readJson(this.caseFile(caseId))
  }

  saveResult(result) {
    if (!this.flags.replayEnabled || this.config.replay?.writeResults === false) return null
    writeJsonAtomic(this.resultFile(result.runId), result)
    return result
  }
}

export function createReplayStore(options = {}) {
  return new ReplayStore(options)
}
