import { VERIFICATION_STATUS } from './verification-result.js'

function includesText(source = [], expected = '') {
  const needle = String(expected || '').trim().toLowerCase()
  if (!needle) return true
  return source.some(item => String(item || '').toLowerCase().includes(needle))
}

function pageTexts(model) {
  return [
    model?.title,
    ...(model?.headings || []),
    ...(model?.keyTexts || []),
    ...(model?.clickables || []).map(item => item.text || ''),
    ...(model?.fields || []).map(item => `${item.placeholder || ''} ${item.label || ''} ${item.name || ''}`)
  ].filter(Boolean)
}

export function evaluateRule(rule = {}, model = {}) {
  const type = rule.type || 'unknown'
  const severity = rule.severity || 'warn'
  let passed = true
  let details = ''

  if (type === 'text_present') {
    passed = includesText(pageTexts(model), rule.text)
    details = passed ? `text_present:${rule.text}` : `missing_text:${rule.text}`
  } else if (type === 'field_present') {
    const fields = model.fields || []
    passed = fields.some(field => includesText([field.placeholder, field.label, field.name, field.role], rule.text))
    details = passed ? `field_present:${rule.text}` : `missing_field:${rule.text}`
  } else if (type === 'button_present') {
    const clickables = model.clickables || []
    passed = clickables.some(item => includesText([item.text, item.testId, item.type], rule.text))
    details = passed ? `button_present:${rule.text}` : `missing_button:${rule.text}`
  } else if (type === 'no_dialog') {
    passed = (model.dialogs || []).length === 0
    details = passed ? 'no_dialog' : 'dialog_present'
  } else if (type === 'fingerprint_changed') {
    passed = rule.previousFingerprint ? model.fingerprint !== rule.previousFingerprint : true
    details = passed ? 'fingerprint_changed_or_unset' : 'fingerprint_unchanged'
  } else {
    passed = true
    details = `unknown_rule_skipped:${type}`
  }

  return {
    ruleId: rule.ruleId || `${type}:${rule.text || ''}`,
    type,
    severity,
    passed,
    status: passed ? VERIFICATION_STATUS.PASS : (severity === 'error' ? VERIFICATION_STATUS.FAIL : VERIFICATION_STATUS.WARN),
    details
  }
}

export function evaluateRules(rules = [], model = {}) {
  return rules.map(rule => evaluateRule(rule, model))
}
