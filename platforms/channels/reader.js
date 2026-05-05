import { BaseReader, emptyStats } from '../reader-base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 视频号助手数据读取器
 *
 * 选择器来源：2026-05-02 实测，使用用户已登录的 Chrome 9222
 *
 * 重要：视频号架构 = 主页面 + <iframe name="content" src="/micro/...">
 * 业务内容都在 iframe 内，必须用 page.frames() 进入 iframe 后再操作。
 *
 * 已实现：
 *   readAccountStats()  - 从主页面侧栏读账号名/视频号ID/视频数/关注者数
 *   readMyVideoList()   - 进 /platform/comment iframe 读自己所有视频列表（含每个视频的评论数）
 *
 * 待实现：
 *   readMyArticleComments() - 单条评论的 DOM 结构待二次探测
 */
export class ChannelsReader extends BaseReader {
  constructor(page) {
    super(page)
    this.platformName = 'channels-reader'
    this.isPlaceholder = true
  }

  /**
   * 找到 content iframe（视频号所有主区都在 iframe 内）
   * @private
   */
  async _getContentFrame() {
    const frames = this.page.frames()
    for (const f of frames) {
      try {
        if (f.name() === 'content' || /\/micro\//.test(f.url())) return f
      } catch { /* ignore */ }
    }
    return null
  }

  /**
   * 读取视频号账号统计（账号名/视频号ID/视频数/关注者数）
   *
   * 页面：https://channels.weixin.qq.com/platform
   * 实测：账号信息在主页面侧栏 .common-menu-item.account-info 内，
   *       innerText 形如 "卢传俊382 申请认证 视频号ID: sphyz2TVk6QZoDN 视频12 关注者28"
   *
   * @returns {Promise<{accountName, channelId, videoCount, followerCount}|null>}
   */
  async readAccountStats() {
    const url = 'https://channels.weixin.qq.com/platform'
    this.log.info(`[视频号Reader] 读取账号统计：${url}`)
    try {
      await this.navigateTo(url)
      await randomDelay(4000, 6000)

      return await this.page.evaluate(() => {
        // bodyText 中查找包含 "视频号ID:" 的段落
        const bodyText = document.body.innerText || ''
        const idMatch = bodyText.match(/视频号ID[：:]\s*(\S+)/)
        const videoMatch = bodyText.match(/视频\s*([0-9]+)/)
        const followerMatch = bodyText.match(/关注者\s*([0-9]+)/)

        // 账号名：从侧栏 .common-menu-item.account-info 取（如失败再用 bodyText 推断）
        let accountName = ''
        const accountCard = document.querySelector('.common-menu-item.account-info, .common-menu-item:has(.account-info)')
        if (accountCard) {
          const lines = (accountCard.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)
          accountName = lines[0] || ''
        }
        // 兜底：从 idMatch 前面推
        if (!accountName && idMatch) {
          const before = bodyText.slice(0, idMatch.index).trim().split(/\s+/).filter(Boolean)
          accountName = before[before.length - 1] || ''
        }

        return {
          accountName,
          channelId: idMatch?.[1] || null,
          videoCount: videoMatch ? parseInt(videoMatch[1], 10) : null,
          followerCount: followerMatch ? parseInt(followerMatch[1], 10) : null,
          probedAt: new Date().toISOString(),
        }
      })
    } catch (err) {
      this.log.warn(`[视频号Reader] 账号统计读取失败：${err.message}`)
      return null
    }
  }

  /**
   * 读取自己所有视频的列表（含每个视频的评论数）
   *
   * 页面：https://channels.weixin.qq.com/platform/comment （在 iframe 内）
   * 实测：每个视频是 .comment-feed-wrap，.feed-info 末尾数字 = 评论数
   *
   * @returns {Promise<Array<{title, publishTime, commentCount}>>}
   */
  async readMyVideoList() {
    const url = 'https://channels.weixin.qq.com/platform/comment'
    this.log.info(`[视频号Reader] 读取视频列表：${url}`)
    try {
      await this.navigateTo(url)
      await randomDelay(5000, 7000)

      const frame = await this._getContentFrame()
      if (!frame) {
        this.log.warn(`[视频号Reader] 未找到 content iframe`)
        return []
      }

      return await frame.evaluate(() => {
        const out = []
        document.querySelectorAll('.comment-feed-wrap').forEach(wrap => {
          const text = (wrap.innerText || '').replace(/\s+/g, ' ').trim()
          // 例: "智能AI语音升级说明 2025/06/14 10:47 0" → 标题/日期/评论数
          const m = text.match(/^(.+?)\s+(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s+(\d+)$/)
          if (m) {
            out.push({
              title: m[1].trim(),
              publishTime: m[2],
              commentCount: parseInt(m[3], 10),
            })
          }
        })
        return out
      })
    } catch (err) {
      this.log.warn(`[视频号Reader] 视频列表读取失败：${err.message}`)
      return []
    }
  }

  async readPostStats(post) {
    this.log.warn(`[${this.platformName}] 单视频统计未实现（视频号需进 iframe），返回空字段`)
    return { ...emptyStats(), isPlaceholder: true }
  }

  async readAllPostStats() {
    this.log.warn(`[${this.platformName}] 批量数据采集未实现，返回空数组`)
    return []
  }
}

export default ChannelsReader
