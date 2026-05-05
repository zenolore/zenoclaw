import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createPageObserver } from '../observe/page-observer.js'
import { evaluateRules } from './verifier-rules.js'
import { createVerificationResult, VERIFICATION_STATUS } from './verification-result.js'

function defaultRulesForStep(stepName) {
  if (/publish/i.test(stepName)) {
    return [
      { ruleId: 'publish_no_dialog', type: 'no_dialog', severity: 'warn' }
    ]
  }
  return []
}

export class Verifier {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.page = options.page || null
    this.platform = options.platform || 'unknown'
    this.observer = options.observer || createPageObserver({ page: this.page })
    this.traceWriter = options.traceWriter || null
    this.log = options.log || null
  }

  get enabled() {
    return this.flags.verifierEnabled === true
  }

  get verifierConfig() {
    return this.config.verifier || {}
  }

  get shadowOnly() {
    return this.verifierConfig.shadowOnly !== false || this.flags.writeOnly === true
  }

  rulesFor(stepName, context = {}) {
    const configured = this.verifierConfig.rulesByStep?.[stepName]
    const contextRules = Array.isArray(context.rules) ? context.rules : []
    const rules = Array.isArray(configured) ? configured : defaultRulesForStep(stepName)
    return [...rules, ...contextRules]
  }

  async verifyStep(stepName, context = {}) {
    const startedAt = Date.now()
    if (!this.enabled) {
      return createVerificationResult({
        stepName,
        status: VERIFICATION_STATUS.SKIPPED,
        passed: true,
        blocking: false,
        shadowOnly: true,
        summary: 'verifier_disabled'
      })
    }

    try {
      const model = context.pageModel || await this.observer.observe()
      const rules = this.rulesFor(stepName, context)
      const ruleResults = evaluateRules(rules, model)
      const failed = ruleResults.filter(item => item.passed !== true)
      const hasError = failed.some(item => item.status === VERIFICATION_STATUS.FAIL)
      const status = failed.length === 0
        ? VERIFICATION_STATUS.PASS
        : (hasError ? VERIFICATION_STATUS.FAIL : VERIFICATION_STATUS.WARN)
      const result = createVerificationResult({
        stepName,
        status,
        passed: failed.length === 0,
        blocking: false,
        shadowOnly: this.shadowOnly,
        pageFingerprint: model.fingerprint || null,
        ruleResults,
        summary: failed.length === 0 ? 'shadow_verify_passed' : `shadow_verify_${status}`,
        durationMs: Date.now() - startedAt,
        metadata: {
          platform: this.platform,
          ruleCount: rules.length,
          pageSummary: typeof model.summary === 'function' ? model.summary() : null
        }
      })
      this._record(result)
      return result
    } catch (err) {
      const result = createVerificationResult({
        stepName,
        status: VERIFICATION_STATUS.SKIPPED,
        passed: true,
        blocking: false,
        shadowOnly: true,
        summary: `verifier_error:${err.message}`,
        durationMs: Date.now() - startedAt,
        metadata: { platform: this.platform }
      })
      this._record(result)
      return result
    }
  }

  _record(result) {
    try {
      this.traceWriter?.addEvent?.('shadow_verification', result.toJSON())
    } catch (err) {
      this.log?.debug?.(`[Verifier] trace skipped: ${err.message}`)
    }
  }
}

export function createVerifier(options = {}) {
  return new Verifier(options)
}
