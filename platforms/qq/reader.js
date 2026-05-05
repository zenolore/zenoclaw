import { BaseReader, emptyStats } from '../reader-base.js'

/**
 * 企鹅号 数据采集骨架
 *
 * 当前为占位实现：返回所有统一字段为 null。
 * 真实采集逻辑待补：需要在企鹅号后台抓取阅读、点赞、评论
 */
export class QqReader extends BaseReader {
  constructor(page) {
    super(page)
    this.platformName = 'qq-reader'
    this.isPlaceholder = true
  }

  async readPostStats(post) {
    this.log.warn(`[${this.platformName}] 暂未实现真实数据采集，返回空字段（标题: ${(post && post.title) || '(unknown)'}）`)
    return { ...emptyStats(), isPlaceholder: true }
  }

  async readAllPostStats() {
    this.log.warn(`[${this.platformName}] 暂未实现批量数据采集，返回空数组`)
    return []
  }
}

export default QqReader
