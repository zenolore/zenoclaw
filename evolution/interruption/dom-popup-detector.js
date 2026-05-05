import { classifyActionText } from './safe-actions.js'

export async function detectDomPopup(page, options = {}) {
  if (!page || typeof page.evaluate !== 'function') {
    return { hasInterruption: false, reason: 'page_unavailable' }
  }

  const raw = await page.evaluate(() => {
    const popupSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal',
      '.dialog',
      '.popover',
      '.tour',
      '.guide',
      '.mask',
      '.overlay',
      '[class*="modal" i]',
      '[class*="dialog" i]',
      '[class*="guide" i]',
      '[class*="popover" i]',
      '[class*="overlay" i]'
    ]

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

    function getText(el) {
      return (el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || '').trim()
    }

    function classifyPopup(text) {
      const value = text.toLowerCase()
      if (/下一步|完成|我知道了|新手|引导|教程|next|tour|guide|got it/.test(value)) return 'tutorial_guide'
      if (/更新|新功能|版本|upgrade|new feature/.test(value)) return 'update_notice'
      if (/通知|定位|权限|permission|notification|location/.test(value)) return 'permission_prompt'
      if (/cookie/.test(value)) return 'cookie_notice'
      if (/登录|扫码|login|sign in/.test(value)) return 'login_prompt'
      if (/发布|提交|publish|submit/.test(value)) return 'publish_confirm'
      if (/删除|退出登录|支付|充值|delete|logout|pay/.test(value)) return 'destructive_confirm'
      return 'unknown_popup'
    }

    const candidates = Array.from(document.querySelectorAll(popupSelectors.join(','))).filter(isVisible)
    const highZ = Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (!isVisible(el)) return false
      const style = window.getComputedStyle(el)
      const z = Number.parseInt(style.zIndex, 10)
      const rect = el.getBoundingClientRect()
      const fixedLike = style.position === 'fixed' || style.position === 'sticky' || style.position === 'absolute'
      const central = rect.left < window.innerWidth * 0.75 && rect.right > window.innerWidth * 0.25 && rect.top < window.innerHeight * 0.75 && rect.bottom > window.innerHeight * 0.15
      return fixedLike && Number.isFinite(z) && z >= 1000 && central
    })

    const roots = candidates.length ? candidates : highZ.slice(0, 5)
    const results = []
    for (const root of roots) {
      const rootText = getText(root)
      const popupType = classifyPopup(rootText)
      const buttons = Array.from(root.querySelectorAll('button, [role="button"], a, span, div')).filter(isVisible)
      for (const button of buttons) {
        const buttonText = getText(button)
        if (!buttonText) continue
        const rect = button.getBoundingClientRect()
        results.push({
          hasInterruption: true,
          popupType,
          text: rootText.slice(0, 500),
          buttonText,
          buttonX: Math.round(rect.left + rect.width / 2),
          buttonY: Math.round(rect.top + rect.height / 2)
        })
      }
      if (rootText) {
        results.push({
          hasInterruption: true,
          popupType,
          text: rootText.slice(0, 500),
          buttonText: '',
          buttonX: 0,
          buttonY: 0
        })
      }
    }

    return results.length ? { hasInterruption: true, candidates: results } : { hasInterruption: false }
  }).catch((err) => ({ hasInterruption: false, reason: err.message }))

  const candidates = Array.isArray(raw?.candidates) ? raw.candidates : []
  const safeCandidate = candidates.find(candidate =>
    classifyActionText(candidate.buttonText, {
      popupType: candidate.popupType,
      stepName: options.stepName
    }).allowed
  )
  const selected = safeCandidate || candidates[0] || raw
  const action = selected?.buttonText
    ? classifyActionText(selected.buttonText, { popupType: selected.popupType, stepName: options.stepName })
    : { allowed: false, risk: 'unknown', reason: raw?.hasInterruption ? 'no_safe_button' : 'no_popup' }

  return {
    hasInterruption: raw?.hasInterruption === true,
    popupType: selected?.popupType || '',
    text: selected?.text || '',
    buttonText: selected?.buttonText || '',
    buttonX: Math.round(selected?.buttonX || 0),
    buttonY: Math.round(selected?.buttonY || 0),
    action,
    reason: raw?.reason || null
  }
}
