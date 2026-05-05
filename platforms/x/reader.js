import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * X (Twitter) 数据读取器
 *
 * 策略：直接访问推文页面读取互动数据
 * 推文 URL 格式: https://x.com/{user}/status/{id}
 *
 * X 使用 data-testid 属性定位元素（较稳定）
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新
 */

export class XReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'x-reader'
  }

  /**
   * 读取单条推文的统计数据
   * @param {object} post - { post_url, title }
   */
  async readPostStats(post) {
    if (!post.post_url) {
      this.log.warn(`[X Reader] "${post.title}" 无 URL，跳过`)
      return null
    }
    return this.readFromPostPage(post.post_url)
  }

  /**
   * 访问推文页面读取数据
   */
  async readFromPostPage(postUrl) {
    this.log.info(`[X Reader] 访问: ${postUrl}`)
    await this.navigateTo(postUrl)
    await randomDelay(2000, 4000)

    const stats = await this.page.evaluate(() => {
      const parseNum = (text) => {
        if (!text) return 0
        const clean = text.trim().toLowerCase().replace(/,/g, '')
        if (clean.includes('k')) return Math.floor(parseFloat(clean) * 1000)
        if (clean.includes('m')) return Math.floor(parseFloat(clean) * 1000000)
        return parseInt(clean.replace(/[^0-9]/g, ''), 10) || 0
      }

      // 实测确认（2026-04）：X 推文详情页
      // [data-testid="reply/retweet/like/bookmark"] span → 直接包含数字
      const getTestId = (testId) => {
        const el = document.querySelector(`[data-testid="${testId}"] span`)
        return el ? parseNum(el.textContent) : null
      }

      // 浏览量：analytics 链接 span（实测 "44.4M"）
      const viewsEl = document.querySelector('[href*="/analytics"] span')
      const views = viewsEl ? parseNum(viewsEl.textContent) : null

      return {
        views,
        replies: getTestId('reply'),
        retweets: getTestId('retweet'),
        likes: getTestId('like'),
        bookmarks: getTestId('bookmark'),
      }
    })

    return stats
  }
}
