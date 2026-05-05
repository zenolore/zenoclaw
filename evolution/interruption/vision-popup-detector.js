import { detectPopup } from '../../core/vision-locate.js'
import { classifyActionText } from './safe-actions.js'
import { createPopupFingerprint } from '../memory/popup-fingerprint.js'

export async function detectVisionPopup(page, options = {}) {
  if (!page) return { hasInterruption: false, reason: 'page_unavailable', source: 'vision' }
  const actionIntent = options.action || 'close'
  const result = await detectPopup(page, actionIntent)
  if (!result?.hasPopup) {
    return {
      hasInterruption: false,
      reason: result?.popupType || 'no_popup',
      source: 'vision',
      elapsed: result?.elapsed || 0
    }
  }
  const buttonText = result.buttonText || result.buttonDescription || result.popupAction || actionIntent
  const detection = {
    hasInterruption: true,
    source: 'vision',
    popupType: result.popupType || 'unknown_popup',
    text: result.details || result.popupType || '',
    buttonText,
    buttonX: Math.round(result.buttonX || 0),
    buttonY: Math.round(result.buttonY || 0),
    confidence: Number(result.confidence || 0.65),
    elapsed: result.elapsed || 0
  }
  detection.action = classifyActionText(buttonText, {
    popupType: detection.popupType,
    stepName: options.stepName
  })
  detection.popupFingerprint = createPopupFingerprint({
    platform: options.platform || 'unknown',
    stepName: options.stepName || '',
    url: options.url || '',
    popupType: detection.popupType,
    text: detection.text,
    buttonText: detection.buttonText,
    source: detection.source
  })
  return detection
}
