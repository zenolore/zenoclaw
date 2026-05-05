import crypto from 'crypto'

function normalizeText(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '<date>')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, '<time>')
    .replace(/\b\d+\b/g, '<num>')
    .trim()
    .slice(0, 500)
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function createFingerprint(input = {}) {
  const stableInput = {
    urlPath: input.urlPath || '',
    title: normalizeText(input.title || ''),
    headings: (input.headings || []).map(normalizeText).slice(0, 10),
    clickableTexts: (input.clickableTexts || []).map(normalizeText).filter(Boolean).slice(0, 30).sort(),
    fieldHints: (input.fieldHints || []).map(normalizeText).filter(Boolean).slice(0, 30).sort(),
    hasDialog: input.hasDialog === true,
    formCount: Number(input.formCount || 0),
    inputCount: Number(input.inputCount || 0),
    buttonCount: Number(input.buttonCount || 0)
  }

  return crypto
    .createHash('sha256')
    .update(stableJson(stableInput))
    .digest('hex')
    .slice(0, 24)
}

export function normalizeUrlPath(url = '') {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/\d+(?=\/|$)/g, '/<num>')
  } catch {
    return String(url).split('?')[0].replace(/\/\d+(?=\/|$)/g, '/<num>')
  }
}
