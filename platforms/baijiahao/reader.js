import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 百家号数据读取器 — 【🚧 EXPERIMENTAL / 2026-04-18】
 *
 * ============================================
 *  ⚠️ 未经实测验证，selector 基于推断，首次实跑前请按下面清单调试
 * ============================================
 *
 * ✅ 已完成（代码层面）：
 *   - CLI bridge: zenoclaw/sdk/read-post-stats.js → puppeteer.connect(9222) → loadReader('baijiahao')
 *   - 前台页抓取：按 post_url 导航 → 正则抓"阅读/浏览/点赞/评论"
 *   - 后台回退：/builder/rc/content/list 按标题匹配行
 *   - article-factory /action/fetch-stats endpoint 已接入（同 toutiao）
 *
 * ❓ 未验证：
 *   - 百家号前台 URL 格式（baijiahao.baidu.com/s?id=... vs mbd.baidu.com/newspage/...）
 *   - 前台页是否真显示"阅读 xxx"（百度系通常展示"xx 次浏览"）
 *   - 后台列表的精确 DOM 结构（当前是通用 row/item 扫描）
 *   - 登录态：百家号后台 SSO 依赖百度账号 Cookie
 *   - 数字解析（百度有时显示"10万+"/"5+"这类非标准格式）
 *
 * 🔧 首次调试步骤：
 *   1. cd c:\Zeno-Growth-System\zenoclaw
 *   2. node sdk/read-post-stats.js --platform baijiahao --url "已发布文章URL" --port 9222
 *   3. 看 stdout，null 字段多就 F12 找 selector 补到 _readFromPostPage
 *
 * 策略：
 *   A. post_url 优先 → 前台文章页
 *   B. 后台回退 → /builder/rc/content/list 按标题匹配
 */
export class BaijiahaoReader extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'baijiahao'
  }

  /**
   * 读取百家号账号的总体数据（粉丝/投稿量/累计搜索量/评论量等）
   *
   * 页面：https://baijiahao.baidu.com/builder/rc/home
   * 实测日期：2026-05-02 在用户已登录的 Chrome 9222 中探测
   *
   * 策略：百家号首页数据卡 class 不统一，用文本驱动的"标题-数字" 配对：
   *   遍历可见 div，把 innerText 含已知标题（"总粉丝量"/"累计投稿量" 等）的元素
   *   抽取首个数字作为该指标值。
   *
   * @returns {Promise<{fans, totalArticles, totalSearchViews, totalComments, rawCards}|null>}
   */
  async readAccountStats() {
    const url = 'https://baijiahao.baidu.com/builder/rc/home'
    this.log.info(`[百家号Reader] 读取账号统计：${url}`)
    try {
      await this.navigateTo(url)
      await randomDelay(4000, 6000)

      return await this.page.evaluate(() => {
        const parseNum = (text) => {
          if (!text) return null
          const m = String(text).match(/([0-9]+(?:\.[0-9]+)?)\s*([万wWkK万亿]?)/)
          if (!m) return null
          let n = parseFloat(m[1])
          if (/[万w]/i.test(m[2])) n *= 10000
          else if (/[k]/i.test(m[2])) n *= 1000
          return Math.floor(n)
        }

        const targetTitles = ['总粉丝量', '累计投稿量', '累计百度搜索量', '评论量', '点赞量', '阅读量', '收益']
        const result = {}
        const rawCards = {}

        // 遍历所有 div，找文本同时含"标题"+数字的"卡片单元"
        document.querySelectorAll('div').forEach(el => {
          const text = (el.innerText || '').replace(/\s+/g, ' ').trim()
          if (text.length === 0 || text.length > 80) return  // 过滤大容器
          for (const title of targetTitles) {
            if (text.startsWith(title) || text.includes(title + ' ') || text === title) {
              // 从 text 中抽取首个数字（在标题之后）
              const after = text.split(title).slice(1).join(title)
              const num = parseNum(after)
              if (num !== null && !rawCards[title]) {
                rawCards[title] = { value: num, rawText: text }
              }
            }
          }
        })

        result.fans = rawCards['总粉丝量']?.value ?? null
        result.totalArticles = rawCards['累计投稿量']?.value ?? null
        result.totalSearchViews = rawCards['累计百度搜索量']?.value ?? null
        result.totalComments = rawCards['评论量']?.value ?? null
        result.rawCards = rawCards
        result.cardTitles = Object.keys(rawCards)
        result.probedAt = new Date().toISOString()
        return result
      })
    } catch (err) {
      this.log.warn(`[百家号Reader] 账号统计读取失败：${err.message}`)
      return null
    }
  }

  /**
   * 读取自己文章下的读者评论（用于回评工作流）
   *
   * 页面：https://baijiahao.baidu.com/builder/rc/commentmanage/comment/all
   * 实测日期：2026-05-02
   *
   * @param {object} [options]
   * @param {string} [options.filter='全部']  '全部'/'图文'/'视频'/'小视频'/'动态'/'图集'/'待删除'
   * @param {number} [options.limit=50]
   * @returns {Promise<Array<{author, articleType, articleTitle, content, time, likeCount, replyCount}>>}
   */
  async readMyArticleComments(options = {}) {
    const filterText = options.filter || '全部'
    const limit = Math.max(1, Math.min(options.limit || 50, 200))
    const url = 'https://baijiahao.baidu.com/builder/rc/commentmanage/comment/all'

    this.log.info(`[百家号Reader] 读取评论 (filter=${filterText}, limit=${limit})`)
    try {
      await this.navigateTo(url)
      await randomDelay(4000, 6000)

      // 切换 filter tab
      if (filterText !== '全部') {
        await this.page.evaluate((targetText) => {
          for (const tab of document.querySelectorAll('.cheetah-tabs-tab-btn')) {
            if ((tab.innerText || '').trim() === targetText) { tab.click(); return true }
          }
          return false
        }, filterText).catch(() => false)
        await randomDelay(2000, 3000)
      }

      return await this.page.evaluate((max) => {
        // 真实评论锚点：每条评论都有一个 span.connect（含 "评论了你的图文/视频/..." 等文字）
        // .userInfo-wrapper 只匹配第 1 条，不通用
        const anchors = document.querySelectorAll('span.connect')
        const out = []
        for (const anchor of anchors) {
          // 找最近的评论容器（向上 5 层内找含 "评论了你的" + 时间 + 评论文本的容器）
          let item = anchor.parentElement
          for (let i = 0; i < 5; i++) {
            if (!item) break
            const t = (item.innerText || '')
            if (t.includes('评论了你的') && /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}\s+\d{2}:\d{2}/.test(t)) break
            item = item.parentElement
          }
          if (!item) continue

          const articleType = ((anchor.innerText || '').match(/评论了你的(\S+)/)?.[1]) || ''

          const fullItemText = (item.innerText || '').replace(/\r/g, '')
          const allLines = fullItemText.split('\n').map(s => s.trim()).filter(Boolean)
          if (allLines.length < 2) continue

          // 作者：第 1 行（在 connect 之前）
          const author = allLines[0] || ''
          // 文章标题：从 fullText 提取 《...》
          const articleTitle = (fullItemText.match(/《(.+?)》/)?.[1]) || ''

          // 内容、时间：跳过 author + connect + title 后的剩余行
          // 找 title 行的索引
          let titleIdx = allLines.findIndex(l => l.includes(articleTitle) && articleTitle)
          if (titleIdx < 0) titleIdx = 1  // 至少跳过 author 行
          const remaining = allLines.slice(titleIdx + 1)

          let content = ''
          let time = ''
          for (const line of remaining) {
            if (/^\d{4}-\d{2}-\d{2}|^\d{2}-\d{2}\s+\d{2}:\d{2}/.test(line)) { time = time || line; continue }
            if (/^回复\s*\d*$/.test(line)) continue
            if (/^点赞\s*\d*$/.test(line)) continue
            if (/^[0-9]+\/500$/.test(line)) continue
            if (line === '回复' || line === '点赞') continue
            if (!content && line.length >= 2) content = line
          }

          // 点赞/回复数：item 内查找
          const likeText = item.querySelector('.comment-like')?.innerText || ''
          const replyText = item.querySelector('.comment-reply')?.innerText || ''
          const likeCount = parseInt(likeText.replace(/[^0-9]/g, '') || '0', 10)
          const replyCount = parseInt(replyText.replace(/[^0-9]/g, '') || '0', 10)

          if (author && content) {
            out.push({ author, articleType, articleTitle, content, time, likeCount, replyCount })
          }
          if (out.length >= max) break
        }
        return out
      }, limit)
    } catch (err) {
      this.log.warn(`[百家号Reader] 读取评论失败：${err.message}`)
      return []
    }
  }

  async readPostStats(post) {
    if (post.post_url) {
      const fromUrl = await this._readFromPostPage(post.post_url)
      if (fromUrl && (fromUrl.views || fromUrl.likes || fromUrl.comments)) {
        return fromUrl
      }
      this.log.info(`[百家号Reader] post_url 未拿到数据，尝试创作者后台`)
    }
    if (post.title) {
      return this._readFromDashboard(post.title)
    }
    this.log.warn(`[百家号Reader] 帖子缺少 URL 和标题，跳过`)
    return null
  }

  async _readFromPostPage(postUrl) {
    this.log.info(`[百家号Reader] 前台页访问: ${postUrl}`)
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

        const bodyText = document.body.innerText || ''
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
          /([0-9.]+[万wWkK]?)[\s]*次浏览/,
        ])
        const likes = grab([
          /点赞[:：\s]*([0-9.]+[万wWkK]?)/,
          /([0-9.]+[万wWkK]?)[\s]*赞/,
        ])
        const comments = grab([
          /评论[:：\s]*([0-9.]+[万wWkK]?)/,
          /([0-9.]+[万wWkK]?)[\s]*评论/,
        ])

        return {
          views,
          likes,
          comments,
          collects: null,
        }
      })
    } catch (err) {
      this.log.warn(`[百家号Reader] 前台页读取失败: ${err.message}`)
      return null
    }
  }

  async _readFromDashboard(title) {
    const dashUrl = 'https://baijiahao.baidu.com/builder/rc/content/list'
    this.log.info(`[百家号Reader] 后台按标题匹配: "${title}"`)
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

        const rows = document.querySelectorAll('tr, [class*="row"], [class*="item"], [class*="card"], li')
        for (const row of rows) {
          const text = row.innerText || ''
          if (!text.includes(targetTitle)) continue

          const grab = (patterns) => {
            for (const pat of patterns) {
              const m = text.match(pat)
              if (m && m[1]) return parseNum(m[1])
            }
            return null
          }

          return {
            views: grab([/阅读[量数]?[:：\s]*([0-9.]+[万wWkK]?)/, /推荐[:：\s]*([0-9.]+[万wWkK]?)/]),
            likes: grab([/点赞[:：\s]*([0-9.]+[万wWkK]?)/]),
            comments: grab([/评论[:：\s]*([0-9.]+[万wWkK]?)/]),
            collects: grab([/收藏[:：\s]*([0-9.]+[万wWkK]?)/]),
          }
        }

        return { views: null, likes: null, comments: null, collects: null, _error: '未匹配到标题' }
      }, title)
    } catch (err) {
      this.log.warn(`[百家号Reader] 后台读取失败: ${err.message}`)
      return null
    }
  }
}
