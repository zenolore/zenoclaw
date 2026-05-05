import { getEvolutionConfig, EVOLUTION_MODES } from './evolution-config.js'

const FEATURE_KEYS = Object.freeze([
  'traceEnabled',
  'evidenceEnabled',
  'interruptionGuardEnabled',
  'pageObserverEnabled',
  'ruleMemoryEnabled',
  'verifierEnabled',
  'repairAgentEnabled',
  'replayEnabled',
  'canaryEnabled',
  'promotionGateEnabled',
  'manualReviewEnabled',
  'rollbackEnabled',
  'metricsEnabled',
  'canaryResultEnabled'
])

function safeBoolean(value) {
  return value === true
}

export function getFeatureFlags(config = getEvolutionConfig()) {
  const enabled = config.enabled === true && config.mode !== EVOLUTION_MODES.OFF
  const writeOnly = config.runtime?.writeOnly !== false
  const flags = {
    enabled,
    mode: config.mode,
    writeOnly,
    failOpen: config.runtime?.failOpen !== false,
    evidenceLevel: config.evidence?.level || 'L0'
  }

  for (const key of FEATURE_KEYS) {
    flags[key] = enabled && safeBoolean(config.features?.[key])
  }

  if (!enabled) {
    flags.writeOnly = true
  }

  if (config.mode === EVOLUTION_MODES.OBSERVE_ONLY) {
    flags.writeOnly = true
    flags.verifierEnabled = false
    flags.repairAgentEnabled = false
    flags.replayEnabled = false
    flags.canaryEnabled = false
  }

  if (config.mode !== EVOLUTION_MODES.CANARY && config.mode !== EVOLUTION_MODES.ACTIVE) {
    flags.canaryEnabled = false
  }

  return flags
}

export function isEvolutionEnabled(config) {
  return getFeatureFlags(config).enabled
}

export function isFeatureEnabled(name, config) {
  const flags = getFeatureFlags(config)
  return flags[name] === true
}

export function shouldWriteEvidence(config) {
  const flags = getFeatureFlags(config)
  return flags.traceEnabled === true || flags.evidenceEnabled === true
}

export function shouldFailOpen(config) {
  return getFeatureFlags(config).failOpen === true
}
