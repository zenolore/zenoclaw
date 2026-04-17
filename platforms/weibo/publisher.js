import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'
import path from 'path'

/**
 * 微博发帖适配器
 *
 * 发帖方式: 首页弹窗编辑器 https://weibo.com/
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新 selectors.js
 *
 * 微博特点:
 *   - 首页弹窗式发布（非独立发布页）
 *   - 正文 + 图片（最多 9 张）
 *   - 话题标签 #话题# 内嵌正文
 *   - woo-* 设计系统类名（稳定）
 */

const SELECTORS = PUBLISH_SELECTORS

export class WeiboAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'weibo'
    this.publishUrl = 'https://weibo.com/'
  }

  // 平台元数据
  getHomeUrl() { return 'https://weibo.com/' }
  getLoginUrl() { return 'https://weibo.com/login.php' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  /**
   * 执行完整的发帖流程
   */
  async publish(post) {
    this.log.info('========== 微博发帖开始 ==========')
    this.log.info(`内容: ${(post.content || '').slice(0, 50)}...`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发送按钮')

    try {
      await this.showStatus('正在预热浏览...').catch(() => {})
      await this.warmupBrowse()

      await this.showStatus('正在打开发微博页面...').catch(() => {})
      await this.step1_openPublishPage()
      await this.showStatus('正在输入内容...').catch(() => {})
      await this.step2_inputContent(post.content || post.title || '')

      if (post.images && post.images.length > 0) {
        await this.showStatus('正在上传图片...').catch(() => {})
        await this.step3_uploadImages(post.images)
      }

      await this.showStatus('正在发送微博...').catch(() => {})
      await this.step4_publish()
      await this.showStatus('发布完成！').catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 微博发帖成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`微博发帖失败: ${err.message}`)
      await this.conditionalScreenshot('weibo_error', 'error')
      return this.buildResult(false, err)
    }
  }

  // ============================================================
  // 各步骤实现
  // ============================================================

  async step1_openPublishPage() {
    this.log.info('[步骤1] 打开微博首页')
    await this.navigateTo(this.publishUrl)

    // 登录检测
    const currentUrl = this.page.url()
    if (currentUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录微博')
    }

    await this.conditionalScreenshot('weibo_step1_open', 'step')
    await this.browseForStep('open_page')
  }

  async step2_inputContent(content) {
    this.log.info('[步骤2] 输入微博正文')

    const selector = await this.findSelector([
      SELECTORS.contentInput,
    ])

    // textarea 直接 type 可靠
    await this.type(selector, content)
    await this.actionPause()
    await this.conditionalScreenshot('weibo_step2_content', 'step')
    await this.browseForStep('input_content')
  }

  async step3_uploadImages(imagePaths) {
    this.log.info(`[步骤3] 上传 ${imagePaths.length} 张图片`)

    const absolutePaths = imagePaths.map(p => path.resolve(p))

    try {
      await this.uploadFile(SELECTORS.imageInput, absolutePaths)
      const pollInterval = cfg('upload.processing_poll_interval', 5000)
      this.log.info('等待图片处理...')
      await sleep(pollInterval)
      this.log.info('图片上传完成')
    } catch (err) {
      this.log.warn(`图片上传失败，跳过: ${err.message}`)
    }

    await this.conditionalScreenshot('weibo_step3_upload', 'step')
    await this.browseForStep('upload_images')
  }

  async step4_publish() {
    if (this._dryRun) {
      this.log.info('[步骤4] dryRun 模式，内容已填写，等待人工确认后手动发送')
      return
    }
    this.log.info('[步骤4] 发布微博')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    const waitAfterMin   = cfg('steps.publish.wait_after_min', 5000)
    const waitAfterMax   = cfg('steps.publish.wait_after_max', 15000)

    await randomDelay(reviewDelayMin, reviewDelayMax)
    await this.conditionalScreenshot('weibo_before_publish', 'before_publish')

    // 微博发布按钮文本为"发送"
    let clicked = false
    const btn = await this.findByText('button', SELECTORS.publishButtonText)
    if (btn) {
      await btn.click()
      clicked = true
    }

    if (!clicked) {
      throw new Error('未找到发送按钮，页面结构可能已变更')
    }

    this.log.info('已点击发送按钮')
    await randomDelay(waitAfterMin, waitAfterMax)
    await this.conditionalScreenshot('weibo_after_publish', 'after_publish')
  }
}
