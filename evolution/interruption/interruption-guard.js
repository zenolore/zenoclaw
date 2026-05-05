import { detectDomPopup } from './dom-popup-detector.js'
import { detectVisionPopup } from './vision-popup-detector.js'
import { classifyActionText } from './safe-actions.js'
import { createInterruptionRules } from './interruption-rules.js'
import { createPopupFingerprint } from '../memory/popup-fingerprint.js'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class InterruptionGuard {
  constructor(options = {}) {
    this.page = options.page || null
    this.platform = options.platform || 'unknown'
    this.flags = options.flags || {}
    this.config = options.config || {}
    this.traceWriter = options.traceWriter || null
    this.rules = options.rules || createInterruptionRules(options.activeRules || [])
    this.popupMemory = options.popupMemory || null
    this.ruleMemory = options.ruleMemory || null
    this.strategyRegistry = options.strategyRegistry || null
    this.log = options.log || null
    this._dismissCount = 0
    this._proposedPopupRules = new Set()
  }

  get enabled() {
    return this.flags.interruptionGuardEnabled === true
  }

  get guardConfig() {
    return this.config.interruptionGuard || {}
  }

  async detect(stepName, reason = 'manual') {
    if (!this.enabled) return { hasInterruption: false, reason: 'disabled' }
    const url = await this._currentUrl()
    const domDetection = this._decorateDetection(
      await detectDomPopup(this.page, { stepName, reason }),
      { stepName, source: 'dom', url }
    )
    if (this._shouldUseVisionFallback(domDetection, reason)) {
      const visionDetection = this._decorateDetection(
        await detectVisionPopup(this.page, {
          stepName,
          reason,
          platform: this.platform,
          url,
          action: /publish|submit/i.test(stepName) ? 'confirm' : 'close'
        }),
        { stepName, source: 'vision', url }
      )
      if (visionDetection.hasInterruption && this._shouldPreferVision(domDetection, visionDetection)) {
        return this._applyRule(visionDetection, stepName)
      }
    }
    const detection = domDetection
    if (!detection.hasInterruption) return detection
    return this._applyRule(detection, stepName)
  }

  _applyRule(detection, stepName) {
    const rule = this.rules.match(detection, { platform: this.platform })
    return {
      ...detection,
      ruleId: rule?.ruleId || null,
      action: rule?.action || detection.action || classifyActionText(detection.buttonText, { popupType: detection.popupType, stepName })
    }
  }

  async handleCurrentInterruption(stepName, reason = 'manual') {
    const detection = await this.detect(stepName, reason)
    if (!detection.hasInterruption) return { handled: false, detection }

    const maxDismiss = this.guardConfig.maxDomDismiss ?? 3
    if (this._dismissCount >= maxDismiss) {
      this._recordPopupSighting(detection, stepName, { handled: false, reason: 'limit_reached' })
      this._record('interruption_limit_reached', { stepName, detection, maxDismiss })
      return { handled: false, detection, reason: 'limit_reached' }
    }

    if (!detection.action?.allowed || detection.buttonX <= 0 || detection.buttonY <= 0) {
      this._recordPopupSighting(detection, stepName, { handled: false, reason: detection.action?.reason || 'unsafe_action' })
      this._record('interruption_blocked', { stepName, detection })
      return { handled: false, detection, reason: detection.action?.reason || 'unsafe_action' }
    }

    await this._click(detection.buttonX, detection.buttonY)
    this._dismissCount += 1
    await sleep(this.guardConfig.afterDismissDelayMs ?? 300)
    const memoryRecord = this._recordPopupSighting(detection, stepName, { handled: true, reason })
    this._maybeProposePopupRule(detection, memoryRecord, stepName)
    this._record('interruption_handled', { stepName, detection })
    return { handled: true, detection }
  }

  _decorateDetection(detection = {}, context = {}) {
    const result = {
      ...detection,
      platform: this.platform,
      stepName: context.stepName,
      source: detection.source || context.source || 'dom',
      url: context.url || detection.url || ''
    }
    if (result.hasInterruption && !result.action) {
      result.action = classifyActionText(result.buttonText, { popupType: result.popupType, stepName: context.stepName })
    }
    if (result.hasInterruption && !result.popupFingerprint) {
      result.popupFingerprint = createPopupFingerprint({
        platform: this.platform,
        stepName: context.stepName,
        url: result.url,
        popupType: result.popupType,
        text: result.text,
        buttonText: result.buttonText,
        source: result.source
      })
    }
    return result
  }

  _shouldUseVisionFallback(detection, reason) {
    if (this.guardConfig.visionOnUnknown !== true) return false
    if (detection?.action?.reason === 'high_risk_button') return false
    if (!detection?.hasInterruption) {
      return reason === 'on_error' || reason === 'verification_failed' || reason === 'after_step' || this.guardConfig.visionBeforeStep === true
    }
    return detection.action?.reason === 'unknown_button' || detection.action?.reason === 'no_safe_button' || detection.buttonX <= 0 || detection.buttonY <= 0
  }

  _shouldPreferVision(domDetection, visionDetection) {
    if (!domDetection?.hasInterruption) return true
    if (domDetection.action?.reason === 'high_risk_button') return false
    if (visionDetection.action?.allowed === true && domDetection.action?.allowed !== true) return true
    return visionDetection.action?.allowed === true && (domDetection.buttonX <= 0 || domDetection.buttonY <= 0)
  }

  _recordPopupSighting(detection, stepName, context = {}) {
    try {
      return this.popupMemory?.record?.(detection, {
        platform: this.platform,
        stepName,
        taskType: 'publish',
        url: detection.url,
        handled: context.handled,
        reason: context.reason
      }) || null
    } catch (err) {
      this.log?.debug?.(`[InterruptionGuard] popup memory skipped: ${err.message}`)
      return null
    }
  }

  _maybeProposePopupRule(detection, memoryRecord, stepName) {
    const aggregate = memoryRecord?.aggregate
    if (!aggregate?.candidateEligible || !detection?.popupFingerprint) return null
    if (this._proposedPopupRules.has(detection.popupFingerprint)) return null
    const matchText = [detection.text, detection.buttonText].filter(Boolean).map(item => String(item).slice(0, 120))
    const ruleId = `popup_${detection.popupFingerprint}`
    const autoActivate = this.config.memory?.autoActivateLowRiskPopupRules === true
      && detection.action?.allowed === true
      && detection.action?.risk === 'low'
      && aggregate.handledCount >= Number(this.config.memory?.recurrentPopupThreshold || 3)
    const strategyStatus = autoActivate ? 'active' : 'candidate'
    const rule = {
      ruleId,
      status: strategyStatus,
      platform: this.platform,
      type: detection.popupType || 'popup_rule',
      matchText,
      action: detection.action,
      buttonText: detection.buttonText || null,
      confidence: detection.source === 'vision' ? 0.7 : 0.8,
      reason: 'recurrent_popup_handled',
      pageFingerprint: detection.popupFingerprint,
      metadata: {
        popupFingerprint: detection.popupFingerprint,
        source: detection.source,
        stepName,
        count: aggregate.count,
        handledCount: aggregate.handledCount
      }
    }
    const proposed = this.ruleMemory?.proposeRule?.(rule)
    if (proposed) {
      this.strategyRegistry?.register?.({
        strategyId: `${this.platform}_${detection.popupFingerprint}_interruption_rule`,
        status: strategyStatus,
        platform: this.platform,
        stepName,
        type: 'interruption_rule',
        ruleIds: [ruleId],
        successCount: aggregate.handledCount,
        failureCount: Math.max(0, aggregate.count - aggregate.handledCount),
        confidence: rule.confidence,
        metadata: {
          rule,
          popupFingerprint: detection.popupFingerprint
        }
      })
      this._proposedPopupRules.add(detection.popupFingerprint)
      this._record('interruption_rule_candidate_created', { stepName, ruleId, popupFingerprint: detection.popupFingerprint })
    }
    return proposed || null
  }

  async _currentUrl() {
    try {
      if (typeof this.page?.url === 'function') return this.page.url()
    } catch {}
    return ''
  }

  async _click(x, y) {
    if (this.page?.mouse?.click) {
      await this.page.mouse.click(x, y)
      return
    }
    if (typeof this.page?.click === 'function') {
      await this.page.click(`xpath///body`, { offset: { x, y } })
    }
  }

  _record(event, payload) {
    try {
      this.traceWriter?.addEvent?.(event, {
        platform: this.platform,
        ...payload
      })
    } catch (err) {
      this.log?.debug?.(`[InterruptionGuard] trace skipped: ${err.message}`)
    }
  }
}

export function createInterruptionGuard(options = {}) {
  return new InterruptionGuard(options)
}
