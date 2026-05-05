import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import {
  PUBLISH_SELECTORS,
  INTERACT_SELECTORS,
  BROWSE_SELECTORS,
  CREATOR_ENTRY_SELECTORS
} from './selectors.js'
import path from 'path'

/**
 * B站 (Bilibili) 专栏文章投稿适配器
 *
 * 投稿页: https://member.bilibili.com/platform/upload/text/new-edit
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新 selectors.js
 *
 * B站特点:
 *   - 专栏文章模式（标题 + 富文本正文）
 *   - 正文编辑器在 iframe(york/read-editor) 内，需切换 frame 操作
 *   - 标题 textarea 在主页面
 *   - 封面图上传在主页面
 */

const SELECTORS = PUBLISH_SELECTORS

export class BilibiliAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'bilibili'
    this.publishUrl = SELECTORS.publishUrl || 'https://member.bilibili.com/platform/upload/text/new-edit'
  }

  // 平台元数据
  getHomeUrl() { return 'https://www.bilibili.com/' }
  getLoginUrl() { return 'https://passport.bilibili.com/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  /**
   * 多入口策略：每次进专栏投稿页换一种方式（按 persona 偏好 + 历史去重）
   *
   * B 站专栏 URL 是 member.bilibili.com/platform/upload/text/new-edit；
   * 主站「投稿」按钮指向视频投稿，不是专栏。所以入口候选都是经过创作中心
   * 自然过渡，再 goto 专栏页（保留 Referer + SPA 路由真实性）。
   *
   * 候选：
   *   - topbarCreator: 主站 → 顶栏「创作中心」 → goto 专栏 edit
   *   - dashboard:     主站 → 顶栏「投稿」(a#nav_upload_btn 区域) → 在创作中心后台再 goto 专栏 edit
   *   - directUrl:     直接 goto 专栏 edit URL（兜底）
   */
  getCreatorEntryStrategies() {
    const ENTRY = CREATOR_ENTRY_SELECTORS
    const editUrl = this.publishUrl
    const homeUrl = this.getHomeUrl()

    return [
      {
        key: 'topbar',
        label: '主站顶栏「创作中心」 → 专栏编辑页',
        weight: 3,
        run: async (adapter) => {
          if (!adapter.page.url().startsWith(homeUrl.replace(/\/$/, ''))) {
            await adapter.navigateTo(homeUrl)
            await randomDelay(1500, 3000)
          }
          let clicked = false
          try {
            clicked = await adapter.clickByText('a', ENTRY.topbarCreatorText, { timeoutMs: 4000 })
          } catch { /* try selectors */ }
          if (!clicked) {
            for (const sel of ENTRY.topbarCreatorEntry) {
              try { await adapter.clickEntrySelector(sel); clicked = true; break } catch { /* next */ }
            }
          }
          if (!clicked) throw new Error('topbar 创作中心入口未命中')
          await randomDelay(2500, 4500) // 等创作中心首页加载
          // 在创作中心后台再 goto 专栏 edit URL（自然路由切换）
          await adapter.navigateTo(editUrl)
          await randomDelay(1500, 3000)
        }
      },
      {
        key: 'dashboard',
        label: '主站顶栏「投稿」 → 创作中心 → 专栏编辑页',
        weight: 2,
        run: async (adapter) => {
          if (!adapter.page.url().startsWith(homeUrl.replace(/\/$/, ''))) {
            await adapter.navigateTo(homeUrl)
            await randomDelay(1500, 3000)
          }
          let clicked = false
          for (const sel of ENTRY.topbarUploadEntry) {
            try { await adapter.clickEntrySelector(sel); clicked = true; break } catch { /* next */ }
          }
          if (!clicked) {
            try { clicked = await adapter.clickByText('a', ENTRY.topbarUploadText, { timeoutMs: 3500 }) } catch { /* next */ }
          }
          if (!clicked) throw new Error('topbar 投稿入口未命中')
          await randomDelay(2500, 4500)
          // 投稿主页（视频投稿）已加载，再切到专栏 edit URL
          await adapter.navigateTo(editUrl)
          await randomDelay(1500, 3000)
        }
      },
      {
        key: 'directUrl',
        label: '直接 URL 进入专栏编辑页',
        weight: 1,
        run: async (adapter) => {
          await adapter.navigateTo(editUrl)
          await randomDelay(800, 1800)
        }
      }
    ]
  }

  /**
   * 执行完整的专栏投稿流程
   */
  async publish(post) {
    this.log.info('========== B站投稿开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

    // 设置任务标签和步骤
    this._overlayTaskLabel = 'B站 · 专栏文章发布任务执行中'
    const hasCover = post.images && post.images.length > 0
    const steps = ['预热浏览', '打开投稿页面', '输入标题', '输入正文']
    if (hasCover) steps.push('上传封面图')
    steps.push('模拟人工通读检查', '发布文章')
    const T = steps.length
    let S = 0

    try {
      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开投稿页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在通过多入口策略打开投稿页面', { next: '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())

      S++
      await this.showStatus('正在模拟人工输入标题', { next: '输入正文', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step2_inputTitle(post.title))

      S++
      await this.showStatus('正在模拟人工输入正文内容', { next: hasCover ? '上传封面图' : '通读检查', step: S, total: T }).catch(() => {})
      await this.runStep('inputContent', () => this.step3_inputContent(post.content))

      if (hasCover) {
        S++
        await this.showStatus('正在上传封面图并等待处理', { next: '通读检查', step: S, total: T }).catch(() => {})
        await this.runStep('uploadCover', () => this.step4_uploadCover(post.images[0]))
      }

      // 写完后通读检查：滚到顶看标题、慢速滚到底、偶发回滚
      S++
      await this.showStatus('正在模拟人工通读检查内容', { next: '发布文章', step: S, total: T }).catch(() => {})
      await this.runStep('reviewBeforeSubmit', () => this.reviewBeforeSubmit())

      S++
      await this.showStatus('正在点击发布按钮提交文章', { step: S, total: T }).catch(() => {})
      await this.runStep('publish', () => this.step5_publish())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})
      await this.hideStatus().catch(() => {})

      // 2026-04-15 安全加固：仅在 step5_publish 未命中显式失败时，才继续执行发布后浏览。
      // 修改原因：B站原逻辑点击发布后只等待和截图，若页面已出现失败/审核/频繁提示，仍会继续伪装成功链路。
      // 回退方式：删除 step5_publish() 中 conservativeVerifyPublishResult() 调用即可恢复旧逻辑。
      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== B站投稿成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`B站投稿失败: ${err.message}`)
      await this.conditionalScreenshot('bilibili_error', 'error')
      return this.buildResult(false, err)
    }
  }

  // ============================================================
  // 各步骤实现
  // ============================================================

  async step1_openPublishPage() {
    this.log.info('[步骤1] 打开B站专栏投稿页（多入口策略）')
    // 不再直接 goto；按 persona 偏好 + 历史去重选一种入口；全部失败时兜底 goto
    await this.navigateToPublishViaEntry()

    // 登录检测
    const currentUrl = this.page.url()
    if (currentUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录B站')
    }

    await this.conditionalScreenshot('bilibili_step1_open', 'step')
    await this.browseForStep('open_page')
  }

  /**
   * 获取并缓存编辑器 iframe frame 对象
   * B站所有表单元素（标题/正文/发布按钮）均在 york/read-editor iframe 内
   */
  async _getEditorFrame() {
    if (this._editorFrame) return this._editorFrame

    const elementTimeout = cfg('browser.element_timeout', 30000)
    await this.page.waitForSelector(SELECTORS.editorFrame, { timeout: elementTimeout })

    const frameEl = await this.page.$(SELECTORS.editorFrame)
    const frame = await frameEl.contentFrame()
    if (!frame) throw new Error('无法切换到B站编辑器 iframe')

    await randomDelay(1000, 2000)
    this._editorFrame = frame
    return frame
  }

  async step2_inputTitle(title) {
    this.log.info('[步骤2] 输入标题（iframe 内）')

    const frame = await this._getEditorFrame()

    // 标题 textarea 在 iframe 内：class="title-input__inner"
    const titleSel = SELECTORS.titleInputAlt  // '.title-input__inner'
    await frame.waitForSelector(titleSel, { visible: true, timeout: cfg('browser.element_timeout', 30000) })

    await frame.click(titleSel)
    await randomDelay(300, 800)

    // CDP 输入标题（防止中文乱码）
    // 注意: Frame 没有 .target()，使用 page 级 CDP；insertText 作用于当前聚焦元素
    const cdp = await this.page.target().createCDPSession()
    await cdp.send('Input.insertText', { text: title })
    await cdp.detach()

    await this.actionPause()
    await this.conditionalScreenshot('bilibili_step2_title', 'step')
    await this.browseForStep('input_title')
  }

  async step3_inputContent(content) {
    this.log.info('[步骤3] 输入正文（iframe 内 TipTap 编辑器）')

    const frame = await this._getEditorFrame()
    const elementTimeout = cfg('browser.element_timeout', 30000)

    // 等待正文编辑器出现
    await frame.waitForSelector(SELECTORS.contentInput, { visible: true, timeout: elementTimeout })

    // 点击激活编辑器（初始 contenteditable="false"，点击后 TipTap 切换为可编辑）
    await frame.click(SELECTORS.contentInput)
    await randomDelay(800, 1500)

    // 检查 contenteditable 是否已变为 true
    const ceEnabled = await frame.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      return el.getAttribute('contenteditable') === 'true'
    }, SELECTORS.contentInput)

    const cdp = await this.page.target().createCDPSession()
    const paragraphs = content.split('\n')

    if (ceEnabled) {
      // contenteditable="true"：使用 CDP insertText（中文友好）
      this.log.info('[步骤3] 编辑器已激活，使用 CDP insertText')
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i].length > 0) {
          await cdp.send('Input.insertText', { text: paragraphs[i] })
        }
        if (i < paragraphs.length - 1) {
          await randomDelay(200, 500)
          await this.page.keyboard.press('Enter')
          await randomDelay(800, 2000)
        }
      }
    } else {
      // contenteditable="false"：降级通过 CDP 模拟按键事件（TipTap 监听 keydown）
      this.log.warn('[步骤3] 编辑器未标记为 contenteditable="true"，使用 insertText 降级输入')
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i].length > 0) {
          // CDP dispatchKeyEvent 可以触发 TipTap 内部的 keydown 监听
          await cdp.send('Input.insertText', { text: paragraphs[i] })
        }
        if (i < paragraphs.length - 1) {
          await randomDelay(200, 500)
          await this.page.keyboard.press('Enter')
          await randomDelay(800, 2000)
        }
      }
    }
    await cdp.detach()

    await this.actionPause()
    await this.conditionalScreenshot('bilibili_step3_content', 'step')
    await this.browseForStep('input_content')
  }

  async step4_uploadCover(imagePath) {
    this.log.info('[步骤4] 上传封面图')

    const absolutePath = path.resolve(imagePath)

    try {
      // 封面图上传 input 在主页面
      const fileInputSelector = 'input[type="file"]'
      await this.uploadFile(fileInputSelector, [absolutePath])

      const pollInterval = cfg('upload.processing_poll_interval', 5000)
      this.log.info('等待封面图处理...')
      await sleep(pollInterval)
      this.log.info('封面图上传完成')
    } catch (err) {
      this.log.warn(`封面图上传失败，跳过: ${err.message}`)
    }

    await this.conditionalScreenshot('bilibili_step4_cover', 'step')
    await this.browseForStep('upload_images')
  }

  async step5_publish() {
    if (this._dryRun) {
      this.log.info('[步骤5] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[步骤5] 发布专栏文章')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    const waitAfterMin   = cfg('steps.publish.wait_after_min', 5000)
    const waitAfterMax   = cfg('steps.publish.wait_after_max', 15000)

    await randomDelay(reviewDelayMin, reviewDelayMax)
    await this.conditionalScreenshot('bilibili_before_publish', 'before_publish')

    // 发布按钮在 york/read-editor iframe 内
    const frame = await this._getEditorFrame()

    let clicked = false

    // 优先用 CSS class 匹配（button.vui_button--blue）
    try {
      const el = await frame.$(SELECTORS.publishButton)
      if (el) {
        await el.click()
        clicked = true
        this.log.info('在 iframe 内点击发布按钮（class）')
      }
    } catch { /* continue */ }

    // fallback：在 iframe 内文本匹配"发布"按钮
    if (!clicked) {
      try {
        const buttons = await frame.$$('button')
        for (const btn of buttons) {
          const text = await btn.evaluate(el => el.textContent.trim())
          if (text === SELECTORS.publishButtonText || text.includes(SELECTORS.publishButtonText)) {
            await btn.click()
            clicked = true
            this.log.info('在 iframe 内点击发布按钮（文本匹配）')
            break
          }
        }
      } catch { /* continue */ }
    }

    // 最终 fallback：在主页面找（兼容未来改版）
    if (!clicked) {
      const btn = await this.findByText('button', SELECTORS.publishButtonText)
      if (btn) {
        await btn.click()
        clicked = true
        this.log.info('在主页面点击发布按钮')
      }
    }

    if (!clicked) {
      throw new Error('未找到发布按钮（已搜索 iframe 内和主页面），页面结构可能已变更')
    }

    await randomDelay(waitAfterMin, waitAfterMax)
    await this.conditionalScreenshot('bilibili_after_publish', 'after_publish')

    // 2026-04-15 安全加固：B站接入保守发布结果校验。
    // 修改策略：
    // - 先保留现有等待 + 截图，避免改变页面稳定时机；
    // - 再附加文本失败检测，只拦截明确失败；
    // - 当前不把 unknown 收紧为失败，避免影响现网成功率。
    // 回退方式：删除下方 conservativeVerifyPublishResult() 调用。
    await this.conservativeVerifyPublishResult({
      guardName: 'bilibili_step5_publish',
      waitOptions: {
        successTexts: ['发布成功', '投稿成功', '发表成功', '提交成功'],
        errorTexts: ['发布失败', '投稿失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核'],
        timeout: 12000,
      },
      useVisionWhenUnknown: false,
    })
  }
}
