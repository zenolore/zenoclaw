import crypto from 'crypto'
import { normalizeUrlPath } from '../observe/fingerprint.js'

function normalizeText(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '<date>')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, '<time>')
    .replace(/\b\d+\b/g, '<num>')
    .trim()
    .toLowerCase()
    .slice(0, 500)
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function normalizePopupText(value = '') {
  return normalizeText(value)
}

export function createPopupFingerprint(input = {}) {
  const stableInput = {
    platform: input.platform || 'unknown',
    stepName: input.stepName || '',
    urlPath: normalizeUrlPath(input.url || input.urlPath || ''),
    popupType: normalizeText(input.popupType || ''),
    text: normalizeText(input.text || ''),
    buttonText: normalizeText(input.buttonText || ''),
    source: input.source || 'unknown'
  }
  return crypto
    .createHash('sha256')
    .update(stableJson(stableInput))
    .digest('hex')
    .slice(0, 24)
}
