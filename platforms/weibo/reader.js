import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 微博数据读取器
 *
 * 策略 A：直接访问帖子 URL（帖子详情页显示转发/评论/点赞）
 * 策略 B：访问个人主页批量读取（需 uid）
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新
 */

export class WeiboReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'weibo-reader'
  }

  /**
   * 读取单条微博统计数据
   * @param {object} post - { post_url, title }
   */
  async readPostStats(post) {
    if (!post.post_url) {
      this.log.warn(`[微博Reader] "${post.title}" 无 URL，跳过`)
      return null
    }
    return this.readFromPostPage(post.post_url)
  }

  /**
   * 直接访问微博帖子页面读取数据
   */
  async readFromPostPage(postUrl) {
    this.log.info(`[微博Reader] 访问: ${postUrl}`)
    await this.navigateTo(postUrl)
    await randomDelay(2000, 4000)

    const stats = await this.page.evaluate(() => {
      const parseNum = (text) => {
        if (!text) return 0
        const clean = text.trim().replace(/[，,\s]/g, '')
        if (clean.includes('万')) return Math.floor(parseFloat(clean) * 10000)
        return parseInt(clean, 10) || 0
      }

      // 实测确认（2026-04）：微博新版操作栏无 action-type 属性
      // .woo-like-count 按固定顺序出现：[0]=转发 [1]=评论 [2]=点赞
      // 首先找到当前帖子（详情页或 feed 第一条）的操作栏
      const allCounts = document.querySelectorAll('.woo-like-count')
      const counts = Array.from(allCounts)

      return {
        views: null, // 微博不公开阅读量
        reposts: counts[0] ? parseNum(counts[0].textContent) : null,
        comments: counts[1] ? parseNum(counts[1].textContent) : null,
        likes: counts[2] ? parseNum(counts[2].textContent) : null,
      }
    })

    return stats
  }
}
