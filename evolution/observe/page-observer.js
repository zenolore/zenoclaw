import { createPageModel } from './page-model.js'

function trimList(list, max) {
  return Array.isArray(list) ? list.slice(0, max) : []
}

export class PageObserver {
  constructor(options = {}) {
    this.page = options.page || null
    this.maxTexts = options.maxTexts || 80
    this.maxClickables = options.maxClickables || 80
    this.maxFields = options.maxFields || 60
  }

  async observe() {
    if (!this.page || typeof this.page.evaluate !== 'function') {
      return createPageModel({})
    }

    const raw = await this.page.evaluate((limits) => {
      function isVisible(el) {
        if (!el) return false
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && rect.width > 0
          && rect.height > 0
      }

      function textOf(el) {
        return (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
      }

      function rectOf(el) {
        const rect = el.getBoundingClientRect()
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }

      const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
        .filter(isVisible)
        .map(textOf)
        .filter(Boolean)
        .slice(0, 20)

      const keyTexts = Array.from(document.querySelectorAll('main,section,article,form,[role="main"],body'))
        .flatMap(el => Array.from(el.children || []))
        .filter(isVisible)
        .map(textOf)
        .filter(text => text.length >= 2 && text.length <= 160)
        .slice(0, limits.maxTexts)

      const clickables = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]'))
        .filter(isVisible)
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          text: textOf(el).slice(0, 120),
          type: el.getAttribute('type') || '',
          testId: el.getAttribute('data-testid') || '',
          rect: rectOf(el)
        }))
        .filter(item => item.text || item.testId || item.type)
        .slice(0, limits.maxClickables)

      const fields = Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]'))
        .filter(isVisible)
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          placeholder: el.getAttribute('placeholder') || '',
          label: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          contenteditable: el.getAttribute('contenteditable') || '',
          rect: rectOf(el)
        }))
        .slice(0, limits.maxFields)

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.dialog,.overlay,.mask,[class*="modal" i],[class*="dialog" i]'))
        .filter(isVisible)
        .map(el => ({
          text: textOf(el).slice(0, 300),
          rect: rectOf(el)
        }))
        .slice(0, 10)

      return {
        url: window.location.href,
        title: document.title || '',
        headings,
        keyTexts,
        clickables,
        fields,
        forms: Array.from(document.querySelectorAll('form')).filter(isVisible).map(rectOf).slice(0, 20),
        dialogs,
        counts: {
          buttons: clickables.length,
          inputs: fields.length,
          forms: document.querySelectorAll('form').length,
          dialogs: dialogs.length
        }
      }
    }, {
      maxTexts: this.maxTexts,
      maxClickables: this.maxClickables,
      maxFields: this.maxFields
    }).catch((err) => ({ error: err.message }))

    return createPageModel(raw)
  }
}

export function createPageObserver(options = {}) {
  return new PageObserver(options)
}
