import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'

/**
 * 抖音发布适配器（视频 / 图文）
 *
 * 视频上传页: https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web
 * 图文发布页: https://creator.douyin.com/creator-micro/content/post/imgtext
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新 selectors.js
 *
 * 抖音特点:
 *   - semi-* 组件库 + douyin-creator-master-* 稳定前缀
 *   - CSS Module hash 类名（不稳定）
 *   - 主要以视频为主，也支持图文/文章
 */

const SELECTORS = PUBLISH_SELECTORS

export class DouyinAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'douyin'
    this.publishUrl = 'https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web'
  }

  getHomeUrl() { return 'https://www.douyin.com/' }
  getLoginUrl() { return 'https://www.douyin.com/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  async publish(post) {
    this.log.info('========== 抖音发布开始 ==========')
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

    try {
      await this.showStatus('正在预热浏览...').catch(() => {})
      await this.warmupBrowse()

      await this.showStatus('正在打开发布页面...').catch(() => {})
      await this.step1_openPublishPage()

      if (post.video) {
        await this.showStatus('正在上传视频...').catch(() => {})
        await this.step2_uploadVideo(post.video)
      } else if (post.images && post.images.length > 0) {
        await this.showStatus('正在上传图片...').catch(() => {})
        await this.step2_uploadImages(post.images)
      }

      if (post.title) {
        await this.showStatus('正在输入标题...').catch(() => {})
        await this.step3_inputTitle(post.title)
      }

      await this.showStatus('正在发布...').catch(() => {})
      await this.step4_publish()
      await this.showStatus('发布完成！').catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 抖音发布完成 ==========')
      return this.buildResult(true, '抖音发布成功')
    } catch (err) {
      this.log.error(`抖音发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  async step1_openPublishPage() {
    this.log.info('[Step 1] 打开抖音创作者中心')
    await this.navigateTo(this.publishUrl)
    await randomDelay(cfg('timing.action_delay_min', 1000), cfg('timing.action_delay_max', 3000))
  }

  async step2_uploadVideo(videoPath) {
    this.log.info('[Step 2] 上传视频文件')
    const fileInput = await this.findElement([SELECTORS.videoInput])
    if (!fileInput) throw new Error('未找到视频上传入口')
    await this.uploadFile(fileInput, videoPath)
    await randomDelay(3000, 8000)
  }

  async step2_uploadImages(images) {
    this.log.info('[Step 2] 上传图文')
    await this.navigateTo('https://creator.douyin.com/creator-micro/content/post/imgtext')
    await randomDelay(2000, 4000)
    const fileInput = await this.findElement([SELECTORS.videoInput])
    if (!fileInput) { this.log.warn('未找到图片上传入口，跳过'); return }
    for (const img of images) {
      await this.uploadFile(fileInput, img)
      await randomDelay(1000, 3000)
    }
  }

  async step3_inputTitle(title) {
    this.log.info('[Step 3] 输入标题')
    const el = await this.findElement([SELECTORS.titleInput])
    if (!el) { this.log.warn('未找到标题输入框，跳过'); return }
    await this.humanTypeInElement(el, title)
    await randomDelay(500, 1500)
  }

  async step4_publish() {
    if (this._dryRun) {
      this.log.info('[Step 4] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[Step 4] 点击发布')
    await this.clickByText('button', SELECTORS.publishButtonText)
    await randomDelay(2000, 5000)
  }
}
