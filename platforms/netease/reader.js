import { BaseReader, emptyStats } from '../reader-base.js'

/**
 * 网易号 数据采集骨架
 *
 * 当前为占位实现：返回所有统一字段为 null。
 * 真实采集逻辑待补：需要在网易号后台抓取阅读、点赞、评论
 */
export class NeteaseReader extends BaseReader {
  constructor(page) {
    super(page)
    this.platformName = 'netease-reader'
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

export default NeteaseReader
