import { normalizeEvolutionConfig } from '../runtime/evolution-config.js'
import { getFeatureFlags } from '../runtime/feature-flags.js'
import { computeLearningMetrics } from './learning-metrics.js'
import { createMetricsStore } from './metrics-store.js'

export class LearningMetricsService {
  constructor(options = {}) {
    this.config = normalizeEvolutionConfig(options.config || {})
    this.flags = options.flags || getFeatureFlags(this.config)
    this.store = options.store || createMetricsStore({ config: this.config, flags: this.flags })
  }

  get enabled() {
    return this.flags.metricsEnabled === true
  }

  generate(input = {}) {
    if (!this.enabled) return null
    const report = computeLearningMetrics(input)
    return this.store.save(report) || report
  }
}

export function createLearningMetricsService(options = {}) {
  return new LearningMetricsService(options)
}
