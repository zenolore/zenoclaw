import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import {
  PUBLISH_SELECTORS,
  INTERACT_SELECTORS,
  BROWSE_SELECTORS,
  CREATOR_ENTRY_SELECTORS
} from './selectors.js'

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

  /**
   * 多入口策略：每次发布按 persona 偏好 + 历史去重 选一种方式进入发布页
   * 不要每次都从同一个入口进，否则平台风控能识别这种同质化模式
   *
   * 入口候选（按权重大致偏好）:
   *   - dashboard: 已经登录 creator.douyin.com 后台 → 顶部"发布作品"按钮（最自然）
   *   - avatar:    主站 hover 头像 → 下拉里点"创作者中心"
   *   - topbar:    主站顶部直接点"创作者中心"或"上传"
   *   - directUrl: 直接 goto upload URL（兜底；老练型 persona 也偏好）
   */
  getCreatorEntryStrategies() {
    const ENTRY = CREATOR_ENTRY_SELECTORS
    const uploadUrl = this.publishUrl

    return [
      {
        key: 'dashboard',
        label: '创作者后台首页 → 发布作品按钮',
        weight: 3,
        run: async (adapter) => {
          await adapter.navigateTo(ENTRY.creatorHomeUrl)
          await randomDelay(800, 1800)
          // 优先按文本找按钮，找不到再试 selectors
          const clicked = await adapter.clickByText('button', ENTRY.dashboardPublishButtonText, { timeoutMs: 4000 }).catch(() => false)
          if (!clicked) {
            for (const sel of ENTRY.dashboardPublishButton) {
              try {
                await adapter.clickEntrySelector(sel)
                return
              } catch { /* try next */ }
            }
            throw new Error('dashboard publish button not found')
          }
          await randomDelay(1200, 2400)
        }
      },
      {
        key: 'avatar',
        label: '主站头像下拉 → 创作者中心',
        weight: 2,
        run: async (adapter) => {
          // 先确保在主站
          if (!adapter.page.url().startsWith(adapter.getHomeUrl())) {
            await adapter.navigateTo(adapter.getHomeUrl())
            await randomDelay(1500, 3000)
          }
          // hover 头像
          let hovered = false
          for (const sel of ENTRY.avatarTrigger) {
            try {
              await adapter.page.waitForSelector(sel, { visible: true, timeout: 3000 })
              await adapter.cursor?.move?.(sel, { paddingPercentage: 12 })
              hovered = true
              break
            } catch { /* try next */ }
          }
          if (!hovered) throw new Error('avatar trigger not found')
          await randomDelay(700, 1500)
          // 点下拉里"创作者中心"
          const clicked = await adapter.clickByText('a', ENTRY.avatarMenuCreatorText, { timeoutMs: 3000 }).catch(() => false)
          if (!clicked) {
            for (const sel of ENTRY.avatarMenuCreatorEntry) {
              try { await adapter.clickEntrySelector(sel); return } catch { /* try next */ }
            }
            throw new Error('avatar menu creator entry not found')
          }
          await randomDelay(1500, 3000)
          // 创作者中心首页之后再点"发布作品"
          const pubClicked = await adapter.clickByText('button', ENTRY.dashboardPublishButtonText, { timeoutMs: 4000 }).catch(() => false)
          if (!pubClicked) {
            // 兜底直接 goto upload
            await adapter.navigateTo(uploadUrl)
          }
        }
      },
      {
        key: 'topbar',
        label: '主站顶部直链入口',
        weight: 2,
        run: async (adapter) => {
          if (!adapter.page.url().startsWith(adapter.getHomeUrl())) {
            await adapter.navigateTo(adapter.getHomeUrl())
            await randomDelay(1500, 3000)
          }
          const clicked = await adapter.clickByText('a', ENTRY.topbarCreatorText, { timeoutMs: 3500 }).catch(() => false)
          if (!clicked) {
            for (const sel of ENTRY.topbarCreatorEntry) {
              try { await adapter.clickEntrySelector(sel); break } catch { /* try next */ }
            }
          }
          await randomDelay(1200, 2200)
          const pubClicked = await adapter.clickByText('button', ENTRY.dashboardPublishButtonText, { timeoutMs: 4000 }).catch(() => false)
          if (!pubClicked) {
            await adapter.navigateTo(uploadUrl)
          }
        }
      },
      {
        key: 'directUrl',
        label: '直接 URL 进入 upload',
        weight: 1,
        run: async (adapter) => {
          await adapter.navigateTo(uploadUrl)
          await randomDelay(800, 1800)
        }
      }
    ]
  }

  async publish(post) {
    this.log.info('========== 抖音发布开始 ==========')
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

    // 根据内容类型设置任务标签和步骤数
    const isVideo = !!post.video
    const isImage = !isVideo && post.images && post.images.length > 0
    const hasTitle = !!post.title
    this._overlayTaskLabel = isVideo ? '抖音 · 视频发布任务执行中' : '抖音 · 图文发布任务执行中'
    // 动态计算总步骤：预热 + 打开页面 + 上传(可选) + 标题(可选) + 通读 + 发布
    const steps = ['预热浏览', '打开发布页面']
    if (isVideo) steps.push('上传视频文件')
    else if (isImage) steps.push('上传图片')
    if (hasTitle) steps.push('输入标题')
    steps.push('模拟人工通读检查', '点击发布')
    const T = steps.length
    let S = 0

    try {
      S++
      await this.showStatus('正在模拟人工预热浏览', { next: steps[S], step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在通过多入口策略打开发布页面', { next: steps[S], step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())

      if (isVideo) {
        S++
        await this.showStatus('正在上传视频文件并等待处理', { next: steps[S] || '通读检查', step: S, total: T }).catch(() => {})
        await this.runStep('uploadVideo', () => this.step2_uploadVideo(post.video))
      } else if (isImage) {
        S++
        await this.showStatus('正在上传图片素材', { next: steps[S] || '通读检查', step: S, total: T }).catch(() => {})
        await this.runStep('uploadImages', () => this.step2_uploadImages(post.images))
      }

      if (hasTitle) {
        S++
        await this.showStatus('正在模拟人工输入标题', { next: steps[S] || '通读检查', step: S, total: T }).catch(() => {})
        await this.runStep('inputTitle', () => this.step3_inputTitle(post.title))
      }

      // 写完后通读检查：滚到顶看标题、慢速滚到底、偶发回滚
      S++
      await this.showStatus('正在模拟人工通读检查内容', { next: '点击发布', step: S, total: T }).catch(() => {})
      await this.runStep('reviewBeforeSubmit', () => this.reviewBeforeSubmit())

      S++
      await this.showStatus('正在点击发布按钮', { step: S, total: T }).catch(() => {})
      await this.runStep('publish', () => this.step4_publish())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})
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
    this.log.info('[Step 1] 打开抖音创作者中心（多入口策略）')
    // 不再直接 goto；按 persona 偏好 + 历史去重选一种入口；全部失败时兜底 goto
    await this.navigateToPublishViaEntry()
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
