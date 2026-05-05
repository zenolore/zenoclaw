import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 企鹅号(腾讯内容开放平台)文章发布适配器
 *
 * 文章编辑页: https://om.qq.com/main/creation/article
 * 入口URL: https://om.qq.com/article/articlePublish
 *
 * 企鹅号特点:
 *   - ProseMirror 富文本编辑器（.ExEditor-basic）
 *   - 标题 span.omui-inputautogrowing__inner（contenteditable）
 *   - omui 组件库（radio、suggestion、textarea）
 *   - 发布/定时发布/存草稿/预览 四按钮
 */

const S = PUBLISH_SELECTORS

export class QqAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'qq'
    this.publishUrl = 'https://om.qq.com/article/articlePublish'
  }

  getHomeUrl() { return 'https://om.qq.com/' }
  getLoginUrl() { return 'https://om.qq.com/' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  async publish(post) {
    this.log.info('========== 企鹅号发布开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 填写内容后不点击发布按钮')

    // 设置任务标签和步骤
    this._overlayTaskLabel = '企鹅号 · 文章发布任务执行中'
    const hasSummary = !!post.summary
    const hasTags = post.tags && post.tags.length > 0
    const hasCover = post.images && post.images.length > 0
    const steps = ['预热浏览', '打开发布页面', '输入标题', '输入正文']
    if (hasSummary) steps.push('输入摘要')
    if (hasTags) steps.push('添加标签')
    if (hasCover) steps.push('上传封面图')
    steps.push('发布文章')
    const T = steps.length
    let S = 0

    try {
      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开发布页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在打开企鹅号发布页面', { next: '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())
      S++
      await this.showStatus('正在模拟人工输入标题', { next: '输入正文', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step2_inputTitle(post.title))
      S++
      await this.showStatus('正在模拟人工输入正文内容', { next: steps[S] || '发布文章', step: S, total: T }).catch(() => {})
      await this.runStep('inputContent', () => this.step3_inputContent(post.content))

      if (hasSummary) {
        S++
        await this.showStatus('正在输入文章摘要', { next: steps[S] || '发布文章', step: S, total: T }).catch(() => {})
        await this.runStep('inputSummary', () => this.step4_inputSummary(post.summary))
      }

      if (hasTags) {
        S++
        await this.showStatus('正在添加标签', { next: steps[S] || '发布文章', step: S, total: T }).catch(() => {})
        await this.runStep('inputTags', () => this.step5_inputTags(post.tags))
      }

      if (hasCover) {
        S++
        await this.showStatus('正在上传封面图并等待处理', { next: '发布文章', step: S, total: T }).catch(() => {})
        await this.runStep('uploadCover', () => this.step6_uploadCover(post.images[0]))
      }

      S++
      await this.showStatus('正在点击发布按钮提交文章', { step: S, total: T }).catch(() => {})
      await this.runStep('publish', () => this.step7_publish())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})

      // 2026-04-15 安全加固：只有 step7_publish 未命中显式失败时，才继续执行发布后浏览。
      // 修改原因：企鹅号旧逻辑点击发布后仅固定等待，若页面已提示失败/审核/频繁，旧逻辑仍会当成成功继续跑。
      // 回退方式：删除 step7_publish() 中 conservativeVerifyPublishResult() 调用。
      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 企鹅号发布完成 ==========')
      return this.buildResult(true, '企鹅号发布成功')
    } catch (err) {
      this.log.error(`企鹅号发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  async step1_openPublishPage() {
    this.log.info('[Step 1] 打开企鹅号文章编辑页')
    await this.navigateTo(this.publishUrl)
    await randomDelay(cfg('timing.action_delay_min', 3000), cfg('timing.action_delay_max', 6000))
  }

  async step2_inputTitle(title) {
    this.log.info('[Step 2] 输入标题（span contenteditable）')
    // 企鹅号标题是 span.omui-inputautogrowing__inner contenteditable
    const spans = await this.page.$$(S.titleInput)
    let titleEl = null
    for (const span of spans) {
      const vis = await span.evaluate(el => el.offsetParent !== null && el.getBoundingClientRect().width > 100)
      if (vis) { titleEl = span; break }
    }
    if (!titleEl) throw new Error('未找到标题输入框')
    await this.humanTypeInElement(titleEl, title)
    await randomDelay(500, 1500)
  }

  async step3_inputContent(content) {
    this.log.info('[Step 3] 输入正文（ProseMirror）')
    const el = await this.findElement([S.contentInput, S.contentInputAlt])
    if (!el) throw new Error('未找到正文编辑器')
    await this.humanTypeInElement(el, content)
    await randomDelay(500, 1500)
  }

  async step4_inputSummary(summary) {
    this.log.info('[Step 4] 输入摘要')
    const el = await this.findElement([S.summaryInput])
    if (!el) { this.log.warn('未找到摘要输入框，跳过'); return }
    // 摘要可能隐藏，尝试让其可见
    await this.page.evaluate((sel) => {
      const ta = document.querySelector(sel)
      if (ta && ta.offsetParent === null) {
        ta.style.display = 'block'
        ta.style.width = '500px'
        ta.style.height = '60px'
      }
    }, S.summaryInput)
    await randomDelay(300, 500)
    await this.humanTypeInElement(el, summary)
    await randomDelay(300, 800)
  }

  async step5_inputTags(tags) {
    this.log.info('[Step 5] 输入标签')
    const el = await this.findElement([S.tagInput])
    if (!el) { this.log.warn('未找到标签输入框，跳过'); return }
    for (const tag of tags.slice(0, 3)) {
      await this.clickElement(el)
      await randomDelay(200, 400)
      const cdp = await this.page.target().createCDPSession()
      await cdp.send('Input.insertText', { text: tag })
      await cdp.detach()
      await randomDelay(500, 1000)
      await this.page.keyboard.press('Enter')
      await randomDelay(300, 600)
    }
  }

  async step6_uploadCover(imagePath) {
    this.log.info('[Step 6] 上传封面图')
    const fileInput = await this.findElement([S.coverFileInput])
    if (!fileInput) { this.log.warn('未找到封面上传入口，跳过'); return }
    await this.uploadFile(fileInput, imagePath)
    await randomDelay(2000, 4000)
  }

  async step7_publish() {
    if (this._dryRun) {
      this.log.info('[Step 7] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[Step 7] 点击发布')
    await this.clickByText('button', S.publishButtonText)
    await randomDelay(2000, 5000)

    // 2026-04-15 安全加固：企鹅号接入保守发布结果校验。
    // 修改策略：仅拦截明确失败提示，不把 unknown 收紧为失败，优先保证低风险上线。
    // 回退方式：删除下方 conservativeVerifyPublishResult() 调用。
    await this.conservativeVerifyPublishResult({
      guardName: 'qq_step7_publish',
      waitOptions: {
        successTexts: ['发布成功', '发表成功', '提交成功', '保存成功'],
        errorTexts: ['发布失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核'],
        timeout: 12000,
      },
      useVisionWhenUnknown: false,
    })
  }
}
