import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'
import path from 'path'

/**
 * 少数派 (SSPAI) 文章发布适配器
 *
 * 发布页面: https://sspai.com/write
 *
 * 少数派特点:
 *   - 长文模式（标题 + 富文本正文）
 *   - 支持标签和利益相关声明
 *   - 建议先保存草稿再发布
 */

const SELECTORS = PUBLISH_SELECTORS

export class SspaiAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'sspai'
    this.publishUrl = 'https://sspai.com/write'
  }

  // 平台元数据
  getHomeUrl() { return 'https://sspai.com/' }
  getLoginUrl() { return 'https://sspai.com/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  async publish(post) {
    this.log.info('========== 少数派发帖开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

    try {
      await this.warmupBrowse()

      await this.runStep('openPage', () => this.step1_openPage())
      await this.runStep('inputTitle', () => this.step2_inputTitle(post.title))
      await this.runStep('inputContent', () => this.step3_inputContent(post.content))

      if (post.images && post.images.length > 0) {
        await this.runStep('uploadCover', () => this.step4_uploadCover(post.images[0]))
      }

      await this.runStep('publish', () => this.step5_publish())

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 少数派发帖成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`少数派发帖失败: ${err.message}`)
      await this.conditionalScreenshot('sspai_error', 'error')
      return this.buildResult(false, err)
    }
  }

  async step1_openPage() {
    this.log.info('[步骤1] 打开少数派写文章页面')
    await this.navigateTo(this.publishUrl)

    const currentUrl = this.page.url()
    if (currentUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录少数派')
    }

    await this.conditionalScreenshot('sspai_step1_open', 'step')
    await this.browseForStep('open_page')
  }

  async step2_inputTitle(title) {
    this.log.info('[步骤2] 输入标题')
    const selector = await this.findSelector([
      SELECTORS.titleInput,
      SELECTORS.titleInputAlt,
    ])
    await this.type(selector, title)
    await this.actionPause()
    await this.browseForStep('input_title')
  }

  async step3_inputContent(content) {
    this.log.info('[步骤3] 输入正文')
    const selector = await this.findSelector([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
    ])
    await this.click(selector)
    await randomDelay(500, 1000)
    // CKEditor 富文本编辑器需要用 CDP insertText 方式输入
    await this.paste(selector, content)
    await this.actionPause()
    await this.browseForStep('input_content')
  }

  async step4_uploadCover(imagePath) {
    this.log.info('[步骤4] 上传封面图')
    const absolutePath = path.resolve(imagePath)
    await this.uploadFile(SELECTORS.imageInput, [absolutePath])

    const pollInterval = cfg('upload.processing_poll_interval', 5000)
    await sleep(pollInterval)
    this.log.info('封面图上传完成')
    await this.browseForStep('upload_images')
  }

  async step5_publish() {
    if (this._dryRun) {
      this.log.info('[步骤5] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[步骤5] 发布文章')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    const waitAfterMin = cfg('steps.publish.wait_after_min', 5000)
    const waitAfterMax = cfg('steps.publish.wait_after_max', 15000)

    await randomDelay(reviewDelayMin, reviewDelayMax)
    await this.conditionalScreenshot('sspai_before_publish', 'before_publish')

    // 第一步: 点击顶部「发布」按钮（打开发布通道选择弹窗）
    let clicked = false
    try {
      const el = await this.page.$(SELECTORS.publishButton)
      if (el) {
        await this.clickElement(el)
        clicked = true
      }
    } catch { /* continue */ }

    if (!clicked) {
      const btn = await this.findByText('button', '发布')
      if (btn) {
        await this.clickElement(btn)
        clicked = true
      }
    }

    if (!clicked) {
      throw new Error('未找到发布按钮，页面结构可能已变更')
    }

    this.log.info('已点击发布按钮，等待发布通道弹窗')
    await randomDelay(1500, 3000)
    await this.conditionalScreenshot('sspai_publish_modal', 'step')

    // 第二步: 在弹窗中点击「立即发布」/ 「发布」确认
    let confirmed = false
    try {
      // 尝试找「立即发布」按钮
      const confirmBtn = await this.findByText('button', '立即发布')
      if (confirmBtn) {
        await this.clickElement(confirmBtn)
        confirmed = true
        this.log.info('已点击「立即发布」')
      }
    } catch { /* continue */ }

    if (!confirmed) {
      try {
        // fallback: 弹窗内的「发布」按钮（可能是 dialog 内的 primary button）
        const btns = await this.page.$$('button')
        for (const btn of btns) {
          const text = await btn.evaluate(el => el.textContent?.trim())
          if (text === '发布' || text === '确认发布') {
            await this.clickElement(btn)
            confirmed = true
            this.log.info(`已点击弹窗内「${text}」按钮`)
            break
          }
        }
      } catch { /* continue */ }
    }

    if (!confirmed) {
      this.log.warn('未检测到发布通道弹窗，可能已直接发布')
    }

    await randomDelay(waitAfterMin, waitAfterMax)
    await this.conditionalScreenshot('sspai_after_publish', 'after_publish')
  }

}
