import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 头条号数据读厸 — 【✅ 账号级采集已实测 2026-05-02 / 文章级采集待实测】
 *
 * ============================================
 *  readAccountStats()  → 实测过，选择器准确
 *  readPostStats()     → 未实测，selector 仍是推断+正则兼底策略
 * ============================================
 *
 * ✅ 已完成（代码层面）：
 *   - CLI bridge: zenoclaw/sdk/read-post-stats.js → puppeteer.connect(9222) → loadReader('toutiao')
 *   - 前台页抓取：按 post_url 导航 → page.evaluate 用正则从 body.innerText 匹配"阅读/点赞/评论"
 *   - 后台回退：/profile_v4/graphic/articles 按标题匹配行
 *   - article-factory server 的 POST /action/fetch-stats endpoint 已接入
 *   - 前端"📊 待抓取"按钮已绑定 fetchPublishStats()
 *
 * ❓ 未验证（需要真实 Chrome 9222 + 登录态实跑）：
 *   - 头条前台 URL 格式（/article/{id} vs /group/{id} vs /w/a/{id}）哪种能稳定打开
 *   - 前台页是否真的显示"阅读 xxx"字样（可能只显示在创作者后台）
 *   - 后台 DOM 结构（目前是通用 tr/row/item/card 扫描，不是针对头条的精确 selector）
 *   - 登录态 cookie 是否在 Chrome profile 里真的持久（发帖走过一次说明基本 OK）
 *   - 数字解析的边界（"1.2w" / "12,345" / "3.4万"）— 正则已考虑，未实测
 *
 * 🔧 首次调试步骤：
 *   1. cd c:\Zeno-Growth-System\zenoclaw
 *   2. node sdk/read-post-stats.js --platform toutiao --url "已发布文章URL" --port 9222
 *   3. 看 stdout：返回 {views,likes,comments,collects} 或 {_error,...}
 *   4. 若 _error 或 null 字段多 → 浏览器 F12 手动找正确 selector → 回来补 _readFromPostPage
 *
 * 策略：
 *   优先从已发布文章的前台页面读取 → 失败回退到创作者后台
 *   DOM 选择器走"多候选 + 正则兜底"，减少平台改版导致的失效
 */
export class ToutiaoReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'toutiao'
  }

  /**
   * 读取头条账号的总体统计数据（粉丝数 / 总阅读量 / 累计收益等）
   *
   * 选择器来源：2026-05-02 在用户已登录的 Chrome 9222 里实测 mp.toutiao.com/profile_v4/index。
   *
   * 页面 DOM 结构：
   *   .data-board-item                单张数据卡容器
   *     .data-board-item-title        卡片标题（'粉丝数'/'总阅读(播放)量'/'累计收益'）
   *     .data-board-item-primary      主数字（30字以内）
   *     .data-board-item-secondary    副信息（'昨日无变化'/'昨日 +N'）
   *
   * @returns {Promise<{fans, totalViews, totalIncome, rawCards, cardTitles}|null>}
   */
  async readAccountStats() {
    const dashUrl = 'https://mp.toutiao.com/profile_v4/index'
    this.log.info(`[头条Reader] 读取账号统计：${dashUrl}`)
    try {
      await this.navigateTo(dashUrl)
      await randomDelay(3000, 5000)

      return await this.page.evaluate(() => {
        const parseNum = (text) => {
          if (!text) return null
          const clean = String(text).replace(/[，,\s元]/g, '')
          if (!clean) return null
          if (/[万wW]/.test(clean)) return Math.floor(parseFloat(clean) * 10000)
          if (/[kK]/.test(clean)) return Math.floor(parseFloat(clean) * 1000)
          const n = parseFloat(clean.replace(/[^0-9.]/g, ''))
          return isNaN(n) ? null : n
        }

        const cards = {}
        document.querySelectorAll('.data-board-item').forEach(item => {
          const title = item.querySelector('.data-board-item-title')?.innerText?.trim() || ''
          const primary = item.querySelector('.data-board-item-primary')?.innerText?.trim() || ''
          const secondary = item.querySelector('.data-board-item-secondary')?.innerText?.trim() || ''
          if (title) cards[title] = { value: primary, delta: secondary, parsed: parseNum(primary) }
        })

        return {
          fans:        cards['粉丝数']?.parsed ?? null,
          totalViews:  cards['总阅读(播放)量']?.parsed ?? cards['总阅读量']?.parsed ?? null,
          totalIncome: cards['累计收益']?.parsed ?? null,
          rawCards: cards,
          cardTitles: Object.keys(cards),
          probedAt: new Date().toISOString(),
        }
      })
    } catch (err) {
      this.log.warn(`[头条Reader] 账号统计读取失败：${err.message}`)
      return null
    }
  }

  /**
   * 读取自己文章下的读者评论（用于回评工作流）
   *
   * 页面：https://mp.toutiao.com/profile_v4/manage/comment/all
   * 选择器来源：2026-05-02 实测
   *
   * @param {object} [options]
   * @param {string} [options.filter='all']  '全部' / '文章' / '视频' / '微头条'
   * @param {number} [options.limit=50]      最多返回多少条
   * @returns {Promise<Array<{author, articleTitle, articleType, content, timer, hasReplyButton}>>}
   */
  async readMyArticleComments(options = {}) {
    const filterMap = { all: '全部', article: '文章', video: '视频', weitoutiao: '微头条' }
    const filterText = filterMap[options.filter || 'all'] || '全部'
    const limit = Math.max(1, Math.min(options.limit || 50, 200))

    const url = 'https://mp.toutiao.com/profile_v4/manage/comment/all'
    this.log.info(`[头条Reader] 读取自己文章下的评论 (filter=${filterText}, limit=${limit})`)

    try {
      await this.navigateTo(url)
      await randomDelay(3000, 5000)

      // 切换过滤 tab（如果不是默认全部）
      if (filterText !== '全部') {
        await this.page.evaluate((targetText) => {
          const tabs = document.querySelectorAll('.byte-tabs-header-title')
          for (const tab of tabs) {
            if ((tab.innerText || '').trim() === targetText) {
              tab.click()
              return true
            }
          }
          return false
        }, filterText).catch(() => false)
        await randomDelay(2000, 3000)
      }

      // 抓取评论列表
      return await this.page.evaluate((max) => {
        const items = document.querySelectorAll('.comment-item')
        const out = []
        for (const item of items) {
          const author = item.querySelector('.comment-item-title')?.innerText?.trim() || ''
          const headerExtra = item.querySelector('.comment-item-header-extra')?.innerText?.trim() || ''
          // headerExtra 形如 "评论了微头条 《标题》" or "评论了图文 《标题》"
          const articleType = (headerExtra.match(/评论了(\S+)\s*《/)?.[1]) || ''
          const articleTitle = item.querySelector('.comment-item-header-extra .extra-title')?.innerText?.trim()?.replace(/^《|》$/g, '') || ''
          const content = item.querySelector('.comment-item-content-wrap')?.innerText?.trim() || ''
          const timer = item.querySelector('.comment-item-timer')?.innerText?.trim() || ''

          // 是否已显示回复按钮（有时已回复过会显示"取消回复"）
          let hasReplyButton = false
          const actions = item.querySelectorAll('.comment-item-actions-item')
          for (const a of actions) {
            if ((a.innerText || '').trim() === '回复') { hasReplyButton = true; break }
          }

          if (author && content) {
            out.push({ author, articleType, articleTitle, content, timer, hasReplyButton })
          }
          if (out.length >= max) break
        }
        return out
      }, limit)
    } catch (err) {
      this.log.warn(`[头条Reader] 读取评论失败：${err.message}`)
      return []
    }
  }

  /**
   * 读取单篇文章的统计数据
   * @param {object} post - { post_url?, title }
   * @returns {Promise<{views, likes, comments, collects}|null>}
   */
  async readPostStats(post) {
    if (post.post_url) {
      const fromUrl = await this._readFromPostPage(post.post_url)
      if (fromUrl && (fromUrl.views || fromUrl.likes || fromUrl.comments)) {
        return fromUrl
      }
      this.log.info(`[头条Reader] post_url 未拿到数据，尝试创作者后台`)
    }
    if (post.title) {
      return this._readFromDashboard(post.title)
    }
    this.log.warn(`[头条Reader] 帖子缺少 URL 和标题，跳过`)
    return null
  }

  /**
   * 策略 A：直接访问前台文章页
   */
  async _readFromPostPage(postUrl) {
    this.log.info(`[头条Reader] 前台页访问: ${postUrl}`)
    try {
      await this.navigateTo(postUrl)
      await randomDelay(3000, 5000)

      return await this.page.evaluate(() => {
        const parseNum = (text) => {
          if (!text) return null
          const clean = String(text).trim().replace(/[，,\s]/g, '')
          if (!clean) return null
          if (clean.includes('万') || clean.toLowerCase().includes('w')) {
            return Math.floor(parseFloat(clean) * 10000)
          }
          if (clean.toLowerCase().includes('k')) {
            return Math.floor(parseFloat(clean) * 1000)
          }
          const n = parseInt(clean.replace(/[^0-9]/g, ''), 10)
          return isNaN(n) ? null : n
        }

        // 头条前台常见字段 label
        const bodyText = document.body.innerText || ''

        // 模式 1：在整个页面文本里找 "阅读 xxx" / "浏览 xxx" / "xxx阅读"
        const grab = (patterns) => {
          for (const pat of patterns) {
            const m = bodyText.match(pat)
            if (m && m[1]) return parseNum(m[1])
          }
          return null
        }

        const views = grab([
          /阅读[量数]?[:：\s]*([0-9.]+[万wWkK]?)/,
          /([0-9.]+[万wWkK]?)[\s]*阅读/,
          /浏览[:：\s]*([0-9.]+[万wWkK]?)/,
        ])

        // 模式 2：点赞按钮附近查数字
        let likes = null
        const likeSelectors = [
          '[class*="digg"] [class*="count"]',
          '[class*="like"] [class*="count"]',
          '[aria-label*="点赞"]',
          '[data-action="digg"]',
        ]
        for (const sel of likeSelectors) {
          const el = document.querySelector(sel)
          if (el) {
            const n = parseNum(el.textContent || el.getAttribute('aria-label'))
            if (n != null) { likes = n; break }
          }
        }
        if (likes == null) {
          likes = grab([/([0-9.]+[万wWkK]?)[\s]*点赞/, /点赞[:：\s]*([0-9.]+[万wWkK]?)/])
        }

        let comments = null
        const commentSelectors = [
          '[class*="comment"] [class*="count"]',
          '[aria-label*="评论"]',
        ]
        for (const sel of commentSelectors) {
          const el = document.querySelector(sel)
          if (el) {
            const n = parseNum(el.textContent || el.getAttribute('aria-label'))
            if (n != null) { comments = n; break }
          }
        }
        if (comments == null) {
          comments = grab([/([0-9.]+[万wWkK]?)[\s]*评论/, /评论[:：\s]*([0-9.]+[万wWkK]?)/])
        }

        return {
          views,
          likes,
          comments,
          collects: null,  // 头条无公开收藏数
        }
      })
    } catch (err) {
      this.log.warn(`[头条Reader] 前台页读取失败: ${err.message}`)
      return null
    }
  }

  /**
   * 策略 B：创作者后台文章列表，按标题匹配
   *
   * 后台 URL: https://mp.toutiao.com/profile_v4/graphic/articles
   * （注意需已登录创作者账号）
   */
  async _readFromDashboard(title) {
    const dashUrl = 'https://mp.toutiao.com/profile_v4/graphic/articles'
    this.log.info(`[头条Reader] 后台按标题匹配: "${title}"`)
    try {
      await this.navigateTo(dashUrl)
      await randomDelay(4000, 6000)

      return await this.page.evaluate((targetTitle) => {
        const parseNum = (text) => {
          if (!text) return null
          const clean = String(text).trim().replace(/[，,\s]/g, '')
          if (!clean) return null
          if (clean.includes('万') || clean.toLowerCase().includes('w')) {
            return Math.floor(parseFloat(clean) * 10000)
          }
          if (clean.toLowerCase().includes('k')) {
            return Math.floor(parseFloat(clean) * 1000)
          }
          const n = parseInt(clean.replace(/[^0-9]/g, ''), 10)
          return isNaN(n) ? null : n
        }

        // 后台文章条目通常用 table row 或 card。
        // 兼容多种 DOM：查含目标标题的最近父容器，在容器内找数字字段。
        const all = document.querySelectorAll('tr, [class*="row"], [class*="item"], [class*="card"]')
        for (const row of all) {
          const text = row.innerText || ''
          if (!text.includes(targetTitle)) continue

          // 从 row 文本里按字段名抓数字
          const grab = (patterns) => {
            for (const pat of patterns) {
              const m = text.match(pat)
              if (m && m[1]) return parseNum(m[1])
            }
            return null
          }

          return {
            views: grab([/阅读[量数]?[:：\s]*([0-9.]+[万wWkK]?)/]),
            likes: grab([/点赞[:：\s]*([0-9.]+[万wWkK]?)/]),
            comments: grab([/评论[:：\s]*([0-9.]+[万wWkK]?)/]),
            collects: grab([/收藏[:：\s]*([0-9.]+[万wWkK]?)/]),
          }
        }

        return { views: null, likes: null, comments: null, collects: null, _error: '未匹配到标题' }
      }, title)
    } catch (err) {
      this.log.warn(`[头条Reader] 后台读取失败: ${err.message}`)
      return null
    }
  }
}
