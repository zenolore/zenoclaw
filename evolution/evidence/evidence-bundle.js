import path from 'path'
import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { createArtifactRegistry } from './artifact-registry.js'

export class EvidenceBundle {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.traceId = options.traceId || null
    this.platform = options.platform || 'unknown'
    this.taskType = options.taskType || 'unknown'
    this.registry = options.registry || createArtifactRegistry({
      config: this.config,
      traceId: this.traceId
    })
  }

  get level() {
    return this.flags.evidenceLevel || 'L0'
  }

  get isL0() {
    return this.level === 'L0'
  }

  recordStepMeta(step, meta = {}) {
    if (!step) return null
    const item = {
      key: 'step_meta',
      value: {
        traceId: this.traceId,
        stepId: step.stepId,
        platform: this.platform,
        taskType: this.taskType,
        stepName: step.stepName,
        ...meta
      },
      at: new Date().toISOString()
    }
    step.evidence.push(item)
    return item
  }

  registerArtifact(step, artifact = {}) {
    const record = this.registry.register({
      traceId: this.traceId,
      stepId: step?.stepId || artifact.stepId || null,
      platform: this.platform,
      taskType: this.taskType,
      ...artifact
    })
    if (step) {
      step.evidence.push({
        key: 'artifact',
        value: {
          artifactId: record.artifactId,
          type: record.type,
          filePath: record.filePath ? path.normalize(record.filePath) : null
        },
        at: new Date().toISOString()
      })
    }
    return record
  }
}

export function createEvidenceBundle(options = {}) {
  return new EvidenceBundle(options)
}
