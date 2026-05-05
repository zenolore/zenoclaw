import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { READER_SELECTORS } from './selectors.js'

/**
 * 知乎数据读取器
 *
 * 从知乎创作者中心或文章页面读取数据统计
 *
 * 最后验证: 2026-04（基于页面结构推断，需实测验证）
 */

const SELECTORS = READER_SELECTORS

export class ZhihuReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'zhihu'
  }

  /**
   * 读取知乎账号的综合数据
   *
   * 数据来源（2026-05-02 实测）：
   *   - /creator → 账号名 / Lv / 创作分 / 草稿数
   *   - /creator/analytics → 阅读/播放/赞同/喜欢/评论/收藏/分享/转发
   *   - /creator/followers → 关注者总数 / 活跃关注者 / 占比
   *   - /creator/income-analysis → 今日/本周/累计收益 / 创作余额
   *
   * @returns {Promise<object|null>}
   */
  async readAccountStats() {
    const result = {
      account: null,
      content: null,
      followers: null,
      income: null,
      probedAt: new Date().toISOString(),
    }

    // 页面 1：创作主页
    try {
      this.log.info(`[知乎Reader] 创作主页`)
      await this.navigateTo('https://www.zhihu.com/creator')
      await randomDelay(3000, 5000)
      result.account = await this.page.evaluate(() => {
        const text = document.body.innerText || ''
        const lvMatch = text.match(/Lv\s*(\d+)/)
        const creatorScoreMatch = text.match(/创作分\s*(\d+)/)
        const draftMatch = text.match(/草稿箱\s*\(?(\d+)\)?/)
        // 账号名取 "创作中心" 之后第一个非数字段
        const idx = text.indexOf('创作中心')
        let name = ''
        if (idx >= 0) {
          const after = text.slice(idx + '创作中心'.length).trim()
          const firstLine = after.split(/[\s\u3000]+/).find(s => s && !/^\d+$/.test(s) && !s.includes('私信') && !s.includes('消息'))
          name = firstLine || ''
        }
        return {
          accountName: name,
          level: lvMatch ? parseInt(lvMatch[1], 10) : null,
          creatorScore: creatorScoreMatch ? parseInt(creatorScoreMatch[1], 10) : null,
          draftCount: draftMatch ? parseInt(draftMatch[1], 10) : null,
        }
      })
    } catch (e) { this.log.warn(`[知乎Reader] 创作主页失败: ${e.message}`) }

    // 页面 2：内容分析
    try {
      this.log.info(`[知乎Reader] 内容分析`)
      await this.navigateTo('https://www.zhihu.com/creator/analytics')
      await randomDelay(4000, 6000)
      result.content = await this.page.evaluate(() => {
        const text = document.body.innerText || ''
        const grab = (label) => {
          const m = text.match(new RegExp(label + '\\s*[\\s\\S]?\\s*(\\d+(?:\\.\\d+)?)'))
          return m ? parseFloat(m[1]) : null
        }
        return {
          views: grab('阅读总量'),
          plays: grab('播放总量'),
          likes: grab('赞同总量'),
          loves: grab('喜欢总量'),
          comments: grab('评论总量'),
          collects: grab('收藏总量'),
          shares: grab('分享总量'),
          forwards: grab('转发总数'),
        }
      })
    } catch (e) { this.log.warn(`[知乎Reader] 内容分析失败: ${e.message}`) }

    // 页面 3：关注者分析
    try {
      this.log.info(`[知乎Reader] 关注者分析`)
      await this.navigateTo('https://www.zhihu.com/creator/followers')
      await randomDelay(3000, 5000)
      result.followers = await this.page.evaluate(() => {
        const text = document.body.innerText || ''
        const grab = (label) => {
          const m = text.match(new RegExp(label + '[\\s\\S]?\\s*(\\d+(?:\\.\\d+)?)\\s*%?'))
          return m ? parseFloat(m[1]) : null
        }
        const activePctMatch = text.match(/活跃关注者占比[\s\S]?\s*(\d+(?:\.\d+)?)%/)
        return {
          totalFollowers: grab('关注者总数'),
          dailyChange: grab('昨日关注者变化'),
          activeFollowers: grab('活跃关注者'),
          activeFollowerPct: activePctMatch ? parseFloat(activePctMatch[1]) : null,
        }
      })
    } catch (e) { this.log.warn(`[知乎Reader] 关注者分析失败: ${e.message}`) }

    // 页面 4：收益分析
    try {
      this.log.info(`[知乎Reader] 收益分析`)
      await this.navigateTo('https://www.zhihu.com/creator/income-analysis')
      await randomDelay(3000, 5000)
      result.income = await this.page.evaluate(() => {
        const text = document.body.innerText || ''
        const grab = (label) => {
          const m = text.match(new RegExp(label + '[\\s\\S]?\\s*(\\d+(?:\\.\\d+)?)'))
          return m ? parseFloat(m[1]) : null
        }
        return {
          todayIncome: grab('今日收益'),
          weekIncome: grab('本周收益'),
          totalIncome: grab('累计收益'),
          balance: grab('创作余额'),
        }
      })
    } catch (e) { this.log.warn(`[知乎Reader] 收益分析失败: ${e.message}`) }

    return result
  }

  /**
   * 读取单篇文章的统计数据
   * @param {object} post - { post_url, title }
   * @returns {Promise<{views: number, likes: number, comments: number, collects: number}|null>}
   */
  async readPostStats(post) {
    if (!post.post_url) {
      this.log.warn(`[知乎Reader] 帖子 "${post.title}" 无 URL，跳过`)
      return null
    }

    this.log.info(`[知乎Reader] 读取: ${post.title}`)

    try {
      await this.navigateTo(post.post_url)
      await randomDelay(6000, 8000) // 知乎 React feed 需要较长渲染时间

      const stats = await this.page.evaluate(() => {
        const parseNum = (text) => {
          if (!text) return 0
          const clean = text.trim().replace(/[，,\s​]/g, '') // 含零宽空格
          if (clean.includes('万')) return Math.floor(parseFloat(clean) * 10000)
          if (clean.toLowerCase().includes('k')) return Math.floor(parseFloat(clean) * 1000)
          return parseInt(clean.replace(/[^0-9]/g, ''), 10) || 0
        }

        // 实测确认（2026-04）：知乎赞同按钮 aria-label="赞同 N "
        let likes = 0
        for (const btn of document.querySelectorAll('button[aria-label]')) {
          const label = btn.getAttribute('aria-label') || ''
          if (label.includes('赞同')) {
            const m = label.match(/(\d[\d,万k.]+)/i)
            if (m) { likes = parseNum(m[1]); break }
          }
        }

        // 评论按钮文本含"条评论"
        let comments = 0
        for (const btn of document.querySelectorAll('button')) {
          const t = (btn.textContent || '').trim()
          if (t.includes('条评论')) {
            const m = t.match(/(\d[\d,万k.]+)/)
            if (m) { comments = parseNum(m[1]); break }
          }
        }

        return {
          likes,
          comments,
          views: 0,    // 知乎文章页面不直接显示浏览量
          collects: 0, // 收藏数需从创作者中心获取
        }
      })

      return stats
    } catch (err) {
      this.log.warn(`[知乎Reader] 读取 "${post.title}" 失败: ${err.message}`)
      return null
    }
  }

  /**
   * 批量读取所有文章统计
   * 从知乎创作者中心的内容管理页面读取
   */
  async readAllPostStats() {
    const creatorUrl = 'https://www.zhihu.com/creator/content/article'
    this.log.info(`[知乎Reader] 批量读取文章数据`)

    try {
      await this.navigateTo(creatorUrl)
      await randomDelay(3000, 5000)

      const articles = await this.page.evaluate(() => {
        const items = document.querySelectorAll('.ContentItem, .css-1g9n2l4')
        const results = []

        items.forEach(item => {
          const titleEl = item.querySelector('.ContentItem-title a, a[class*="title"]')
          const title = titleEl ? titleEl.textContent.trim() : ''
          const url = titleEl ? titleEl.href : ''

          // 尝试从元素中提取统计数据
          const metaEls = item.querySelectorAll('.ContentItem-meta span, [class*="meta"] span')
          let views = 0, likes = 0, comments = 0

          metaEls.forEach(el => {
            const text = el.textContent.trim()
            if (text.includes('阅读')) views = parseInt(text.replace(/[^0-9]/g, '')) || 0
            if (text.includes('赞同')) likes = parseInt(text.replace(/[^0-9]/g, '')) || 0
            if (text.includes('评论')) comments = parseInt(text.replace(/[^0-9]/g, '')) || 0
          })

          if (title) {
            results.push({ title, url, views, likes, comments, collects: 0 })
          }
        })

        return results
      })

      this.log.info(`[知乎Reader] 读取到 ${articles.length} 篇文章`)
      return articles
    } catch (err) {
      this.log.error(`[知乎Reader] 批量读取失败: ${err.message}`)
      return []
    }
  }
}
