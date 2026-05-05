import { createFingerprint, normalizeUrlPath } from './fingerprint.js'

export class PageModel {
  constructor(raw = {}) {
    this.url = raw.url || ''
    this.urlPath = raw.urlPath || normalizeUrlPath(this.url)
    this.title = raw.title || ''
    this.headings = Array.isArray(raw.headings) ? raw.headings : []
    this.keyTexts = Array.isArray(raw.keyTexts) ? raw.keyTexts : []
    this.clickables = Array.isArray(raw.clickables) ? raw.clickables : []
    this.fields = Array.isArray(raw.fields) ? raw.fields : []
    this.forms = Array.isArray(raw.forms) ? raw.forms : []
    this.dialogs = Array.isArray(raw.dialogs) ? raw.dialogs : []
    this.counts = raw.counts || {}
    this.observedAt = raw.observedAt || new Date().toISOString()
    this.fingerprint = raw.fingerprint || createFingerprint({
      urlPath: this.urlPath,
      title: this.title,
      headings: this.headings,
      clickableTexts: this.clickables.map(item => item.text || item.label || ''),
      fieldHints: this.fields.map(item => item.placeholder || item.label || item.name || ''),
      hasDialog: this.dialogs.length > 0,
      formCount: this.counts.forms || this.forms.length,
      inputCount: this.counts.inputs || this.fields.length,
      buttonCount: this.counts.buttons || this.clickables.length
    })
  }

  toJSON() {
    return {
      url: this.url,
      urlPath: this.urlPath,
      title: this.title,
      headings: this.headings,
      keyTexts: this.keyTexts,
      clickables: this.clickables,
      fields: this.fields,
      forms: this.forms,
      dialogs: this.dialogs,
      counts: this.counts,
      fingerprint: this.fingerprint,
      observedAt: this.observedAt
    }
  }

  summary() {
    return {
      urlPath: this.urlPath,
      title: this.title,
      fingerprint: this.fingerprint,
      hasDialog: this.dialogs.length > 0,
      clickableCount: this.clickables.length,
      fieldCount: this.fields.length
    }
  }
}

export function createPageModel(raw = {}) {
  return new PageModel(raw)
}
