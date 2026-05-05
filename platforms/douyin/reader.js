import { BaseReader, emptyStats } from '../reader-base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 抖音数据读取器
 *
 * 选择器来源：2026-05-02 在用户已登录的 Chrome 9222 中实测
 *
 * 已实现：
 *   readAccountStats() - 从创作者后台首页读取关注/粉丝/获赞 3 个统计数
 *
 * 待实现（需要账号有评论才能补结构）：
 *   readMyArticleComments() - 评论管理页需要先选择作品，当前作品评论为 0
 */
export class DouyinReader extends BaseReader {
  constructor(page) {
    super(page)
    this.platformName = 'douyin-reader'
    this.isPlaceholder = true
  }

  /**
   * 读取抖音账号的总体数据（关注/粉丝/获赞）
   *
   * 页面：https://creator.douyin.com/creator-micro/home
   * 实测：首页右上有 3 张 .statics-item-* 卡片
   *
   * @returns {Promise<{following, fans, likes, rawCards, cardTitles, probedAt}|null>}
   */
  async readAccountStats() {
    const url = 'https://creator.douyin.com/creator-micro/home'
    this.log.info(`[抖音Reader] 读取账号统计：${url}`)
    try {
      await this.navigateTo(url)
      await randomDelay(4000, 6000)

      return await this.page.evaluate(() => {
        const parseNum = (text) => {
          if (!text) return null
          const m = String(text).match(/([0-9]+(?:\.[0-9]+)?)\s*([万wWkK亿]?)/)
          if (!m) return null
          let n = parseFloat(m[1])
          if (/[万w]/i.test(m[2])) n *= 10000
          else if (/[亿]/.test(m[2])) n *= 100000000
          else if (/[k]/i.test(m[2])) n *= 1000
          return Math.floor(n)
        }

        // 首页 3 个 statics-item 卡片包含 "关注 N" / "粉丝 N" / "获赞 N"
        const items = document.querySelectorAll('[class*="statics-item"]')
        const rawCards = {}
        for (const item of items) {
          const text = (item.innerText || '').replace(/\s+/g, ' ').trim()
          // 形如 "关注 144" / "粉丝 573" / "获赞 7301"
          const m = text.match(/^(关注|粉丝|获赞)\s+([0-9.]+[万亿wWkK]?)/)
          if (m) {
            rawCards[m[1]] = { value: parseNum(m[2]), rawText: text }
          }
        }

        return {
          following: rawCards['关注']?.value ?? null,
          fans: rawCards['粉丝']?.value ?? null,
          likes: rawCards['获赞']?.value ?? null,
          rawCards,
          cardTitles: Object.keys(rawCards),
          probedAt: new Date().toISOString(),
        }
      })
    } catch (err) {
      this.log.warn(`[抖音Reader] 账号统计读取失败：${err.message}`)
      return null
    }
  }

  async readPostStats(post) {
    this.log.warn(`[${this.platformName}] 单篇文章统计未实现（需在视频详情页抓取播放/赞/评/转），返回空字段`)
    return { ...emptyStats(), isPlaceholder: true }
  }

  async readAllPostStats() {
    this.log.warn(`[${this.platformName}] 批量数据采集未实现，返回空数组`)
    return []
  }
}

export default DouyinReader
