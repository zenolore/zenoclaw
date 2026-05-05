import path from 'path'

export const EVOLUTION_MODES = Object.freeze({
  OFF: 'off',
  OBSERVE_ONLY: 'observe_only',
  SHADOW_VERIFY: 'shadow_verify',
  CANARY: 'canary',
  ACTIVE: 'active'
})

export const DEFAULT_EVOLUTION_CONFIG = Object.freeze({
  enabled: false,
  mode: EVOLUTION_MODES.OFF,
  dataDir: './data/evolution',
  logDir: './logs/evolution',
  runtime: {
    writeOnly: true,
    failOpen: true
  },
  evidence: {
    level: 'L0'
  },
  features: {
    traceEnabled: false,
    evidenceEnabled: false,
    interruptionGuardEnabled: false,
    pageObserverEnabled: false,
    ruleMemoryEnabled: false,
    verifierEnabled: false,
    repairAgentEnabled: false,
    replayEnabled: false,
    canaryEnabled: false,
    promotionGateEnabled: false,
    manualReviewEnabled: false,
    rollbackEnabled: false,
    metricsEnabled: false,
    canaryResultEnabled: false
  },
  interruptionGuard: {
    beforeStepCheck: true,
    afterStepCheck: false,
    onErrorCheck: true,
    maxDomDismiss: 3,
    maxTutorialClicks: 5,
    visionOnUnknown: false,
    visionBeforeStep: false,
    midsceneFallback: false,
    blockHighRiskActions: true,
    afterDismissDelayMs: 300
  },
  memory: {
    writeFailures: true,
    writeCandidateRules: true,
    writeStrategies: true,
    writePopupMemory: true,
    readRules: false,
    promoteRules: false,
    autoActivateLowRiskPopupRules: false,
    recurrentPopupThreshold: 3,
    maxCandidateRules: 1000
  },
  verifier: {
    shadowOnly: true,
    blockOnFail: false,
    recordToTrace: true,
    recordToMemory: false,
    defaultNoDialog: true,
    rulesByStep: {}
  },
  repair: {
    generateProposals: true,
    writeProposals: true,
    applyPatches: false,
    requireHumanReview: true,
    maxProposalsPerRun: 20
  },
  replay: {
    writeCases: true,
    writeResults: true,
    allowRealPlatforms: false,
    maxStepsPerCase: 50,
    timeoutMs: 30000
  },
  canary: {
    sampleRate: 0,
    deterministicSampling: true,
    blockHighRiskActions: true,
    highRiskActions: [],
    allowedPlatforms: [],
    blockedPlatforms: [],
    dryRunOnly: true
  },
  promotion: {
    writeDecisions: true,
    minReplayPasses: 3,
    maxReplayFailures: 0,
    requireManualReview: true,
    allowAutoPromote: false,
    targetStatus: 'candidate_verified'
  },
  review: {
    writeReviews: true,
    requireReviewer: true,
    defaultPriority: 'normal',
    allowSelfApproval: false,
    applyReviewedChanges: false
  },
  rollback: {
    writePlans: true,
    executeAutomatically: false,
    requireHumanReview: true,
    backupBeforeRollback: true
  },
  metrics: {
    writeReports: true,
    aggregateOnly: true,
    changeExecutionPath: false
  },
  canaryResult: {
    writeResults: true,
    recordOnly: true,
    authorizeExecution: false
  }
})

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function mergeDeep(base, override) {
  const result = { ...base }
  if (!isPlainObject(override)) return result

  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      result[key] = mergeDeep(base[key], value)
    } else if (value !== undefined && value !== null) {
      result[key] = value
    }
  }
  return result
}

function normalizeMode(enabled, mode) {
  if (!enabled) return EVOLUTION_MODES.OFF
  if (Object.values(EVOLUTION_MODES).includes(mode)) return mode
  return EVOLUTION_MODES.OBSERVE_ONLY
}

export function normalizeEvolutionConfig(config = {}) {
  const raw = isPlainObject(config?.evolution)
    ? config.evolution
    : (isPlainObject(config) && ('enabled' in config || 'mode' in config || 'features' in config) ? config : {})
  const merged = mergeDeep(DEFAULT_EVOLUTION_CONFIG, raw)
  const enabled = merged.enabled === true
  const mode = normalizeMode(enabled, merged.mode)

  return {
    ...merged,
    enabled,
    mode,
    dataDir: path.normalize(merged.dataDir || DEFAULT_EVOLUTION_CONFIG.dataDir),
    logDir: path.normalize(merged.logDir || DEFAULT_EVOLUTION_CONFIG.logDir),
    runtime: mergeDeep(DEFAULT_EVOLUTION_CONFIG.runtime, merged.runtime),
    evidence: mergeDeep(DEFAULT_EVOLUTION_CONFIG.evidence, merged.evidence),
    features: mergeDeep(DEFAULT_EVOLUTION_CONFIG.features, merged.features),
    interruptionGuard: mergeDeep(DEFAULT_EVOLUTION_CONFIG.interruptionGuard, merged.interruptionGuard),
    memory: mergeDeep(DEFAULT_EVOLUTION_CONFIG.memory, merged.memory),
    verifier: mergeDeep(DEFAULT_EVOLUTION_CONFIG.verifier, merged.verifier),
    repair: mergeDeep(DEFAULT_EVOLUTION_CONFIG.repair, merged.repair),
    replay: mergeDeep(DEFAULT_EVOLUTION_CONFIG.replay, merged.replay),
    canary: mergeDeep(DEFAULT_EVOLUTION_CONFIG.canary, merged.canary),
    promotion: mergeDeep(DEFAULT_EVOLUTION_CONFIG.promotion, merged.promotion),
    review: mergeDeep(DEFAULT_EVOLUTION_CONFIG.review, merged.review),
    rollback: mergeDeep(DEFAULT_EVOLUTION_CONFIG.rollback, merged.rollback),
    metrics: mergeDeep(DEFAULT_EVOLUTION_CONFIG.metrics, merged.metrics),
    canaryResult: mergeDeep(DEFAULT_EVOLUTION_CONFIG.canaryResult, merged.canaryResult)
  }
}

export function getEvolutionConfig(config = {}) {
  return normalizeEvolutionConfig(config)
}
