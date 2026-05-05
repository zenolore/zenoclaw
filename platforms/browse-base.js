import { BasePlatformAdapter } from './base.js'
import {
  randomDelay,
  simulateBrowsing,
  gaussianRandom,
  sleep,
} from '../core/human.js'
import { cfg } from '../core/config.js'

/**
 * 通用养号/浏览执行器基类
 *
 * 各平台的 browse.js 可以继承此类并覆盖 getBrowseSelectors()，
 * 即可获得完整的智能浏览行为。
 *
 * 行为流程:
 *   1. 导航到平台首页
 *   2. 随机滚动 feed（高斯分布步长）
 *   3. 随机点击内容项阅读详情
 *   4. 返回首页，继续滚动
 *   5. 偶发搜索操作
 *   6. 直到 durationMs 到期
 */
export class BrowseRunnerBase extends BasePlatformAdapter {
  constructor(page) {
    super(page)
  }

  /**
   * 子类实现：返回平台的浏览选择器
   * 必须包含: homeUrl, feedContainer, feedItem
   * 可选: searchInput, scrollTarget
   * @returns {object}
   */
  getBrowseSelectors() {
    throw new Error('子类必须实现 getBrowseSelectors()')
  }

  /**
   * 执行完整的浏览/养号行为
   * @param {object} opts
   * @param {number} opts.durationMs - 目标浏览时长（毫秒）
   */
  async browse({ durationMs = 15 * 60 * 1000 } = {}) {
    const sel = this.getBrowseSelectors()
    const homeUrl = sel.homeUrl || this.getHomeUrl?.()
    if (!homeUrl) throw new Error('浏览选择器未配置 homeUrl')

    const startTime = Date.now()
    this.log.info(`[养号] 导航到首页: ${homeUrl}`)
    await this.navigateTo(homeUrl)
    await randomDelay(2000, 5000)

    const clickChance    = cfg('browse.click_item_chance', 0.3)
    const searchChance   = cfg('browse.search_chance', 0.1)
    const scrollRounds   = cfg('browse.scroll_rounds_per_cycle', 5)

    let round = 0

    while (Date.now() - startTime < durationMs) {
      round++
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.floor((durationMs - (Date.now() - startTime)) / 1000)
      this.log.debug(`[养号] 第 ${round} 轮 | 已用 ${elapsed}s | 剩余 ${remaining}s`)

      // 随机滚动 feed
      await this._scrollFeed(sel, scrollRounds)

      // 随机点击一篇内容
      if (Math.random() < clickChance && sel.feedItem) {
        await this._readOneItem(sel, homeUrl)
      }

      // 随机搜索
      if (Math.random() < searchChance && sel.searchInput) {
        await this._doSearch(sel)
      }

      // 轮次间停顿
      const pauseMin = cfg('browse.cycle_pause_min', 5000)
      const pauseMax = cfg('browse.cycle_pause_max', 20000)
      await randomDelay(pauseMin, pauseMax)

      if (Date.now() - startTime >= durationMs) break
    }

    this.log.info(`[养号] 浏览结束，共 ${round} 轮`)
  }

  // ============================================================
  // 内部操作
  // ============================================================

  async _scrollFeed(sel, rounds) {
    const scrollTarget = sel.scrollTarget || 'body'
    const scrollMin = cfg('scroll.distance_min', 300)
    const scrollMax = cfg('scroll.distance_max', 800)

    for (let i = 0; i < rounds; i++) {
      const distance = Math.floor(gaussianRandom(scrollMin, scrollMax))
      await this.page.evaluate((target, dist) => {
        const el = document.querySelector(target) || window
        if (el === window) {
          window.scrollBy({ top: dist, behavior: 'smooth' })
        } else {
          el.scrollBy({ top: dist, behavior: 'smooth' })
        }
      }, scrollTarget, distance)

      const pauseMin = cfg('scroll.pause_min', 800)
      const pauseMax = cfg('scroll.pause_max', 3000)
      await randomDelay(pauseMin, pauseMax)
    }
  }

  async _readOneItem(sel, homeUrl) {
    try {
      const items = await this.page.$$(sel.feedItem)
      if (!items || items.length === 0) return

      // 随机选一个可见 item
      const idx = Math.floor(Math.random() * Math.min(items.length, 10))
      const item = items[idx]

      this.log.debug(`[养号] 点击第 ${idx + 1} 条内容`)
      await this.clickElement(item)

      // 阅读时间：高斯分布 15-120 秒
      const readMin = cfg('browse.read_time_min', 15000)
      const readMax = cfg('browse.read_time_max', 120000)
      const readTime = Math.floor(gaussianRandom(readMin, readMax))
      this.log.debug(`[养号] 阅读 ${Math.floor(readTime / 1000)}s`)

      // 在详情页滚动模拟阅读
      await simulateBrowsing(this.page, null, readTime)

      // 返回首页
      await this.page.goBack({ waitUntil: 'domcontentloaded' })
      await randomDelay(1000, 3000)

    } catch (err) {
      this.log.warn(`[养号] 点击内容项失败，跳过: ${err.message}`)
      // 出错则重新导航回首页
      try {
        const currentUrl = this.page.url()
        if (!currentUrl.startsWith(homeUrl)) {
          await this.navigateTo(homeUrl)
          await randomDelay(2000, 4000)
        }
      } catch { /* ignore */ }
    }
  }

  async _doSearch(sel) {
    const searchTerms = cfg('browse.search_terms', ['热门', '推荐', '最新'])
    const term = searchTerms[Math.floor(Math.random() * searchTerms.length)]

    try {
      this.log.debug(`[养号] 搜索: ${term}`)
      const inputEl = await this.page.$(sel.searchInput)
      if (!inputEl) return

      await this.clickElement(inputEl)
      await randomDelay(500, 1500)
      await this.page.keyboard.type(term, { delay: 100 })
      await randomDelay(800, 2000)
      await this.page.keyboard.press('Enter')

      // 查看结果几秒后回首页
      const browseTime = Math.floor(gaussianRandom(10000, 30000))
      await simulateBrowsing(this.page, null, browseTime)
      await this.navigateTo(sel.homeUrl)
      await randomDelay(1000, 3000)

    } catch (err) {
      this.log.warn(`[养号] 搜索失败，跳过: ${err.message}`)
    }
  }
}
