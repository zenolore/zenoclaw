import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'
import path from 'path'

/**
 * X (Twitter) 发帖适配器
 *
 * 发布页面: https://x.com/compose/post
 *
 * X 特点:
 *   - 短文本（无标题字段，正文280字符限制）
 *   - 支持图片（最多4张）
 *   - data-testid 属性定位元素，较稳定
 */

const SELECTORS = PUBLISH_SELECTORS

export class XAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'x'
    this.publishUrl = 'https://x.com/compose/post'
  }

  // 平台元数据
  getHomeUrl() { return 'https://x.com/home' }
  getLoginUrl() { return 'https://x.com/i/flow/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  async publish(post) {
    this.log.info('========== X 发帖开始 ==========')
    this.log.info(`内容: ${(post.content || post.title || '').slice(0, 50)}...`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发推按钮')

    try {
      // 发帖前预热浏览：先浏览首页 feed，建立自然行为链
      await this.showStatus('正在预热浏览...').catch(() => {})
      await this.warmupBrowse()

      await this.showStatus('正在打开发推页面...').catch(() => {})
      await this.step1_openPage()

      // X 无标题，用 content 或 fallback 到 title
      const text = post.content || post.title || ''
      await this.showStatus('正在输入推文内容...').catch(() => {})
      await this.step2_inputContent(text)

      if (post.images && post.images.length > 0) {
        await this.showStatus('正在上传图片...').catch(() => {})
        await this.step3_uploadImages(post.images)
      }

      // AI 视觉验证：发布前截图确认内容正确
      const verification = await this.verifyBeforePublish({
        content: text,
        imageCount: post.images?.length || 0
      })
      if (!verification.pass && verification.confidence > 0.8) {
        if (this._dryRun) {
          throw new Error(`[视觉验证] 内容验证未通过（置信度 ${verification.confidence}）: ${verification.details}`)
        }
        this.log.warn(`[视觉验证] 内容验证未通过，但继续发布: ${verification.details}`)
      }

      await this.showStatus('正在发布推文...').catch(() => {})
      await this.step4_submit()
      await this.showStatus('发布完成！').catch(() => {})

      await this.fillRemainingTime()
      await this.postPublishBrowse()

      await this.hideStatus().catch(() => {})
      this.log.info('========== X 发帖成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`X 发帖失败: ${err.message}`)
      await this.conditionalScreenshot('x_error', 'error')
      return this.buildResult(false, err)
    }
  }

  async step1_openPage() {
    this.log.info('[步骤1] 从首页点击 Post 按钮进入发帖')

    // 确保在首页（warmupBrowse 可能已导航过，也可能禁用了）
    const currentUrl = this.page.url()
    if (!currentUrl.includes('x.com/home')) {
      await this.navigateTo(this.getHomeUrl())
    }

    // 登录检测
    const afterUrl = this.page.url()
    if (afterUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录 X')
    }

    // 找到并点击侧边栏 Post 按钮
    const composeBtn = await this.findElement([
      SELECTORS.composeButton,
      SELECTORS.composeButtonAlt,
    ])
    if (!composeBtn) {
      // fallback：直接导航到发帖页
      this.log.warn('[步骤1] 未找到侧边栏 Post 按钮，fallback 直接导航')
      await this.navigateTo(this.publishUrl)
    } else {
      await this.clickElement(composeBtn)
      this.log.info('[步骤1] 已点击 Post 按钮，等待编辑弹窗')
    }

    // 等待编辑弹窗出现
    try {
      await this.page.waitForSelector(SELECTORS.composeDialog, { timeout: 10000 })
      this.log.info('[步骤1] 编辑弹窗已打开')
    } catch {
      throw new Error('编辑弹窗未弹出，可能页面结构已变更')
    }

    // 视觉验证编辑弹窗就绪
    await this.visionCheckPageReady('X 推文编辑弹窗', {
      expectedElements: ['推文输入框', '发推按钮（Post）'],
      targetDelayMs: 3000
    })

    await this.conditionalScreenshot('x_step1_open', 'step')
  }

  async step2_inputContent(content) {
    this.log.info('[步骤2] 输入推文内容')

    const selector = await this.findSelector([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
    ])

    await this.click(selector)
    await randomDelay(500, 1000)
    await this.type(selector, content)
    await this.actionPause()
    await this.conditionalScreenshot('x_step2_content', 'step')

    // 视觉验证内容已输入
    await this.visionCheckContent({ content }, { targetDelayMs: 3000 })

    await this.browseForStep('input_content')
  }

  async step3_uploadImages(imagePaths) {
    this.log.info(`[步骤3] 上传 ${imagePaths.length} 张图片`)

    const absolutePaths = imagePaths.map(p => path.resolve(p))
    const selector = await this.findSelector([
      SELECTORS.imageInput,
      SELECTORS.imageInputAlt,
    ])

    await this.uploadFile(selector, absolutePaths)

    const pollInterval = cfg('upload.processing_poll_interval', 5000)
    this.log.info('等待图片处理...')
    await sleep(pollInterval)

    this.log.info('图片上传完成')
    await this.conditionalScreenshot('x_step3_upload', 'step')
    await this.browseForStep('upload_images')
  }

  async step4_submit() {
    if (this._dryRun) {
      this.log.info('[步骤4] dryRun 模式，内容已填写，等待人工确认后手动发推')
      return
    }
    this.log.info('[步骤4] 发送推文')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    await randomDelay(reviewDelayMin, reviewDelayMax)

    // 找到发推按钮
    let el = await this.page.$(SELECTORS.submitButton)
    if (!el) {
      // 选择器未命中 → 视觉定位发推按钮
      this.log.info('[步骤4] 选择器未命中，尝试视觉定位发推按钮')
      const visionClick = await this.visionLocateAndClick('发推按钮（Post 或 发推）')
      if (visionClick.clicked) {
        this.log.info('[步骤4] 视觉定位点击成功，等待发布结果...')
        const published = await this._waitForDialogDismiss(8000)
        if (published) {
          this.log.info('[步骤4] 发布成功：编辑弹窗已消失')
          await this.conditionalScreenshot('x_after_publish', 'after_publish')
          // 视觉判断发布结果
          await this.visionCheckPublishResult({ platformName: 'X (Twitter)' })
          return
        }
      }
      throw new Error('未找到发推按钮，选择器和视觉定位均失败')
    }

    // === 4 级降级点击策略 ===
    let published = false

    // 1. ghost-cursor 带轨迹点击（最真人化）
    await el.evaluate(node => node.scrollIntoView({ block: 'center' }))
    await randomDelay(300, 600)
    await this.clickElement(el)
    this.log.info('[步骤4] 方式1: ghost-cursor 点击，等待弹窗消失...')
    published = await this._waitForDialogDismiss(6000)

    // 2. page.click（Puppeteer 原生）
    if (!published) {
      this.log.warn('[步骤4] 方式1 未生效，尝试 page.click')
      await this.page.click(SELECTORS.submitButton).catch(() => {})
      published = await this._waitForDialogDismiss(5000)
    }

    // 3. DOM evaluate click（直接触发 JS click 事件）
    if (!published) {
      this.log.warn('[步骤4] 方式2 未生效，尝试 DOM evaluate click')
      await this.page.evaluate((sel) => {
        const btn = document.querySelector(sel)
        if (btn) {
          btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
          btn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      }, SELECTORS.submitButton).catch(() => {})
      published = await this._waitForDialogDismiss(5000)
    }

    // 4. AI 视觉定位 + 鼠标坐标点击（绕过选择器）
    if (!published) {
      this.log.warn('[步骤4] 方式3 未生效，尝试视觉定位发推按钮')
      await this.conditionalScreenshot('x_before_vision_click', 'step')
      const visionClick = await this.visionLocateAndClick('编辑弹窗中的 Post 发推按钮（蓝色按钮，通常在右下角）')
      if (visionClick.clicked) {
        published = await this._waitForDialogDismiss(8000)
      }
    }

    if (!published) {
      await this.conditionalScreenshot('x_publish_failed', 'error')
      throw new Error('发布失败：4 种点击方式均未触发发推，推文可能未发出')
    }

    this.log.info('[步骤4] 发布成功：编辑弹窗已消失')
    await this.conditionalScreenshot('x_after_publish', 'after_publish')

    // 视觉判断发布结果
    const publishResult = await this.visionCheckPublishResult({ platformName: 'X (Twitter)' })
    this.log.info(`[视觉] 发布结果: ${publishResult.status} — ${publishResult.details}`)
  }

  /**
   * 等待编辑弹窗消失（polling 检测）
   * @param {number} timeoutMs - 最大等待时间
   * @returns {Promise<boolean>} 弹窗是否已消失
   */
  async _waitForDialogDismiss(timeoutMs) {
    const pollInterval = 1000
    const maxAttempts = Math.ceil(timeoutMs / pollInterval)
    const startUrl = this.page.url()

    for (let i = 0; i < maxAttempts; i++) {
      await sleep(pollInterval)
      try {
        // URL 变化（发推成功后 X 会从 compose 跳回 home）
        const currentUrl = this.page.url()
        if (currentUrl !== startUrl && !currentUrl.includes('/compose')) {
          return true
        }
        // 选择器消失
        const dialog = await this.page.$(SELECTORS.composeDialog)
        if (!dialog) return true
      } catch {
        // 页面导航中，selector 查询可能抛异常 → 说明页面正在跳转 = 成功
        return true
      }
    }
    return false
  }

}
