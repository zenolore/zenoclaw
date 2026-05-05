export class InterruptionRules {
  constructor(initialRules = []) {
    this._rules = Array.isArray(initialRules) ? [...initialRules] : []
  }

  add(rule) {
    if (!rule?.ruleId) return false
    const existingIndex = this._rules.findIndex(item => item.ruleId === rule.ruleId)
    if (existingIndex >= 0) {
      this._rules[existingIndex] = { ...this._rules[existingIndex], ...rule }
    } else {
      this._rules.push({ ...rule })
    }
    return true
  }

  match(detection, context = {}) {
    if (!detection?.hasInterruption) return null
    const platform = context.platform || detection.platform || 'unknown'
    const text = `${detection.text || ''} ${detection.buttonText || ''}`.toLowerCase()

    return this._rules.find(rule => {
      if (rule.status && rule.status !== 'active') return false
      if (rule.platform && rule.platform !== platform) return false
      if (rule.type && rule.type !== detection.popupType) return false
      if (Array.isArray(rule.matchText) && rule.matchText.length > 0) {
        return rule.matchText.some(item => text.includes(String(item).toLowerCase()))
      }
      return true
    }) || null
  }

  values() {
    return [...this._rules]
  }
}

export function createInterruptionRules(initialRules = []) {
  return new InterruptionRules(initialRules)
}
