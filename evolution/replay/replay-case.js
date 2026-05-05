import crypto from 'crypto'

export const REPLAY_CASE_STATUS = Object.freeze({
  CANDIDATE: 'candidate',
  ACTIVE: 'active',
  SKIPPED: 'skipped'
})

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export class ReplayCase {
  constructor(input = {}) {
    this.caseId = input.caseId || makeId('replay')
    this.status = input.status || REPLAY_CASE_STATUS.CANDIDATE
    this.platform = input.platform || 'fixture'
    this.taskType = input.taskType || 'unit'
    this.source = input.source || 'manual'
    this.steps = Array.isArray(input.steps) ? input.steps : []
    this.expected = input.expected || {}
    this.fixtures = input.fixtures || {}
    this.metadata = input.metadata || {}
    this.createdAt = input.createdAt || nowIso()
  }

  toJSON() {
    return {
      caseId: this.caseId,
      status: this.status,
      platform: this.platform,
      taskType: this.taskType,
      source: this.source,
      steps: this.steps,
      expected: this.expected,
      fixtures: this.fixtures,
      metadata: this.metadata,
      createdAt: this.createdAt
    }
  }
}

export function createReplayCase(input = {}) {
  return new ReplayCase(input)
}
