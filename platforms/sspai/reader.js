import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 少数派数据读取器
 *
 * 策略：直接访问文章页面读取点赞/评论数
 * 文章 URL 格式: https://sspai.com/post/{id}
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新
 */

export class SspaiReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'sspai-reader'
  }

  /**
   * 读取单篇少数派文章统计数据
   * @param {object} post - { post_url, title }
   */
  async readPostStats(post) {
    if (!post.post_url) {
      this.log.warn(`[少数派Reader] "${post.title}" 无 URL，跳过`)
      return null
    }
    return this.readFromPostPage(post.post_url)
  }

  /**
   * 访问文章页面读取数据
   */
  async readFromPostPage(postUrl) {
    this.log.info(`[少数派Reader] 访问: ${postUrl}`)
    await this.navigateTo(postUrl)
    await randomDelay(2000, 4000)

    const stats = await this.page.evaluate(() => {
      const parseNum = (text) => {
        if (!text) return 0
        const clean = text.trim()
        if (clean.includes('k') || clean.includes('K')) return Math.floor(parseFloat(clean) * 1000)
        return parseInt(clean.replace(/[^0-9]/g, ''), 10) || 0
      }

      // 实测确认（2026-04）：少数派文章右侧工具栏
      // .item-wrapper .count：第[0]个=点赞，第[1]个=评论/其他
      // [class*="ArticleSide"] 包含整个右侧互动区
      const countEls = document.querySelectorAll('.item-wrapper .count')
      const likes = countEls[0] ? parseNum(countEls[0].textContent) : null
      const comments = countEls[1] ? parseNum(countEls[1].textContent) : null

      // [class*="like"] 也能直接命中点赞数
      const likeEl = document.querySelector('[class*="ArticleSide"] [class*="like"]')
      const likeFallback = likeEl ? parseNum(likeEl.textContent) : null

      return {
        views: null, // 少数派文章页不显示阅读量
        likes: likes ?? likeFallback,
        comments,
        collects: null,
      }
    })

    return stats
  }
}
