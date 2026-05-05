/**
 * 多入口策略 (Entry Strategy)
 *
 * 真人不会每次都从同一个按钮进发布页。本模块负责：
 *   1) 接收平台声明的多个入口候选（每个候选含 selector / actions / fallback URL）
 *   2) 结合 persona 偏好权重 + 历史去重 抽签出本次入口
 *   3) 失败时温和降级到下一个候选，最后兜底用 directUrl
 *   4) 把使用历史持久化到 data/evolution/entry-history.jsonl（仅写日志，不改控制流）
 *
 * 入口候选数据结构示例：
 *   {
 *     key: 'avatar',                 // 入口唯一标识（与 persona 偏好表对齐）
 *     label: '头像下拉 → 创作中心',   // 人类可读说明
 *     weight: 1,                     // 平台维度的相对权重（默认 1）
 *     run: async (adapter) => { ... } // 真正执行入口动作（可使用 adapter 暴露的方法）
 *   }
 *
 * 用法：
 *   const strategy = createEntryStrategy({ platform: 'douyin', persona })
 *   await strategy.execute(adapter, candidates, { fallbackUrl })
 */

import fs from 'fs'
import path from 'path'
import { getLogger } from './logger.js'
import { pickEntryByPersona, persona, p } from './persona.js'

// ============================================================
// 历史去重存储
// ============================================================

const DEFAULT_HISTORY_FILE = path.resolve('./data/evolution/entry-history.jsonl')
const DEFAULT_HISTORY_WINDOW = 5 // 最近 N 次内同一入口最多用 maxRepeat 次
const DEFAULT_MAX_REPEAT = 2

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function readRecentHistory(filePath, platform, window) {
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf-8').trim()
    if (!raw) return []
    const lines = raw.split('\n').slice(-200)
    const records = []
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (!platform || obj.platform === platform) records.push(obj)
      } catch { /* skip malformed line */ }
    }
    return records.slice(-window)
  } catch {
    return []
  }
}

function appendHistory(filePath, record) {
  try {
    ensureDir(path.dirname(filePath))
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8')
  } catch (err) {
    getLogger().debug?.(`[EntryStrategy] history write skipped: ${err.message}`)
  }
}

// ============================================================
// 抽签
// ============================================================

function countOccurrences(records, key) {
  return records.filter(r => r.entryKey === key).length
}

/**
 * 从候选列表里按 persona 偏好 + 平台权重 + 历史去重 抽一个入口
 * @param {Array<object>} candidates
 * @param {Array<object>} history - 最近的历史记录
 * @param {object} options
 * @returns {object|null} 选中的候选
 */
export function pickEntry(candidates = [], history = [], options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const maxRepeat = Number(options.maxRepeat ?? DEFAULT_MAX_REPEAT)
  const personaPreferences = persona().profile.entry?.preferences || {}

  // 组合权重：persona 偏好 × 平台 weight × 历史折扣
  const weighted = candidates.map(c => {
    const base = Number(c.weight ?? 1)
    const personaWeight = Number(personaPreferences[c.key] ?? 1)
    const used = countOccurrences(history, c.key)
    const overUsed = used >= maxRepeat
    const discount = overUsed ? 0 : (used > 0 ? 0.5 : 1)
    const finalWeight = base * personaWeight * discount
    return { candidate: c, weight: Math.max(0, finalWeight) }
  })

  const total = weighted.reduce((sum, w) => sum + w.weight, 0)
  // 全部被去重压成 0：放宽限制（去掉历史折扣，只保留偏好权重）
  if (total <= 0) {
    const fallback = candidates.map(c => ({
      candidate: c,
      weight: Number(c.weight ?? 1) * Number(personaPreferences[c.key] ?? 1)
    }))
    const fallbackTotal = fallback.reduce((s, w) => s + w.weight, 0) || candidates.length
    let r = Math.random() * fallbackTotal
    for (const item of fallback) {
      r -= item.weight || 1
      if (r <= 0) return item.candidate
    }
    return candidates[0]
  }

  let r = Math.random() * total
  for (const item of weighted) {
    r -= item.weight
    if (r <= 0) return item.candidate
  }
  return weighted[weighted.length - 1].candidate
}

// ============================================================
// 策略执行
// ============================================================

export class EntryStrategy {
  constructor(options = {}) {
    this.platform = options.platform || 'unknown'
    this.historyFile = options.historyFile || DEFAULT_HISTORY_FILE
    this.window = Number(options.window ?? DEFAULT_HISTORY_WINDOW)
    this.maxRepeat = Number(options.maxRepeat ?? DEFAULT_MAX_REPEAT)
    this.log = options.log || getLogger()
  }

  /**
   * 选择并执行一个入口；失败按候选顺序降级；全部失败返回 null（调用方决定是否兜底 goto）
   * @param {object} adapter - 平台适配器实例（提供 page/cursor/log 等）
   * @param {Array<object>} candidates - 入口候选
   * @param {object} options
   * @param {string} [options.fallbackUrl] - 全部失败后兜底 URL（建议传 publishUrl）
   * @param {Function} [options.gotoFallback] - 自定义兜底函数
   */
  async execute(adapter, candidates = [], options = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return this._executeFallback(adapter, options, 'no_candidates')
    }

    const history = readRecentHistory(this.historyFile, this.platform, this.window)
    const ordered = options.fixedOrder === true
      ? [...candidates]
      : this._orderForExecution(candidates, history)

    for (let i = 0; i < ordered.length; i++) {
      const candidate = ordered[i]
      const startedAt = Date.now()
      try {
        this.log.info(`[EntryStrategy] ${this.platform} 选中入口 [${candidate.key}] ${candidate.label || ''}`)
        await Promise.resolve(candidate.run(adapter))
        appendHistory(this.historyFile, {
          platform: this.platform,
          entryKey: candidate.key,
          label: candidate.label || null,
          status: 'success',
          attempt: i + 1,
          personaKey: persona().key,
          durationMs: Date.now() - startedAt,
          createdAt: new Date().toISOString()
        })
        return { entry: candidate, attempts: i + 1, status: 'success' }
      } catch (err) {
        this.log.warn(`[EntryStrategy] 入口 [${candidate.key}] 失败: ${err.message}`)
        appendHistory(this.historyFile, {
          platform: this.platform,
          entryKey: candidate.key,
          label: candidate.label || null,
          status: 'failed',
          attempt: i + 1,
          error: err.message,
          personaKey: persona().key,
          durationMs: Date.now() - startedAt,
          createdAt: new Date().toISOString()
        })
        // 继续尝试下一个
      }
    }

    return this._executeFallback(adapter, options, 'all_candidates_failed')
  }

  async _executeFallback(adapter, options, reason) {
    const startedAt = Date.now()
    const fallbackUrl = options.fallbackUrl
    const gotoFallback = options.gotoFallback

    try {
      if (typeof gotoFallback === 'function') {
        await gotoFallback(adapter)
      } else if (fallbackUrl && adapter?.navigateTo) {
        this.log.warn(`[EntryStrategy] ${this.platform} 兜底 goto: ${fallbackUrl}（reason=${reason}）`)
        await adapter.navigateTo(fallbackUrl)
      } else if (fallbackUrl && adapter?.page?.goto) {
        this.log.warn(`[EntryStrategy] ${this.platform} 兜底 page.goto: ${fallbackUrl}（reason=${reason}）`)
        await adapter.page.goto(fallbackUrl)
      } else {
        return { entry: null, attempts: 0, status: 'failed', reason }
      }

      appendHistory(this.historyFile, {
        platform: this.platform,
        entryKey: 'directUrl',
        label: 'fallback goto',
        status: 'fallback',
        reason,
        personaKey: persona().key,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString()
      })
      return { entry: null, attempts: 0, status: 'fallback', reason }
    } catch (err) {
      this.log.error(`[EntryStrategy] 兜底 goto 也失败: ${err.message}`)
      return { entry: null, attempts: 0, status: 'failed', reason: err.message }
    }
  }

  _orderForExecution(candidates, history) {
    const first = pickEntry(candidates, history, { maxRepeat: this.maxRepeat })
    if (!first) return [...candidates]
    const rest = candidates.filter(c => c !== first)
    // 剩余的按 persona 偏好稳定排序
    const personaPrefs = persona().profile.entry?.preferences || {}
    rest.sort((a, b) => Number(personaPrefs[b.key] ?? 1) - Number(personaPrefs[a.key] ?? 1))
    return [first, ...rest]
  }
}

export function createEntryStrategy(options = {}) {
  return new EntryStrategy(options)
}

// 便捷工厂：常见入口候选的标准 key
export const ENTRY_KEYS = Object.freeze({
  AVATAR: 'avatar',
  TOPBAR: 'topbar',
  DASHBOARD: 'dashboard',
  DRAFT_LIST: 'draftList',
  DIRECT_URL: 'directUrl',
  SEARCH: 'search'
})
