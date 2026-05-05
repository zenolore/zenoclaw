import fs from 'fs'
import path from 'path'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8')
}

export class RepairProposalStore {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
  }

  get enabled() {
    return this.flags.repairAgentEnabled === true && this.config.repair?.writeProposals !== false
  }

  get proposalFile() {
    return path.resolve(this.config.dataDir, 'repair', 'proposals.jsonl')
  }

  record(proposal) {
    if (!this.enabled) return null
    const payload = typeof proposal?.toJSON === 'function' ? proposal.toJSON() : proposal
    const record = {
      ...payload,
      status: payload.status || 'candidate',
      guardrails: {
        applyAutomatically: false,
        requiresHumanReview: true,
        ...(payload.guardrails || {})
      }
    }
    appendJsonLine(this.proposalFile, record)
    return record
  }
}

export function createRepairProposalStore(options = {}) {
  return new RepairProposalStore(options)
}
