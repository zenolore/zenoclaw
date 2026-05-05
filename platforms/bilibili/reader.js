import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * B站数据读取器
 *
 * 策略 A：创作中心数据页 https://member.bilibili.com/platform/data/article
 * 策略 B：直接访问文章页面读取点赞/评论数
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新
 */

const CREATOR_DATA_URL = 'https://member.bilibili.com/platform/data/article'

export class BilibiliReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'bilibili-reader'
  }

  /**
   * 读取 B 站创作中心账号概览
   *
   * 页面：https://member.bilibili.com/platform/home
   * 实测日期：2026-05-02
   *
   * @returns {Promise<object>}
   */
  async readAccountStats() {
    const url = 'https://member.bilibili.com/platform/home'
    this.log.info('[B站Reader] 读取账号概览')
    try {
      await this.navigateTo(url)
      await randomDelay(4000, 6000)

      return await this.page.evaluate(() => {
        const text = document.body.innerText || ''
        const upDaysMatch = text.match(/成为UP主的第\s*(\d+)\s*天/)
        const messageMatch = text.match(/主站\s+(.+?)\s+\d+\+/)
        return {
          accountName: messageMatch?.[1]?.trim() || null,
          upDays: upDaysMatch ? parseInt(upDaysMatch[1], 10) : null,
          probedAt: new Date().toISOString(),
        }
      })
    } catch (err) {
      this.log.warn(`[B站Reader] 账号概览读取失败：${err.message}`)
      return { error: err.message, probedAt: new Date().toISOString() }
    }
  }

  /**
   * 读取自己作品下的读者评论（用于回评工作流）
   *
   * 页面：https://member.bilibili.com/platform/comment/article
   * 实测日期：2026-05-02
   *
   * 顶部 tab：用户可见评论 / 待精选评论 / 视频评论 / 专栏评论 / 音频评论
   * 单条评论 = .comment-list-item，含 视频标题 + 评论者(.ci-title) + 评论文本 + 日期 + 回复
   *
   * @param {object} [options]
   * @param {number} [options.limit=50]
   * @returns {Promise<Array<{author, videoTitle, content, time}>>}
   */
  async readMyArticleComments(options = {}) {
    const limit = Math.max(1, Math.min(options.limit || 50, 200))
    const url = 'https://member.bilibili.com/platform/comment/article'
    this.log.info(`[B站Reader] 读取评论 (limit=${limit})`)
    try {
      await this.navigateTo(url)
      await randomDelay(5000, 7000)

      return await this.page.evaluate((max) => {
        const items = document.querySelectorAll('.comment-list-item')
        const out = []
        for (const item of items) {
          const author = item.querySelector('.ci-title')?.innerText?.trim() || ''
          const fullText = (item.innerText || '').replace(/\r/g, '')
          const lines = fullText.split('\n').map(s => s.trim()).filter(Boolean)
          // lines 形如：
          //   [0] 视频/专栏标题
          //   [1] 作者名
          //   [2] 评论文本
          //   [3] 日期 + "回复"
          const videoTitle = lines[0] || ''
          // 评论文本：跳过 author，取下一行
          const authorIdx = lines.findIndex(l => l === author)
          const content = (authorIdx >= 0 ? lines[authorIdx + 1] : lines[2]) || ''
          // 时间：找 "YYYY-MM-DD HH:MM:SS" 格式
          const time = (fullText.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/) || [''])[0]

          if (author && content && content !== '回复') {
            out.push({ author, videoTitle, content, time })
          }
          if (out.length >= max) break
        }
        return out
      }, limit)
    } catch (err) {
      this.log.warn(`[B站Reader] 评论读取失败：${err.message}`)
      return []
    }
  }

  /**
   * 读取单篇专栏文章的统计数据
   * @param {object} post - { post_url, title }
   */
  async readPostStats(post) {
    if (post.post_url) {
      return this.readFromPostPage(post.post_url)
    }
    return this.readFromCreatorCenter(post.title)
  }

  /**
   * 策略 A：创作中心批量读取
   */
  async readFromCreatorCenter(postTitle) {
    this.log.info(`[B站Reader] 从创作中心查找: ${postTitle}`)
    await this.navigateTo(CREATOR_DATA_URL)
    await randomDelay(2000, 4000)

    const stats = await this.page.evaluate((title) => {
      const parseNum = (text) => {
        if (!text) return 0
        const clean = text.trim().replace(/[，,\s万]/g, '')
        if (text.includes('万')) return Math.floor(parseFloat(text) * 10000)
        return parseInt(clean, 10) || 0
      }

      // 创作中心文章列表行
      const rows = document.querySelectorAll('tr, .article-item, [class*="article-row"]')
      for (const row of rows) {
        const titleEl = row.querySelector('td:first-child, .title, [class*="title"]')
        if (!titleEl || !titleEl.textContent.includes(title)) continue

        const tds = row.querySelectorAll('td')
        const nums = Array.from(tds).map(td => parseNum(td.textContent)).filter(n => n > 0)
        return { raw_numbers: nums, title: titleEl.textContent.trim() }
      }
      return null
    }, postTitle)

    return stats
  }

  /**
   * 策略 B：直接访问视频/文章页面
   * 实测确认（2026-04）：B站视频页工具栏选择器
   */
  async readFromPostPage(postUrl) {
    this.log.info(`[B站Reader] 访问: ${postUrl}`)
    await this.navigateTo(postUrl)
    await randomDelay(3000, 5000)

    const stats = await this.page.evaluate(() => {
      const parseNum = (text) => {
        if (!text) return 0
        const clean = text.trim()
        if (clean.includes('万')) return Math.floor(parseFloat(clean) * 10000)
        if (clean.toLowerCase().includes('k')) return Math.floor(parseFloat(clean) * 1000)
        return parseInt(clean.replace(/[^0-9]/g, ''), 10) || 0
      }

      const getText = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel)
          if (el) {
            const t = el.textContent.trim()
            if (t && /\d/.test(t)) return parseNum(t)
          }
        }
        return null
      }

      return {
        // 播放量：视频页顶部统计区
        views: getText([
          '.view-text',
          '[class*="view-count"]',
          '.read-info-item .num',
        ]),
        // 点赞：工具栏 video-like-info（实测 "126.5万"）
        likes: getText([
          '.video-like-info.video-toolbar-item-text',
          '.video-like .video-toolbar-item-text',
          '[class*="like-info"]',
        ]),
        // 投币
        coins: getText([
          '.video-coin-info.video-toolbar-item-text',
          '.video-coin .video-toolbar-item-text',
        ]),
        // 收藏
        collects: getText([
          '.video-fav-info.video-toolbar-item-text',
          '.video-fav .video-toolbar-item-text',
        ]),
        // 分享
        shares: getText([
          '.video-share-info.video-toolbar-item-text',
          '.video-share .video-toolbar-item-text',
        ]),
      }
    })

    return stats
  }

  /**
   * 批量读取创作中心所有文章数据
   */
  async readAllPostStats() {
    this.log.info('[B站Reader] 批量读取创作中心数据')
    await this.navigateTo(CREATOR_DATA_URL)
    await randomDelay(3000, 5000)

    await this.scroll()
    await randomDelay(1000, 2000)

    return this.page.evaluate(() => {
      const parseNum = (text) => {
        if (!text) return 0
        if (text.includes('万')) return Math.floor(parseFloat(text) * 10000)
        return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0
      }

      const results = []
      const rows = document.querySelectorAll('tr, [class*="article-item"]')
      for (const row of rows) {
        const titleEl = row.querySelector('td:first-child, [class*="title"]')
        if (!titleEl) continue
        const title = titleEl.textContent.trim()
        if (!title) continue
        const nums = Array.from(row.querySelectorAll('td'))
          .map(td => parseNum(td.textContent)).filter(n => n > 0)
        results.push({ title, raw_numbers: nums })
      }
      return results
    })
  }
}
