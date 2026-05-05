import { BasePlatformAdapter } from './base.js'

/**
 * 各平台 reader 的统一数据字段定义
 *
 * 目的：让所有平台的数据采集结果可以被同一套接口和 dashboard 直接消费，
 * 避免每个平台返回不同字段，导致后续聚合 / 报表 / 趋势分析无法对齐。
 *
 * 约定：
 *   - 所有 reader 在 readPostStats() 中应返回包含以下字段的对象（缺失字段填 null）。
 *   - 平台特定字段（例如 reddit upvotes、x retweets）允许额外保留。
 *   - 暂未实现真实采集逻辑的占位 reader 必须设置 isPlaceholder = true。
 *
 * 兼容性：
 *   - 已有的 reader 在不破坏其原有返回字段的前提下，可在新版本逐步对齐。
 *   - 本文件不强制改写已有 reader，只为新增 reader 提供基类与统一字段。
 */
export const READER_FIELDS = Object.freeze([
  'views',     // 阅读 / 播放数
  'likes',     // 点赞 / 赞同 / upvote
  'comments',  // 评论数
  'collects',  // 收藏数
  'shares',    // 转发 / 分享 / retweet
])

/**
 * 返回一个所有统一字段都为 null 的空统计对象。
 *
 * @returns {Record<string, number|null>}
 */
export function emptyStats() {
  const stats = {}
  for (const field of READER_FIELDS) {
    stats[field] = null
  }
  return stats
}

/**
 * 判断一个 stats 对象是否符合统一字段集合（允许多出平台特定字段）。
 *
 * @param {object} stats
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function validateStatsShape(stats) {
  if (!stats || typeof stats !== 'object') {
    return { ok: false, missing: [...READER_FIELDS] }
  }
  const missing = READER_FIELDS.filter(field => !(field in stats))
  return { ok: missing.length === 0, missing }
}

/**
 * Reader 基类
 *
 * 子类必须实现 readPostStats(post) 并返回符合 READER_FIELDS 的对象或 null。
 * 暂无真实抓取逻辑的平台应：
 *   1. 继承本类
 *   2. 在构造函数中设置 this.isPlaceholder = true
 *   3. readPostStats() 返回 { ...emptyStats(), isPlaceholder: true }
 */
export class BaseReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.isPlaceholder = false
  }

  // eslint-disable-next-line no-unused-vars
  async readPostStats(post) {
    throw new Error('子类必须实现 readPostStats(post)')
  }
}
