import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 即刻数据读取器
 *
 * 策略：直接访问动态详情页读取点赞/评论数
 * 即刻动态 URL 格式: https://web.okjike.com/originalPost/{postId}
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新
 */

export class JikeReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'jike-reader'
  }

  /**
   * 读取单条即刻动态统计数据
   * @param {object} post - { post_url, title }
   */
  async readPostStats(post) {
    if (!post.post_url) {
      this.log.warn(`[即刻Reader] "${post.title}" 无 URL，跳过`)
      return null
    }
    return this.readFromPostPage(post.post_url)
  }

  /**
   * 访问动态详情页读取数据
   */
  async readFromPostPage(postUrl) {
    this.log.info(`[即刻Reader] 访问: ${postUrl}`)
    await this.navigateTo(postUrl)
    await randomDelay(2000, 4000)

    // 实测说明（2026-04）：即刻 web.okjike.com 使用 React 虚拟渲染
    // 互动数字（点赞/评论）使用 CSS Module hash 类名，无法用稳定选择器定位
    // web 端只能通过 Jike API（需 Bearer Token）获取精确数据
    // 此处返回 null，上层可降级到 API 方案
    this.log.warn('[即刻Reader] web端 CSS Module hash 类名不稳定，无法可靠读取，建议改用 API')

    const stats = await this.page.evaluate(() => {
      // 尝试扫描页面所有可见纯数字 span（最大努力，不保证准确）
      const nums = []
      for (const el of document.querySelectorAll('span')) {
        const t = (el.textContent || '').trim()
        if (/^\d+$/.test(t) && parseInt(t) >= 0 && el.offsetWidth > 0) {
          nums.push(parseInt(t, 10))
        }
      }
      // 无法区分点赞/评论/转发，全部返回 null
      return {
        views: null,
        likes: null,
        comments: null,
        reposts: null,
        _raw_nums: nums.slice(0, 10), // 调试用
        _note: 'Jike web 端 CSS Module hash 类名不稳定，无法可靠读取',
      }
    })

    return stats
  }
}
