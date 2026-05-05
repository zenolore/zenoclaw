import crypto from 'crypto'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createReplayStore } from './replay-store.js'

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

function assertFixtureOnly(config, replayCase) {
  const allowed = config.replay?.allowRealPlatforms === true
  if (allowed) return
  if (replayCase.platform !== 'fixture') {
    throw new Error(`replay_real_platform_blocked:${replayCase.platform}`)
  }
}

function evaluateExpectation(expected = {}, context = {}) {
  const checks = []
  if (expected.finalStatus) {
    checks.push({
      key: 'finalStatus',
      expected: expected.finalStatus,
      actual: context.finalStatus,
      passed: expected.finalStatus === context.finalStatus
    })
  }
  if (expected.evidenceKeys) {
    const evidenceKeys = context.evidenceKeys || []
    for (const key of expected.evidenceKeys) {
      checks.push({
        key: `evidence:${key}`,
        expected: true,
        actual: evidenceKeys.includes(key),
        passed: evidenceKeys.includes(key)
      })
    }
  }
  return checks
}

export class ReplayRunner {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.store = options.store || createReplayStore({ config: this.config, flags: this.flags })
    this.handlers = options.handlers || {}
    this.log = options.log || null
  }

  get enabled() {
    return this.flags.replayEnabled === true
  }

  async run(replayCase) {
    const startedAt = Date.now()
    const runId = makeId('replay_run')
    if (!this.enabled) {
      return this._save({
        runId,
        caseId: replayCase?.caseId || null,
        status: 'skipped',
        passed: true,
        reason: 'replay_disabled',
        stepResults: [],
        expectationResults: [],
        durationMs: Date.now() - startedAt,
        createdAt: nowIso()
      })
    }

    try {
      assertFixtureOnly(this.config, replayCase)
      const stepResults = []
      const evidenceKeys = []
      let finalStatus = 'passed'
      for (const step of replayCase.steps || []) {
        const handler = this.handlers[step.action]
        if (!handler) {
          stepResults.push({ stepName: step.stepName || step.action, action: step.action, status: 'failed', error: `missing_handler:${step.action}` })
          finalStatus = 'failed'
          break
        }
        try {
          const value = await handler(step, replayCase.fixtures || {})
          const evidence = Array.isArray(value?.evidence) ? value.evidence : []
          evidenceKeys.push(...evidence.map(item => item.key).filter(Boolean))
          stepResults.push({ stepName: step.stepName || step.action, action: step.action, status: 'passed', value })
        } catch (err) {
          stepResults.push({ stepName: step.stepName || step.action, action: step.action, status: 'failed', error: err.message })
          finalStatus = 'failed'
          break
        }
      }
      const expectationResults = evaluateExpectation(replayCase.expected, { finalStatus, evidenceKeys })
      const passed = finalStatus === 'passed' && expectationResults.every(item => item.passed)
      return this._save({
        runId,
        caseId: replayCase.caseId,
        status: passed ? 'passed' : 'failed',
        passed,
        platform: replayCase.platform,
        stepResults,
        expectationResults,
        durationMs: Date.now() - startedAt,
        createdAt: nowIso()
      })
    } catch (err) {
      return this._save({
        runId,
        caseId: replayCase?.caseId || null,
        status: 'failed',
        passed: false,
        reason: err.message,
        stepResults: [],
        expectationResults: [],
        durationMs: Date.now() - startedAt,
        createdAt: nowIso()
      })
    }
  }

  _save(result) {
    try {
      return this.store.saveResult(result) || result
    } catch (err) {
      this.log?.debug?.(`[ReplayRunner] result write skipped: ${err.message}`)
      return result
    }
  }
}

export function createReplayRunner(options = {}) {
  return new ReplayRunner(options)
}
