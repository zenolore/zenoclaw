export const VERIFICATION_STATUS = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
  SKIPPED: 'skipped'
})

function nowIso() {
  return new Date().toISOString()
}

export class VerificationResult {
  constructor(input = {}) {
    this.verifierId = input.verifierId || 'shadow_verifier'
    this.stepName = input.stepName || 'unknown'
    this.status = input.status || VERIFICATION_STATUS.SKIPPED
    this.passed = input.passed === true
    this.blocking = input.blocking === true
    this.shadowOnly = input.shadowOnly !== false
    this.pageFingerprint = input.pageFingerprint || null
    this.ruleResults = Array.isArray(input.ruleResults) ? input.ruleResults : []
    this.summary = input.summary || ''
    this.durationMs = Number(input.durationMs || 0)
    this.createdAt = input.createdAt || nowIso()
    this.metadata = input.metadata || {}
  }

  toJSON() {
    return {
      verifierId: this.verifierId,
      stepName: this.stepName,
      status: this.status,
      passed: this.passed,
      blocking: this.blocking,
      shadowOnly: this.shadowOnly,
      pageFingerprint: this.pageFingerprint,
      ruleResults: this.ruleResults,
      summary: this.summary,
      durationMs: this.durationMs,
      createdAt: this.createdAt,
      metadata: this.metadata
    }
  }
}

export function createVerificationResult(input = {}) {
  return new VerificationResult(input)
}
