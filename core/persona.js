/**
 * 会话级人格画像 (Session Persona)
 *
 * 真人在一次会话里节奏是一致的：疲劳、心情、习惯共同形成稳定的行为基线。
 * 自动化里如果每个动作独立采样，长会话的"动作间方差异常稳定"反而会成为机器人特征。
 *
 * 本模块在 session 启动时抽一个 persona，整个 session 内所有的鼠标/键盘/停顿
 * 函数都通过 persona 调制，得到"内部一致 + 跨 session 多样"的行为分布。
 *
 * 用法：
 *   import { initSessionPersona, persona, p } from './persona.js'
 *   const profile = initSessionPersona()      // session 启动时调用一次
 *   p('typing.meanFactor', 1.0)               // 读取 persona 参数
 *   persona().pickEntry(['avatar', 'topbar']) // 按入口偏好权重抽签
 */

import crypto from 'crypto'
import { getLogger } from './logger.js'

// ============================================================
// 人格库
// ============================================================

/**
 * 四种基础人格画像。每个 persona 对真人不同节奏进行刻画，
 * 字段含义见下方字段说明。新增 persona 时保持字段一致。
 *
 * 字段说明：
 *   typing.meanFactor       打字间隔倍率（1.0=基线，>1=慢，<1=快）
 *   typing.stdFactor        打字间隔波动倍率
 *   typing.pauseChance      思考停顿出现概率（覆盖 keyboard.pause_chance）
 *   typing.lookChance       看屏幕停顿出现概率（基线 1.0）
 *   typing.typoChance       打错字概率
 *   typing.reviseChance     写完后回头改一两处的概率
 *   click.hesitationChance  点击前犹豫概率（hover-leave-hover-click）
 *   click.holdMs            鼠标按下持续时间均值
 *   click.preHoverMs        click 前先 hover 的时间均值
 *   mouse.jitterRadius      鼠标空闲微抖动半径
 *   mouse.idleMoveChance    空闲时随机移动鼠标的概率
 *   scroll.inertiaFactor    滚动距离倍率
 *   scroll.passesMin/Max    通读检查时的滚动遍数
 *   review.dwellMs          通读检查停留时间均值
 *   review.scrollBackChance 通读检查时回滚一次的概率
 *   timing.actionFactor     操作间隔倍率
 *   timing.preNavExtraMs    导航前的额外延迟（看清楚再点）
 *   entry.preferences       不同入口策略的偏好权重
 *   draft.saveChance        偶发"保存草稿再继续"的概率
 *   recovery.readPauseMs    报错后先读一段时间再重试
 */
export const PERSONA_PROFILES = Object.freeze({
  veteran: {
    label: '老练型',
    description: '动作快、几乎不犹豫、偏好直链/快捷键',
    typing: {
      meanFactor: 0.7,
      stdFactor: 0.8,
      pauseChance: 0.04,
      lookChance: 0.6,
      typoChance: 0.005,
      reviseChance: 0.05
    },
    click: { hesitationChance: 0.05, holdMs: 60, preHoverMs: 120 },
    mouse: { jitterRadius: 2, idleMoveChance: 0.1 },
    scroll: { inertiaFactor: 1.1, passesMin: 1, passesMax: 2 },
    review: { dwellMs: 1200, scrollBackChance: 0.15 },
    timing: { actionFactor: 0.75, preNavExtraMs: 150 },
    entry: { preferences: { directUrl: 4, dashboard: 2, topbar: 2, avatar: 1, draftList: 1 } },
    draft: { saveChance: 0.05 },
    recovery: { readPauseMs: 1200 }
  },
  steady: {
    label: '稳健型',
    description: '节奏均衡、按部就班、偏好仪表盘进入',
    typing: {
      meanFactor: 1.0,
      stdFactor: 1.0,
      pauseChance: 0.1,
      lookChance: 1.0,
      typoChance: 0.02,
      reviseChance: 0.2
    },
    click: { hesitationChance: 0.15, holdMs: 90, preHoverMs: 250 },
    mouse: { jitterRadius: 4, idleMoveChance: 0.25 },
    scroll: { inertiaFactor: 1.0, passesMin: 1, passesMax: 3 },
    review: { dwellMs: 2200, scrollBackChance: 0.4 },
    timing: { actionFactor: 1.0, preNavExtraMs: 350 },
    entry: { preferences: { dashboard: 4, topbar: 3, avatar: 2, directUrl: 1, draftList: 1 } },
    draft: { saveChance: 0.15 },
    recovery: { readPauseMs: 2400 }
  },
  casual: {
    label: '摸鱼型',
    description: '慢悠悠、停顿多、爱绕路、爱回看',
    typing: {
      meanFactor: 1.4,
      stdFactor: 1.3,
      pauseChance: 0.18,
      lookChance: 1.4,
      typoChance: 0.03,
      reviseChance: 0.35
    },
    click: { hesitationChance: 0.3, holdMs: 110, preHoverMs: 450 },
    mouse: { jitterRadius: 6, idleMoveChance: 0.45 },
    scroll: { inertiaFactor: 0.8, passesMin: 2, passesMax: 4 },
    review: { dwellMs: 3500, scrollBackChance: 0.6 },
    timing: { actionFactor: 1.4, preNavExtraMs: 600 },
    entry: { preferences: { avatar: 4, dashboard: 2, topbar: 2, draftList: 2, directUrl: 1 } },
    draft: { saveChance: 0.25 },
    recovery: { readPauseMs: 4000 }
  },
  rushed: {
    label: '急性子',
    description: '快、短停顿、偶发打错、偏好顶部按钮',
    typing: {
      meanFactor: 0.85,
      stdFactor: 0.9,
      pauseChance: 0.06,
      lookChance: 0.7,
      typoChance: 0.04,
      reviseChance: 0.1
    },
    click: { hesitationChance: 0.08, holdMs: 70, preHoverMs: 180 },
    mouse: { jitterRadius: 3, idleMoveChance: 0.15 },
    scroll: { inertiaFactor: 1.2, passesMin: 1, passesMax: 2 },
    review: { dwellMs: 1500, scrollBackChance: 0.2 },
    timing: { actionFactor: 0.85, preNavExtraMs: 200 },
    entry: { preferences: { topbar: 4, directUrl: 3, dashboard: 2, avatar: 1, draftList: 1 } },
    draft: { saveChance: 0.08 },
    recovery: { readPauseMs: 1500 }
  }
})

const DEFAULT_PERSONA_KEY = 'steady'

// ============================================================
// 内部状态
// ============================================================

let _activePersona = null
let _personaSeed = null
let _circadianFactorOverride = null

// ============================================================
// 工具
// ============================================================

function pickWeightedKey(weights = {}, rand = Math.random) {
  const entries = Object.entries(weights).filter(([, w]) => Number(w) > 0)
  if (entries.length === 0) return null
  const total = entries.reduce((sum, [, w]) => sum + Number(w), 0)
  let r = rand() * total
  for (const [key, w] of entries) {
    r -= Number(w)
    if (r <= 0) return key
  }
  return entries[entries.length - 1][0]
}

function getDotPath(obj, dotPath) {
  if (!obj || !dotPath) return undefined
  const keys = dotPath.split('.')
  let cur = obj
  for (const key of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return value
  if (typeof min === 'number' && value < min) return min
  if (typeof max === 'number' && value > max) return max
  return value
}

/**
 * 根据当前小时给出昼夜节律倍率：
 *   早上 9-11：基线
 *   中午 12-13：略慢
 *   下午 14-18：基线
 *   晚上 19-22：略慢
 *   深夜 23-02：明显慢
 *   凌晨 03-08：略快但停顿多
 * 倍率应用到 timing.actionFactor 与 typing.meanFactor。
 */
export function circadianFactor(date = new Date()) {
  if (typeof _circadianFactorOverride === 'number') return _circadianFactorOverride
  const h = date.getHours()
  if (h >= 9 && h <= 11) return 1.0
  if (h === 12 || h === 13) return 1.1
  if (h >= 14 && h <= 18) return 1.0
  if (h >= 19 && h <= 22) return 1.1
  if (h === 23 || h <= 2) return 1.3
  return 0.95
}

/**
 * 测试用：固定昼夜倍率
 */
export function setCircadianFactorOverride(value) {
  _circadianFactorOverride = (typeof value === 'number') ? value : null
}

// ============================================================
// 初始化与读取
// ============================================================

/**
 * 在 session 启动时初始化 persona。可传 options.persona 强制选某种人格。
 * 多次调用只会保留第一次，避免 session 内人格漂移。
 */
export function initSessionPersona(options = {}) {
  if (_activePersona && !options.force) return _activePersona
  const log = getLogger()

  const requestedKey = options.persona || process.env.ZENOCLAW_PERSONA
  let key = requestedKey && PERSONA_PROFILES[requestedKey] ? requestedKey : null

  if (!key) {
    // 默认权重：稳健 4 / 老练 2 / 急性子 2 / 摸鱼 2，可按需调整
    key = pickWeightedKey({ steady: 4, veteran: 2, rushed: 2, casual: 2 }) || DEFAULT_PERSONA_KEY
  }

  const profile = PERSONA_PROFILES[key]
  _personaSeed = options.seed || crypto.randomBytes(8).toString('hex')
  _activePersona = {
    key,
    seed: _personaSeed,
    label: profile.label,
    description: profile.description,
    profile,
    createdAt: new Date().toISOString(),
    circadianAtStart: circadianFactor()
  }

  log.info(`[Persona] 本次会话人格：${profile.label}（${key}），seed=${_personaSeed}`)
  return _activePersona
}

/**
 * 取当前 persona；未初始化时按默认人格懒初始化（不抽签，固定 steady 以保证可预测）
 */
export function persona() {
  if (!_activePersona) {
    return initSessionPersona({ persona: DEFAULT_PERSONA_KEY })
  }
  return _activePersona
}

/**
 * 读取 persona 内某个点号路径参数
 * 例：p('typing.meanFactor', 1.0)
 */
export function p(dotPath, fallback) {
  const value = getDotPath(persona().profile, dotPath)
  return value === undefined ? fallback : value
}

/**
 * 给一个基线均值，按 persona 调制（typing.meanFactor + 昼夜节律）
 * @param {number} baseMs - 基线均值
 * @param {object} [options]
 * @param {string} [options.factorPath='typing.meanFactor']
 * @param {boolean} [options.applyCircadian=true]
 */
export function modulateMean(baseMs, options = {}) {
  const factorPath = options.factorPath || 'typing.meanFactor'
  const factor = Number(p(factorPath, 1.0)) || 1.0
  const circadian = options.applyCircadian === false ? 1.0 : circadianFactor()
  return Math.max(0, Math.round(baseMs * factor * circadian))
}

/**
 * 按 persona 调制 [min,max] 区间，返回新的区间
 */
export function modulateRange(min, max, options = {}) {
  return [modulateMean(min, options), modulateMean(max, options)]
}

/**
 * 按 persona 概率字段决定是否触发某个行为
 * 例：shouldDo('click.hesitationChance')
 */
export function shouldDo(dotPath, fallback = 0) {
  const chance = Number(p(dotPath, fallback)) || 0
  return Math.random() < chance
}

/**
 * 入口偏好抽签：传入候选 entry key 数组，按 persona 偏好返回一个 key
 * 不在 preferences 表里的 key 默认权重 1
 */
export function pickEntryByPersona(candidateKeys = []) {
  if (!Array.isArray(candidateKeys) || candidateKeys.length === 0) return null
  const prefs = persona().profile.entry?.preferences || {}
  const weights = {}
  for (const key of candidateKeys) {
    weights[key] = Number(prefs[key] ?? 1)
  }
  return pickWeightedKey(weights)
}

/**
 * 在 trace evidence 里记录人格信息（便于后续审计行为分布）
 */
export function getPersonaEvidence() {
  const cur = persona()
  return {
    personaKey: cur.key,
    personaLabel: cur.label,
    seed: cur.seed,
    circadianAtStart: cur.circadianAtStart,
    circadianNow: circadianFactor(),
    createdAt: cur.createdAt
  }
}

/**
 * 测试用：重置 persona（生产代码不应调用）
 */
export function _resetPersonaForTest() {
  _activePersona = null
  _personaSeed = null
  _circadianFactorOverride = null
}
