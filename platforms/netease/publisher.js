import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 网易号文章发布适配器
 *
 * 后台首页: https://mp.163.com/#/
 * 文章编辑: 通过首页"开始创作"→"文章"按钮进入
 *
 * 网易号特点:
 *   - Vue SPA + hash 路由
 *   - 标题 textarea/input + 正文 contenteditable
 *   - 通过首页按钮导航到编辑器
 */

const S = PUBLISH_SELECTORS

export class NeteaseAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'netease'
    this.homeUrl = 'https://mp.163.com/#/'
  }

  getHomeUrl() { return this.homeUrl }
  getLoginUrl() { return 'https://mp.163.com/login.html' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  async publish(post) {
    this.log.info('========== 网易号发布开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 填写内容后不点击发布按钮')

    try {
      await this.showStatus('正在预热浏览...').catch(() => {})
      await this.warmupBrowse()

      await this.showStatus('正在打开编辑器...').catch(() => {})
      await this.step1_navigateToEditor()
      await this.showStatus('正在输入标题...').catch(() => {})
      await this.step2_inputTitle(post.title)
      await this.showStatus('正在输入正文...').catch(() => {})
      await this.step3_inputContent(post.content)
      await this.showStatus('正在发布文章...').catch(() => {})
      await this.step4_publish()
      await this.showStatus('发布完成！').catch(() => {})
      await this.hideStatus().catch(() => {})

      // 2026-04-15 安全加固：仅在未检测到显式失败时继续执行发布后浏览。
      // 修改原因：网易号旧逻辑为点击发布后固定等待，若平台已提示失败/频繁，仍会继续走成功链路。
      // 回退方式：删除 step4_publish() 中 conservativeVerifyPublishResult() 调用。
      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 网易号发布完成 ==========')
      return this.buildResult(true, '网易号发布成功')
    } catch (err) {
      this.log.error(`网易号发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  async step1_navigateToEditor() {
    this.log.info('[Step 1] 导航到网易号文章编辑器')
    await this.navigateTo(this.homeUrl)
    await randomDelay(2000, 4000)

    // 检查登录状态
    if (this.page.url().includes(S.loginRedirectHost)) {
      throw new Error('未登录，已跳转到 www.163.com')
    }

    // 点击"文章"按钮（在"开始创作"区域内）
    const articleBtn = await this.page.evaluate((cls) => {
      const items = Array.from(document.querySelectorAll('div, span'))
      const el = items.find(e =>
        e.textContent?.trim() === '文章' && e.offsetParent !== null &&
        (e.className?.includes(cls) || e.closest(`[class*="${cls}"]`)))
      if (el) { el.click(); return true }
      // fallback
      const fallback = items.find(e => e.textContent?.trim() === '文章' && e.offsetParent !== null)
      if (fallback) { fallback.click(); return true }
      return false
    }, S.createSectionClass)

    if (!articleBtn) {
      this.log.warn('未找到"文章"按钮')
    }
    await randomDelay(3000, 5000)

    // 可能打开了新标签页
    const browser = this.page.browser()
    const pages = await browser.pages()
    for (let i = pages.length - 1; i >= 0; i--) {
      const url = pages[i].url()
      if (url.includes('mp.163.com') && (url.includes('edit') || url.includes('write') || url.includes('article-publish'))) {
        this.page = pages[i]
        break
      }
    }

    this.log.info(`编辑器URL: ${this.page.url().substring(0, 80)}`)
  }

  async step2_inputTitle(title) {
    this.log.info('[Step 2] 输入标题')
    const el = await this.findElement([S.titleInput, S.titleInputAlt])
    if (!el) throw new Error('未找到标题输入框')
    await this.humanTypeInElement(el, title)
    await randomDelay(500, 1500)
  }

  async step3_inputContent(content) {
    this.log.info('[Step 3] 输入正文')
    const el = await this.findElement([S.contentInput])
    if (!el) throw new Error('未找到正文编辑器')
    await this.humanTypeInElement(el, content)
    await randomDelay(500, 1500)
  }

  async step4_publish() {
    if (this._dryRun) {
      this.log.info('[Step 4] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[Step 4] 点击发布')
    await this.clickByText('button', S.publishButtonText)
    await randomDelay(2000, 5000)

    // 2026-04-15 安全加固：网易号接入保守发布结果校验。
    // 修改策略：只拦截明确失败提示，unknown 保持兼容，以免 SPA 异步提示过短导致误判。
    // 回退方式：删除下方 conservativeVerifyPublishResult() 调用。
    await this.conservativeVerifyPublishResult({
      guardName: 'netease_step4_publish',
      waitOptions: {
        successTexts: ['发布成功', '发表成功', '提交成功', '保存成功'],
        errorTexts: ['发布失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核'],
        timeout: 12000,
      },
      useVisionWhenUnknown: false,
    })
  }
}
