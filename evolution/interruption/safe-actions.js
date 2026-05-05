export const SAFE_BUTTON_TEXTS = Object.freeze([
  '关闭', '取消', '我知道了', '知道了', '稍后再说', '跳过', '完成', '关闭提示', '不再提示', '×', 'x', 'close', 'cancel', 'skip', 'done', 'got it', 'not now'
])

export const CONDITIONAL_BUTTON_TEXTS = Object.freeze([
  '下一步', '继续', '确认', '确定', '同意', 'next', 'continue', 'ok', 'confirm', 'agree'
])

export const HIGH_RISK_BUTTON_TEXTS = Object.freeze([
  '发布', '提交', '删除', '退出登录', '取消发布', '永久删除', '授权登录', '扫码登录', '支付', '充值', 'publish', 'submit', 'delete', 'logout', 'sign out', 'pay', 'recharge', 'authorize'
])

function normalizeText(text = '') {
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ')
}

function includesAny(text, list) {
  const normalized = normalizeText(text)
  if (!normalized) return false
  return list.some(item => normalized.includes(normalizeText(item)))
}

export function classifyActionText(text, context = {}) {
  if (includesAny(text, HIGH_RISK_BUTTON_TEXTS)) {
    return { allowed: false, risk: 'high', reason: 'high_risk_button' }
  }

  if (includesAny(text, SAFE_BUTTON_TEXTS)) {
    return { allowed: true, risk: 'low', reason: 'safe_button' }
  }

  if (includesAny(text, CONDITIONAL_BUTTON_TEXTS)) {
    const popupType = context.popupType || context.interruptionType || 'unknown_popup'
    const stepName = context.stepName || ''
    const allowPublishConfirm = popupType === 'publish_confirm' && /publish|submit/i.test(stepName)
    const allowTutorial = popupType === 'tutorial_guide' || popupType === 'update_notice'

    if (allowPublishConfirm || allowTutorial) {
      return { allowed: true, risk: 'medium', reason: 'conditional_allowed' }
    }

    return { allowed: false, risk: 'medium', reason: 'conditional_blocked' }
  }

  return { allowed: false, risk: 'unknown', reason: 'unknown_button' }
}

export function isSafeActionText(text, context = {}) {
  return classifyActionText(text, context).allowed === true
}
