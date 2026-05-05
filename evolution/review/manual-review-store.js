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

export class ManualReviewStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.manualReviewEnabled === true && this.config.review?.writeReviews !== false
  }

  get queueFile() {
    return path.resolve(this.config.dataDir, 'review', 'queue.json')
  }

  get historyFile() {
    return path.resolve(this.config.dataDir, 'review', 'history.jsonl')
  }

  readQueue() {
    if (!fs.existsSync(this.queueFile)) return { reviews: [], updatedAt: null }
    return JSON.parse(fs.readFileSync(this.queueFile, 'utf-8'))
  }

  upsert(record) {
    if (!this.enabled) return null
    const payload = typeof record?.toJSON === 'function' ? record.toJSON() : record
    const current = this.readQueue()
    const reviews = [...current.reviews]
    const index = reviews.findIndex(item => item.reviewId === payload.reviewId)
    if (index >= 0) reviews[index] = { ...reviews[index], ...payload }
    else reviews.push(payload)
    writeJsonAtomic(this.queueFile, { reviews, updatedAt: new Date().toISOString() })
    appendJsonLine(this.historyFile, payload)
    return payload
  }
}

export function createManualReviewStore(options = {}) {
  return new ManualReviewStore(options)
}
