import { BaseReader, emptyStats } from '../reader-base.js'

/**
 * Product Hunt 数据采集骨架
 *
 * 当前为占位实现：返回所有统一字段为 null。
 * 真实采集逻辑待补：需要从 Product Hunt 帖子页抓 upvote、comment
 */
export class ProducthuntReader extends BaseReader {
  constructor(page) {
    super(page)
    this.platformName = 'producthunt-reader'
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

export default ProducthuntReader
