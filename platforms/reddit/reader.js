import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * Reddit 数据读取器
 *
 * 策略：直接访问帖子 URL 读取 upvotes/comments
 * 帖子 URL 格式: https://www.reddit.com/r/{sub}/comments/{id}/...
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新
 */

export class RedditReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'reddit-reader'
  }

  /**
   * 读取单条 Reddit 帖子统计数据
   * @param {object} post - { post_url, title }
   */
  async readPostStats(post) {
    if (!post.post_url) {
      this.log.warn(`[RedditReader] "${post.title}" 无 URL，跳过`)
      return null
    }
    return this.readFromPostPage(post.post_url)
  }

  /**
   * 访问帖子页面读取数据
   */
  async readFromPostPage(postUrl) {
    this.log.info(`[RedditReader] 访问: ${postUrl}`)
    await this.navigateTo(postUrl)
    await randomDelay(2000, 4000)

    const stats = await this.page.evaluate(() => {
      const toNum = (s) => {
        if (!s) return null
        const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
        return isNaN(n) ? null : n
      }

      // 实测确认（2026-04）：Reddit 新版使用 shreddit-post web component
      // 帖子统计数据直接存储在 shreddit-post 元素的 HTML 属性中
      const post = document.querySelector('shreddit-post')
      if (post) {
        return {
          views: null, // Reddit 不公开阅读量
          upvotes: toNum(post.getAttribute('score')),
          comments: toNum(post.getAttribute('comment-count')),
          awards: toNum(post.getAttribute('award-count')),
        }
      }

      // 兜底：Old Reddit
      const scoreEl = document.querySelector('.score.unvoted, .score.likes, .score.dislikes')
      return {
        views: null,
        upvotes: scoreEl ? toNum(scoreEl.textContent) : null,
        comments: null,
        awards: null,
      }
    })

    return stats
  }
}
