import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'

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

export class ArtifactRegistry {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.traceId = options.traceId || null
  }

  get registryFile() {
    return path.resolve(this.config.dataDir, 'artifacts', 'artifacts.jsonl')
  }

  register(artifact = {}) {
    const record = {
      artifactId: artifact.artifactId || makeId('artifact'),
      traceId: artifact.traceId || this.traceId || null,
      stepId: artifact.stepId || null,
      platform: artifact.platform || 'unknown',
      taskType: artifact.taskType || 'unknown',
      type: artifact.type || 'unknown',
      filePath: artifact.filePath || null,
      hash: artifact.hash || null,
      createdAt: artifact.createdAt || nowIso(),
      metadata: artifact.metadata || {}
    }
    appendJsonLine(this.registryFile, record)
    return record
  }
}

export function createArtifactRegistry(options = {}) {
  return new ArtifactRegistry(options)
}
