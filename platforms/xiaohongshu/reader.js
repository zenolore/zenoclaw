import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 小红书数据读取器
 *
 * 实测确认（2026-04）：
 * - 直接访问 /explore/{postId} URL → 自动打开帖子模态框
 * - 模态框底部 engage-bar 包含完整数据：点赞/收藏/评论
 * - 无帖子 URL 时：搜索标题 → 点击第一条匹配结果 → 读取模态框数据
 *
 * 模态框选择器（实测稳定）：
 *   .engage-bar .like-wrapper .count    → 点赞数
 *   .engage-bar .collect-wrapper .count → 收藏数
 *   .engage-bar .chat-wrapper .count    → 评论数
 */

export class XiaohongshuReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'xiaohongshu-reader'
  }

  /**
   * 读取单条帖子的统计数据
   * @param {object} post - { post_url?, title }
   * @returns {Promise<{views, likes, comments, collects}|null>}
   */
  async readPostStats(post) {
    if (post.post_url) {
      return this.readFromPostPage(post.post_url)
    }
    if (post.title) {
      return this.readBySearch(post.title)
    }
    this.log.warn('[XHS Reader] 帖子缺少 URL 和标题，跳过')
    return null
  }

  /**
   * 策略 A：直接访问帖子 URL（推荐）
   *
   * 小红书帖子 URL 格式：
   *   https://www.xiaohongshu.com/explore/{noteId}
   * 直接访问后会自动弹出模态框，engage-bar 包含完整数据
   */
  async readFromPostPage(postUrl) {
    this.log.info(`[XHS Reader] 访问: ${postUrl}`)
    await this.navigateTo(postUrl)
    await randomDelay(4000, 6000)

    return this._readEngageBar()
  }

  /**
   * 策略 B：搜索标题 → 拦截 API 响应获取 xsec_token → strategy A 方式访问
   *
   * 实测确认（2026-04）：
   * - XHS 搜索 API: edith.xiaohongshu.com/api/sns/web/v1/search/notes
   *   返回含 xsec_token 的 note 列表（每次约 20-22 条）
   * - 直接 navigate 帖子 URL（无 token）会被重定向到 /explore root
   * - 拦截 API 获取 token 后，通过 strategy A 方式访问 100% 可靠
   */
  async readBySearch(postTitle) {
    this.log.info(`[XHS Reader] 搜索: "${postTitle}"`)

    // 网络拦截方案：监听 XHS search API 响应，提取 note_id + xsec_token
    // XHS 搜索 API: /api/sns/web/v1/search/notes 返回含 xsec_token 的笔记列表
    const capturedUrls = []
    const onResponse = async (response) => {
      const url = response.url()
      if (!url.includes('/api/sns/web') && !url.includes('xhs')) return
      if (!url.includes('search')) return
      try {
        const json = await response.json().catch(() => null)
        if (!json) return
        // 尝试多层路径提取 items
        const items = json?.data?.items || json?.items || []
        for (const item of items) {
          const noteId = item?.id || item?.note_id || item?.note?.id
          const token = item?.xsec_token || item?.note?.xsec_token
          if (noteId && token) {
            capturedUrls.push(`https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${token}&xsec_source=pc_search`)
          }
        }
      } catch (_) { /* ignore parse errors */ }
    }
    this.page.on('response', onResponse)

    try {
      // 从探索页键盘搜索
      await this.navigateTo('https://www.xiaohongshu.com/explore')
      await randomDelay(2000, 3000)

      const input = await this.page.$('input[placeholder*="搜索"]')
      if (!input) {
        this.log.warn('[XHS Reader] 未找到搜索框')
        return null
      }
      await input.click()
      await randomDelay(300, 500)
      await this.page.keyboard.type(postTitle)
      await randomDelay(500, 800)
      await this.page.keyboard.press('Enter')
      await randomDelay(4000, 5000) // 等待 API 响应完成
      this.log.info(`[XHS Reader] 捕获到 ${capturedUrls.length} 条 URL`)

      if (capturedUrls.length > 0) {
        this.log.info(`[XHS Reader] 使用 API URL: ${capturedUrls[0].substring(0, 80)}`)
        // 用完整 URL 直接导航（strategy A，100% 可靠）
        await this.navigateTo(capturedUrls[0])
        await randomDelay(4000, 6000)
        return this._readEngageBar()
      }

      // Fallback：无 API 拦截时，尝试读取当前搜索结果页的 engage-bar
      this.log.warn('[XHS Reader] 未捕获到 API URL，使用 fallback')
      try {
        await this.page.waitForSelector('.engage-bar', { timeout: 5000 })
      } catch (_) { /* ignore */ }
      return this._readEngageBar()
    } finally {
      this.page.off('response', onResponse)
    }
  }

  /**
   * 从当前已打开的模态框 engage-bar 读取数据
   *
   * 实测确认（2026-04）：
   *   .engage-bar .like-wrapper .count    → 点赞数（如 "107"）
   *   .engage-bar .collect-wrapper .count → 收藏数（如 "111"）
   *   .engage-bar .chat-wrapper .count    → 评论数（如 "30"）
   */
  async _readEngageBar() {
    const stats = await this.page.evaluate(() => {
      const parseNum = (text) => {
        if (!text) return null
        const clean = text.trim()
        if (clean.includes('万') || clean.toLowerCase().includes('w')) {
          return Math.floor(parseFloat(clean) * 10000)
        }
        if (clean.toLowerCase().includes('k')) {
          return Math.floor(parseFloat(clean) * 1000)
        }
        const n = parseInt(clean.replace(/[^0-9]/g, ''), 10)
        return isNaN(n) ? null : n
      }

      const bar = document.querySelector('.engage-bar')
      if (!bar) return { views: null, likes: null, collects: null, comments: null, _error: 'engage-bar not found' }

      const likeEl = bar.querySelector('.like-wrapper .count')
      const collectEl = bar.querySelector('.collect-wrapper .count')
      const chatEl = bar.querySelector('.chat-wrapper .count')

      return {
        views: null, // 小红书不显示阅读量
        likes: parseNum(likeEl ? likeEl.textContent : null),
        collects: parseNum(collectEl ? collectEl.textContent : null),
        comments: parseNum(chatEl ? chatEl.textContent : null),
      }
    })

    if (stats._error) {
      this.log.warn(`[XHS Reader] ${stats._error}`)
    }
    return stats
  }

  /**
   * 批量读取：通过搜索逐条读取帖子数据
   * @param {Array<{title: string, post_url?: string}>} posts
   */
  async readAllPostStats(posts = []) {
    this.log.info(`[XHS Reader] 批量读取 ${posts.length} 条帖子`)
    const results = []
    for (const post of posts) {
      try {
        const stats = await this.readPostStats(post)
        results.push({ title: post.title, url: post.post_url, ...stats })
      } catch (err) {
        this.log.warn(`[XHS Reader] "${post.title}" 失败: ${err.message}`)
        results.push({ title: post.title, url: post.post_url, error: err.message })
      }
      await randomDelay(2000, 4000)
    }
    return results
  }
}
