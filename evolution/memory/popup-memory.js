import fs from 'fs'
import path from 'path'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createPopupFingerprint } from './popup-fingerprint.js'

function nowIso() {
  return new Date().toISOString()
}

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

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

export class PopupMemory {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.platform = options.platform || 'unknown'
    this.taskType = options.taskType || 'publish'
  }

  get enabled() {
    return this.flags.ruleMemoryEnabled === true && this.config.memory?.writePopupMemory !== false
  }

  get recurrentThreshold() {
    return Number(this.config.memory?.recurrentPopupThreshold || 3)
  }

  get sightingsFile() {
    return path.resolve(this.config.dataDir, 'memory', 'popup-sightings.jsonl')
  }

  get aggregateFile() {
    return path.resolve(this.config.dataDir, 'memory', 'popup-memory.json')
  }

  read() {
    return readJson(this.aggregateFile, { popups: [], updatedAt: null })
  }

  record(detection = {}, context = {}) {
    if (!this.enabled || detection?.hasInterruption !== true) return null
    const popupFingerprint = detection.popupFingerprint || createPopupFingerprint({
      platform: detection.platform || context.platform || this.platform,
      stepName: context.stepName || detection.stepName || '',
      url: context.url || detection.url || '',
      urlPath: context.urlPath || detection.urlPath || '',
      popupType: detection.popupType || '',
      text: detection.text || '',
      buttonText: detection.buttonText || '',
      source: detection.source || 'dom'
    })
    const record = {
      popupFingerprint,
      platform: detection.platform || context.platform || this.platform,
      taskType: context.taskType || this.taskType,
      stepName: context.stepName || detection.stepName || 'unknown',
      source: detection.source || 'dom',
      popupType: detection.popupType || 'unknown_popup',
      text: detection.text || '',
      buttonText: detection.buttonText || '',
      action: detection.action || null,
      buttonX: Number(detection.buttonX || 0),
      buttonY: Number(detection.buttonY || 0),
      handled: context.handled === true,
      reason: context.reason || detection.reason || null,
      createdAt: nowIso()
    }
    appendJsonLine(this.sightingsFile, record)
    const current = this.read()
    const existingIndex = current.popups.findIndex(item => item.popupFingerprint === popupFingerprint)
    const previous = existingIndex >= 0 ? current.popups[existingIndex] : null
    const count = Number(previous?.count || 0) + 1
    const handledCount = Number(previous?.handledCount || 0) + (record.handled ? 1 : 0)
    const firstSeenAt = previous?.firstSeenAt || record.createdAt
    const next = {
      popupFingerprint,
      platform: record.platform,
      taskType: record.taskType,
      stepName: record.stepName,
      source: record.source,
      popupType: record.popupType,
      text: record.text,
      buttonText: record.buttonText,
      action: record.action,
      count,
      handledCount,
      status: count >= this.recurrentThreshold ? 'recurrent' : 'transient',
      candidateEligible: count >= this.recurrentThreshold && handledCount > 0,
      firstSeenAt,
      lastSeenAt: record.createdAt
    }
    const popups = [...current.popups]
    if (existingIndex >= 0) {
      popups[existingIndex] = { ...previous, ...next, firstSeenAt }
    } else {
      popups.push(next)
    }
    writeJsonAtomic(this.aggregateFile, { popups, updatedAt: nowIso() })
    return { ...record, aggregate: next }
  }
}

export function createPopupMemory(options = {}) {
  return new PopupMemory(options)
}
