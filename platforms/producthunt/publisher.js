import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'
import path from 'path'

/**
 * Product Hunt 发布适配器
 *
 * 发布页面: https://www.producthunt.com/posts/new
 *
 * Product Hunt 特点:
 *   - 产品发布模式（标题 + 描述 + 图片）
 *   - 仅用于正式产品发布
 *   - 建议人工复核
 */

const SELECTORS = PUBLISH_SELECTORS

export class ProducthuntAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'producthunt'
    this.publishUrl = 'https://www.producthunt.com/posts/new'
  }

  // 平台元数据
  getHomeUrl() { return 'https://www.producthunt.com/' }
  getLoginUrl() { return 'https://www.producthunt.com/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  // 2026-04-20：海外平台加大超时，适应慢网络
  getNavigationTimeout() { return 100000 }
  getElementTimeout() { return 60000 }

  async publish(post) {
    this.log.info('========== Product Hunt 发布开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击提交按钮')

    // 设置任务标签和步骤
    this._overlayTaskLabel = 'Product Hunt · 产品发布任务执行中'
    const hasImages = post.images && post.images.length > 0
    const steps = ['预热浏览', '打开发布页面', '输入标题', '输入内容']
    if (hasImages) steps.push('上传图片')
    steps.push('提交发布')
    const T = steps.length
    let S = 0

    try {
      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开发布页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在打开 Product Hunt 发布页面', { next: '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPage', () => this.step1_openPage())
      S++
      await this.showStatus('正在模拟人工输入标题', { next: '输入内容', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step2_inputTitle(post.title))
      S++
      await this.showStatus('正在模拟人工输入内容描述', { next: hasImages ? '上传图片' : '提交发布', step: S, total: T }).catch(() => {})
      await this.runStep('inputContent', () => this.step3_inputContent(post.content))

      if (hasImages) {
        S++
        await this.showStatus('正在上传产品图片', { next: '提交发布', step: S, total: T }).catch(() => {})
        await this.runStep('uploadImage', () => this.step4_uploadImage(post.images[0]))
      }

      S++
      await this.showStatus('正在点击提交按钮发布产品', { step: S, total: T }).catch(() => {})
      await this.runStep('submit', () => this.step5_submit())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== Product Hunt 发布成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`Product Hunt 发布失败: ${err.message}`)
      await this.conditionalScreenshot('ph_error', 'error')
      return this.buildResult(false, err)
    }
  }

  async step1_openPage() {
    this.log.info('[步骤1] 打开 Product Hunt 发布页面')
    await this.navigateTo(this.publishUrl)

    const currentUrl = this.page.url()
    if (currentUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录 Product Hunt')
    }

    // 2026-04-20：海外平台加入视觉验证页面就绪
    await this.visionCheckPageReady('Product Hunt 发布页面', {
      expectedElements: ['标题输入框', '描述输入框或内容编辑区'],
      targetDelayMs: 5000
    })

    await this.conditionalScreenshot('ph_step1_open', 'step')
    await this.browseForStep('open_page')
  }

  async step2_inputTitle(title) {
    this.log.info('[步骤2] 输入标题')
    await this.type(SELECTORS.titleInput, title)
    await this.actionPause()
    await this.browseForStep('input_title')
  }

  async step3_inputContent(content) {
    this.log.info('[步骤3] 输入描述')
    const el = await this.findElement([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
      'input[name="tagline"]',
      'input[placeholder*="tagline"]',
      'input[placeholder*="description"]',
      'div[contenteditable="true"]',
    ])
    if (!el) {
      this.log.warn('未找到描述输入框，跳过')
      return
    }
    await el.click()
    await randomDelay(500, 1000)
    // 使用 CDP insertText 兼容各种输入框类型
    const cdp = await this.page.target().createCDPSession()
    await cdp.send('Input.insertText', { text: content })
    await cdp.detach()
    await this.actionPause()
    await this.browseForStep('input_content')
  }

  async step4_uploadImage(imagePath) {
    this.log.info('[步骤4] 上传图片')
    try {
      const absolutePath = path.resolve(imagePath)
      await this.uploadFile(SELECTORS.imageInput, [absolutePath])

      const pollInterval = cfg('upload.processing_poll_interval', 5000)
      await sleep(pollInterval)
      this.log.info('图片上传完成')
      await this.browseForStep('upload_images')
    } catch (e) {
      if (this._dryRun) {
        this.log.warn(`[dryRun] 图片上传失败（跳过）: ${e.message}`)
      } else {
        throw e
      }
    }
  }

  async step5_submit() {
    if (this._dryRun) {
      this.log.info('[步骤5] dryRun 模式，内容已填写，等待人工确认后手动提交')
      return
    }
    this.log.info('[步骤5] 提交')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    const waitAfterMin = cfg('steps.publish.wait_after_min', 5000)
    const waitAfterMax = cfg('steps.publish.wait_after_max', 15000)

    await randomDelay(reviewDelayMin, reviewDelayMax)
    await this.conditionalScreenshot('ph_before_publish', 'before_publish')

    const el = await this.page.$(SELECTORS.submitButton)
    if (!el) {
      throw new Error('未找到提交按钮，页面结构可能已变更')
    }
    await el.click()

    this.log.info('已点击提交按钮')
    await randomDelay(waitAfterMin, waitAfterMax)
    await this.conditionalScreenshot('ph_after_publish', 'after_publish')
  }

}
