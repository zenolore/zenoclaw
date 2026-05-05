import { BaseReader, emptyStats } from '../reader-base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 微信公众号数据采集
 *
 * 实测日期：2026-05-02
 *
 * 公众号特殊：
 *   - 所有后台 URL 必须含 token 参数
 *   - 此 reader 自动从 /cgi-bin/home 重定向获取 token
 *   - 如果未登录会跳到 /cgi-bin/loginpage，readAccountStats 会返回 {error: 'not_logged_in'}
 *
 * readPostStats / readAllPostStats 暂未接入（公众号文章数据需逐篇展开，开销大）
 * readAccountStats 提供综合数据，已实测可用
 */
export class WechatReader extends BaseReader {
  constructor(page) {
    super(page)
    this.platformName = 'wechat-reader'
  }

  /**
   * 获取登录 token：
   *   1. 先看 page 当前 URL 是否含 token（已登录 tab 复用）
   *   2. 否则扫描所有 browser tabs 找含 token 的
   *   3. 都不行才尝试访问 /cgi-bin/home 触发重定向
   *
   * 公众号未登录访问 /cgi-bin/home 不带 token 会跳 loginpage，
   * 但已登录的另一个 tab 已有 token，直接复用最稳。
   */
  async _getToken() {
    // Step 1: 当前 page URL
    let url = this.page.url()
    let m = url.match(/token=(\d+)/)
    if (m) return m[1]

    // Step 2: 扫所有 tabs
    const browser = this.page.browser()
    const pages = await browser.pages()
    for (const p of pages) {
      const u = p.url()
      const mm = u.match(/token=(\d+)/)
      if (mm && /weixin\.qq\.com/.test(u)) return mm[1]
    }

    // Step 3: 兜底导航
    await this.page.goto('https://mp.weixin.qq.com/cgi-bin/home', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await randomDelay(2500, 4000)
    url = this.page.url()
    if (/loginpage/.test(url)) return null
    m = url.match(/token=(\d+)/)
    return m?.[1] || null
  }

  /**
   * 读取公众号账号综合数据
   *
   * 数据来源（home 页一站获取）：
   *   - 公众号名称
   *   - 总用户数（粉丝数）
   *   - 昨日阅读(人) / 昨日分享(人) / 昨日新增关注(人)
   *   - 数据统计时间
   *
   * @returns {Promise<object>}
   */
  async readAccountStats() {
    const token = await this._getToken()
    if (!token) {
      this.log.warn('[公众号Reader] 未登录或获取 token 失败')
      return { error: 'not_logged_in', probedAt: new Date().toISOString() }
    }
    this.log.info(`[公众号Reader] 已获取 token`)

    const homeUrl = `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&token=${token}&lang=zh_CN`
    await this.page.goto(homeUrl, { waitUntil: 'domcontentloaded' })
    await randomDelay(4000, 6000)

    const stats = await this.page.evaluate(() => {
      const text = document.body.innerText || ''
      // 公众号名：在"通知中心 N {名} {名}"或"58 {名} {名}"模式后出现两次
      // 找"原创内容"前最近的一段非数字文本
      const beforeOriginal = text.split('原创内容')[0]
      // 取最后一行非空且非数字
      const lines = beforeOriginal.split(/\n+/).map(s => s.trim()).filter(Boolean)
      let accountName = ''
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].length > 1 && !/^\d+$/.test(lines[i]) && !/通知中心|新的功能|设置/.test(lines[i])) {
          accountName = lines[i]
          break
        }
      }

      const grab = (label) => {
        const m = text.match(new RegExp(label + '\\s*([\\d,]+)'))
        return m ? parseInt(m[1].replace(/,/g, ''), 10) : null
      }

      // "数据统计时间: 5月1日 00:00 - 24:00"
      const dataTimeMatch = text.match(/数据统计时间[:：]\s*([^\n]+)/)

      return {
        accountName,
        totalUsers: grab('总用户数'),
        originalContents: grab('原创内容'),
        yesterdayReads: grab('昨日阅读\\(人\\)'),
        yesterdayShares: grab('昨日分享\\(人\\)'),
        yesterdayNewFollowers: grab('昨日新增关注\\(人\\)'),
        dataStatTime: dataTimeMatch?.[1]?.trim() || null,
      }
    })

    return { ...stats, probedAt: new Date().toISOString() }
  }

  /**
   * 读取最新留言（公众号留言管理页 5 条最新）
   *
   * @returns {Promise<Array<{author, content, time, region}>>}
   */
  async readMyArticleComments(options = {}) {
    const limit = Math.max(1, Math.min(options.limit || 10, 50))
    const token = await this._getToken()
    if (!token) {
      this.log.warn('[公众号Reader] 未登录')
      return []
    }
    const url = `https://mp.weixin.qq.com/misc/appmsgcomment?action=list_latest_comment&begin=0&count=10&sendtype=MASSSEND&scene=1&token=${token}&lang=zh_CN`
    await this.page.goto(url, { waitUntil: 'domcontentloaded' })
    await randomDelay(5000, 7000)

    return await this.page.evaluate((max) => {
      const text = document.body.innerText || ''
      // 抓 "全部留言(N条)" 之后的内容
      // 兼容全角/半角括号、零宽空格等
      const splitRe = /全部留言[\s\u200B\u3000]*[\(（][\s\u200B\u3000]*\d+[\s\u200B\u3000]*条[\s\u200B\u3000]*[\)）]/
      const afterAll = text.split(splitRe)[1] || text  // 找不到 split 标记则全文搜
      const lines = afterAll.split('\n').map(s => s.trim()).filter(Boolean)

      // 实测留言项 5 行结构 (2026-05-02)：
      //   行 N-1: 作者名（"朱诗夜归来烧热鱼 烧鱼"）
      //   行 N:   "留言X次"
      //   行 N+1: "关注Y年"
      //   行 N+2: 留言内容
      //   行 N+3: "YYYY-MM-DD HH:MM:SS [地区]"
      //
      // UP主回复 4 行结构（要跳过）：
      //   公众号名 / "作者" / 回复内容 / 时间
      //
      // 策略：以"留言N次"行为锚点，向前 1 行取作者，向后取关注/内容/时间

      const out = []
      const dateRe = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/
      const liuyanCountRe = /^留言\s*(\d+)\s*次$/
      const followRe = /^关注\s*(\d+)\s*年$/

      for (let i = 1; i < lines.length - 3; i++) {
        const lm = lines[i].match(liuyanCountRe)
        if (!lm) continue
        const fm = lines[i + 1].match(followRe)
        if (!fm) continue
        if (!dateRe.test(lines[i + 3])) continue

        const author = lines[i - 1].trim()
        // 跳过 UP 主回复行（虽然 UP 主回复不含"留言N次"，理论上不会撞到，但保险）
        if (/^(写留言|留言设置|按时间排序|不限留言时间)$/.test(author)) continue

        const content = lines[i + 2].trim()
        const dateMatch = lines[i + 3].match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*(.*)$/)

        out.push({
          author,
          content,
          messageCount: parseInt(lm[1], 10),
          followYears: parseInt(fm[1], 10),
          time: dateMatch?.[1] || '',
          region: dateMatch?.[2]?.trim() || '',
        })
        if (out.length >= max) break
      }
      return out
    }, limit)
  }

  // 兼容 BaseReader 接口
  async readPostStats(post) {
    this.log.warn(`[${this.platformName}] readPostStats 未实现`)
    return { ...emptyStats(), isPlaceholder: true }
  }

  async readAllPostStats() {
    this.log.warn(`[${this.platformName}] readAllPostStats 未实现`)
    return []
  }
}

export default WechatReader
