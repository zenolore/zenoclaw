import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 微信视频号发布适配器
 *
 * 发布入口: https://channels.weixin.qq.com/platform/post/create
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新 selectors.js
 *
 * 视频号特点:
 *   - finder-ui-desktop-* 稳定类名
 *   - 视频 + 图文两种发布方式
 *   - 发布按钮文本为"发表"
 */

const SELECTORS = PUBLISH_SELECTORS

export class ChannelsAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'channels'
    this.publishUrl = 'https://channels.weixin.qq.com/platform/post/create'
  }

  getHomeUrl() { return 'https://channels.weixin.qq.com/platform' }
  getLoginUrl() { return 'https://channels.weixin.qq.com/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  async publish(post) {
    this.log.info('========== 视频号发布开始 ==========')
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发表按钮')

    // 设置任务标签和步骤
    const isVideo = !!post.video
    const isImage = !isVideo && post.images && post.images.length > 0
    const hasTitle = !!post.title
    this._overlayTaskLabel = isVideo ? '视频号 · 视频发布任务执行中' : '视频号 · 图文发布任务执行中'
    const steps = ['预热浏览', '打开发布页面']
    if (isVideo) steps.push('上传视频')
    else if (isImage) steps.push('上传图片')
    if (hasTitle) steps.push('输入标题')
    steps.push('点击发布')
    const T = steps.length
    let S = 0

    try {
      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开发布页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在打开视频号发布页面', { next: steps[S], step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())

      if (isVideo) {
        S++
        await this.showStatus('正在上传视频文件并等待处理', { next: steps[S] || '发布', step: S, total: T }).catch(() => {})
        await this.runStep('uploadVideo', () => this.step2_uploadVideo(post.video))
      } else if (isImage) {
        S++
        await this.showStatus('正在上传图片素材', { next: steps[S] || '发布', step: S, total: T }).catch(() => {})
        await this.runStep('uploadImages', () => this.step2_uploadImages(post.images))
      }

      if (hasTitle) {
        S++
        await this.showStatus('正在模拟人工输入标题', { next: '点击发布', step: S, total: T }).catch(() => {})
        await this.runStep('inputTitle', () => this.step3_inputTitle(post.title))
      }

      S++
      await this.showStatus('正在点击发表按钮', { step: S, total: T }).catch(() => {})
      await this.runStep('publish', () => this.step4_publish())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 视频号发布完成 ==========')
      return this.buildResult(true, '视频号发布成功')
    } catch (err) {
      this.log.error(`视频号发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  async step1_openPublishPage() {
    this.log.info('[Step 1] 打开视频号发布页')
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
    this.log.info('[Step 2] 上传图片')
    const fileInput = await this.findElement([SELECTORS.videoInput])
    if (!fileInput) { this.log.warn('未找到图片上传入口，跳过'); return }
    for (const img of images) {
      await this.uploadFile(fileInput, img)
      await randomDelay(1000, 3000)
    }
  }

  async step3_inputTitle(title) {
    this.log.info('[Step 3] 输入标题/描述')
    const el = await this.findElement([SELECTORS.descInput, SELECTORS.descInputAlt, SELECTORS.titleInput])
    if (!el) { this.log.warn('未找到描述输入框，跳过'); return }
    await this.humanTypeInElement(el, title)
    await randomDelay(500, 1500)
  }

  async step4_publish() {
    if (this._dryRun) {
      this.log.info('[Step 4] dryRun 模式，内容已填写，等待人工确认后手动发表')
      return
    }
    this.log.info('[Step 4] 点击发表')
    await this.clickByText('button', SELECTORS.publishButtonText)
    await randomDelay(2000, 5000)
  }
}
