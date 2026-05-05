import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep, simulateBrowsing } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'
import path from 'path'

/**
 * 小红书发帖适配器
 *
 * 发帖页面: https://creator.xiaohongshu.com/publish/publish
 *
 * ⚠️ 重要：以下 CSS 选择器基于 2025 年页面结构，
 *    如果小红书改版，需要手动更新这些选择器。
 *    调试方法：在 Chrome 中打开发帖页面，按 F12 检查元素。
 *
 * 配置项:
 *   steps.open_page.*        — 打开页面后的浏览时间
 *   steps.upload_images.*    — 上传图片后的浏览时间
 *   steps.input_title.*      — 输入标题后的浏览时间
 *   steps.input_content.*    — 输入正文后的浏览时间
 *   steps.add_tags.*         — 添加标签的延迟和浏览时间
 *   steps.publish.*          — 发布前后的等待时间
 *   upload.*                 — 文件上传轮询参数
 *   screenshot.*             — 截图策略
 *   tab.*                    — 发布后浏览和标签页关闭
 */

// 选择器引用自 ./selectors.js 集中管理
const SELECTORS = PUBLISH_SELECTORS

export class XiaohongshuAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'xiaohongshu'
    // URL 必须带参数直接进入图文模式（2026-03 验证）
    this.publishUrl = 'https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=image'
  }

  // 平台元数据
  getHomeUrl() { return 'https://www.xiaohongshu.com/explore' }
  getLoginUrl() { return 'https://creator.xiaohongshu.com/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  /**
   * 执行完整的发帖流程
   */
  async publish(post) {
    this.log.info('========== 小红书发帖开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

    // 设置任务标签和步骤
    this._overlayTaskLabel = '小红书 · 图文发布任务执行中'
    const hasImages = post.images && post.images.length > 0
    const hasTags = post.tags && post.tags.length > 0
    const hasSchedule = !!post.scheduleTime
    const steps = ['预热浏览', '打开发布页面']
    if (hasImages) steps.push('上传图片')
    steps.push('输入标题', '输入正文')
    if (hasTags) steps.push('添加标签')
    steps.push('内容类型声明')
    if (hasSchedule) steps.push('设置定时发布')
    steps.push('AI 视觉验证', '发布笔记')
    const T = steps.length
    let S = 0

    try {
      // 发帖前预热浏览：先浏览首页 feed，建立自然行为链
      S++
      await this.showStatus('正在模拟人工预热浏览首页', { next: '打开发布页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在打开小红书发布页面', { next: hasImages ? '上传图片' : '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())

      // 先上传图片 → 等待编辑器出现 → 再填标题/正文（顺序很重要）
      if (hasImages) {
        S++
        await this.showStatus('正在上传图片素材并等待处理', { next: '输入标题', step: S, total: T }).catch(() => {})
        await this.runStep('uploadImages', () => this.step2_uploadImages(post.images))
      }

      S++
      await this.showStatus('正在模拟人工输入标题', { next: '输入正文', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step3_inputTitle(post.title))

      S++
      await this.showStatus('正在模拟人工输入正文内容', { next: hasTags ? '添加标签' : '内容类型声明', step: S, total: T }).catch(() => {})
      await this.runStep('inputContent', () => this.step4_inputContent(post.content))

      if (hasTags) {
        S++
        await this.showStatus('正在搜索并添加话题标签', { next: '内容类型声明', step: S, total: T }).catch(() => {})
        await this.runStep('addTags', () => this.step5_addTags(post.tags))
      }

      // 内容类型声明（仅 AI 内容需要声明，正常原创内容跳过）
      S++
      await this.showStatus('正在设置内容类型声明', { next: hasSchedule ? '设置定时发布' : 'AI 视觉验证', step: S, total: T }).catch(() => {})
      await this.runStep('declareOriginal', () => this.step_declareOriginal(post))

      // 定时发布（如果提供了 scheduleTime）
      if (hasSchedule) {
        S++
        await this.showStatus('正在设置定时发布时间', { next: 'AI 视觉验证', step: S, total: T }).catch(() => {})
        await this.runStep('setScheduleTime', () => this.step_setScheduleTime(post.scheduleTime))
      }

      // AI 视觉验证：发布前截图确认内容正确
      S++
      await this.showStatus('正在进行 AI 视觉验证截图', { next: '发布笔记', step: S, total: T }).catch(() => {})
      const verification = await this.verifyBeforePublish({
        title: post.title,
        content: post.content,
        tags: post.tags,
        imageCount: post.images?.length || 0
      })
      if (!verification.pass && verification.confidence > 0.8) {
        if (this._dryRun) {
          throw new Error(`[视觉验证] 内容验证未通过（置信度 ${verification.confidence}）: ${verification.details}\n问题: ${verification.issues.join('; ')}`)
        }
        this.log.warn(`[视觉验证] 内容验证未通过，但继续发布: ${verification.details}`)
      }

      S++
      await this.showStatus('正在点击发布按钮提交笔记', { step: S, total: T }).catch(() => {})
      await this.runStep('publish', () => this.step6_publish())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})

      // 补足时间到目标总时长
      await this.fillRemainingTime()

      // 返回首页后继续浏览（dry-run 模式留在发布页供人工检查）
      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 小红书发帖成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`小红书发帖失败: ${err.message}`)
      await this.conditionalScreenshot('xhs_error', 'error')
      return this.buildResult(false, err)
    }
  }

  // ============================================================
  // 各步骤实现 — 浏览时间全部从 config.steps.* 读取
  // ============================================================

  async step1_openPublishPage() {
    this.log.info('[步骤1] 自然导航到发帖页面')

    // 自然路径：创作者中心首页 → 短暂浏览 → 点击"发布笔记"
    const creatorHome = 'https://creator.xiaohongshu.com/new/home'
    try {
      await this.navigateTo(creatorHome)

      // 登录检测
      const afterCreatorUrl = this.page.url()
      if (afterCreatorUrl.includes(SELECTORS.loginPageIndicator)) {
        throw new Error('未登录或登录已过期，请先在浏览器中登录小红书创作者中心')
      }

      // 在创作者中心短暂浏览（看看数据，像真人一样）
      const creatorBrowseMs = Math.floor(cfg('timing.warmup_browse_min', 300) * 200) // 约 60s
      await simulateBrowsing(this.page, this.cursor, Math.min(creatorBrowseMs, 90000))

      // 尝试点击"发布笔记"按钮进入编辑页
      const publishLink = await this.findByText('*', '发布笔记')
      if (publishLink) {
        this.log.info('[步骤1] 点击"发布笔记"按钮')
        await this.clickElement(publishLink)
        await randomDelay(2000, 4000)

        // 检查是否成功导航到发帖页
        const afterClickUrl = this.page.url()
        if (afterClickUrl.includes('/publish')) {
          this.log.info('[步骤1] 已通过自然导航到达发帖页')
        } else {
          // 点击后没到发帖页，fallback 到直接导航
          this.log.info('[步骤1] 点击后未到达发帖页，fallback 到直接导航')
          await this.navigateTo(this.publishUrl)
        }
      } else {
        // 没找到发布按钮，fallback 到直接导航
        this.log.info('[步骤1] 未找到"发布笔记"按钮，fallback 到直接导航')
        await this.navigateTo(this.publishUrl)
      }
    } catch (err) {
      // 自然导航失败，fallback 到直接 goto
      if (err.message.includes('未登录')) throw err
      this.log.warn(`[步骤1] 自然导航失败: ${err.message}，fallback 到直接导航`)
      await this.navigateTo(this.publishUrl)
    }

    // 最终登录检测
    const currentUrl = this.page.url()
    if (currentUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录小红书创作者中心')
    }

    // 等待上传区域就绪（小红书编辑器需先上传图片，标题/正文输入框才会出现）
    await this.page.waitForSelector(
      [SELECTORS.uploadInput, SELECTORS.uploadInputAlt, SELECTORS.uploadInputFallback].join(', '),
      { timeout: 20000 }
    ).catch(() => this.log.warn('[步骤1] 未检测到上传控件，继续尝试'))

    await this.conditionalScreenshot('xhs_step1_open', 'step')
    await this.browseForStep('open_page')
  }

  async step2_uploadImages(imagePaths) {
    this.log.info(`[步骤2] 上传 ${imagePaths.length} 张图片`)

    const absolutePaths = imagePaths.map(p => path.resolve(p))

    const selector = await this.findSelector([
      SELECTORS.uploadInput,
      SELECTORS.uploadInputAlt,
      SELECTORS.uploadInputFallback,
    ])

    await this.uploadFile(selector, absolutePaths)

    // 等待图片处理 — 从 config.upload.* 读取
    const pollInterval   = cfg('upload.processing_poll_interval', 5000)
    const pollMaxAttempts = cfg('upload.processing_poll_max_attempts', 12)

    this.log.info('等待图片处理...')
    await sleep(pollInterval)

    for (let i = 0; i < pollMaxAttempts; i++) {
      const uploading = await this.page.$('.uploading, .progress')
      if (!uploading) break
      this.log.debug(`图片处理中... (${i + 1}/${pollMaxAttempts})`)
      await sleep(pollInterval)
    }

    // 硬确认：验证上传的图片实际出现在编辑器中
    const uploadedCount = await this.page.evaluate(() => {
      // 小红书上传后图片以缩略图或 img 元素呈现
      const imgs = document.querySelectorAll(
        '.image-item, .upload-item:not(.upload-input), [class*="image"] img, .preview-item, .c-image img'
      )
      return Array.from(imgs).filter(el => el.offsetParent !== null).length
    })
    if (uploadedCount >= imagePaths.length) {
      this.log.info(`图片上传确认: ${uploadedCount}/${imagePaths.length} 张图片已就绪`)
    } else if (uploadedCount > 0) {
      this.log.warn(`图片上传部分成功: 期望 ${imagePaths.length} 张，实际 ${uploadedCount} 张`)
    } else {
      this.log.warn(`图片上传未确认: 未检测到已上传的图片元素，可能选择器需更新`)
    }
    // 图片上传后等待编辑器（标题+正文）就绪
    await this.waitForEditorReady(
      [SELECTORS.titleInput, SELECTORS.titleInputAlt, SELECTORS.titleInputFallback],
      [SELECTORS.contentInput, SELECTORS.contentInputAlt, SELECTORS.contentInputFallback],
      20000
    )

    await this.conditionalScreenshot('xhs_step2_upload', 'step')
    await this.browseForStep('upload_images')
  }

  async step3_inputTitle(title) {
    this.log.info('[步骤3] 输入标题')

    const selector = await this.findSelector([
      SELECTORS.titleInput,
      SELECTORS.titleInputAlt,
      SELECTORS.titleInputFallback,
    ])

    // 标题是普通 <input>，keyboard.type 可靠
    await this.type(selector, title)
    const titleOk = await this.assertInputValue(
      [SELECTORS.titleInput, SELECTORS.titleInputAlt, SELECTORS.titleInputFallback],
      title, '标题'
    )
    if (!titleOk) throw new Error('标题输入验证失败，内容可能未正确填入')
    await this.actionPause()
    await this.conditionalScreenshot('xhs_step3_title', 'step')
    await this.browseForStep('input_title')
  }

  async step4_inputContent(content) {
    this.log.info('[步骤4] 输入正文')

    const selector = await this.findSelector([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
      SELECTORS.contentInputFallback,
    ])

    // ⚠️ 正文是 Tiptap/ProseMirror 富文本编辑器（contenteditable div）
    // keyboard.type 对中文不可靠，必须用 CDP insertText
    await this.paste(selector, content)
    const contentOk = await this.assertRichTextContent(
      [SELECTORS.contentInput, SELECTORS.contentInputAlt, SELECTORS.contentInputFallback],
      content, '正文'
    )
    if (!contentOk) throw new Error('正文输入验证失败，内容可能未正确填入')
    await this.actionPause()
    await this.conditionalScreenshot('xhs_step4_content', 'step')
    await this.browseForStep('input_content')
  }

  async step5_addTags(tags) {
    this.log.info(`[步骤5] 添加 ${tags.length} 个话题标签`)

    const searchDelayMin = cfg('steps.add_tags.search_delay_min', 1000)
    const searchDelayMax = cfg('steps.add_tags.search_delay_max', 2000)
    const selectDelayMin = cfg('steps.add_tags.select_delay_min', 2000)
    const selectDelayMax = cfg('steps.add_tags.select_delay_max', 4000)

    // 小红书话题通过编辑器内 # 触发建议下拉
    // 点击 "# 话题" 按钮 → 在编辑器中插入 # → 输入关键词 → 点击建议项
    for (const tag of tags) {
      try {
        // 1. 点击话题按钮（在编辑器中插入 #）
        const topicBtn = await this.page.$(SELECTORS.tagButton || SELECTORS.topicButton)
        if (!topicBtn) {
          this.log.warn(`  未找到话题按钮，跳过标签 "${tag}"`)
          continue
        }
        await this.clickElement(topicBtn)
        await randomDelay(searchDelayMin, searchDelayMax)

        // 2. 输入话题关键词（CDP insertText，不含 #）
        const cdp = await this.page.target().createCDPSession()
        await cdp.send('Input.insertText', { text: tag })
        await cdp.detach().catch(() => {})
        this.log.info(`  输入话题: #${tag}`)
        await randomDelay(selectDelayMin, selectDelayMax)

        // 3. 点击建议下拉中的第一个匹配项（收窄选择器范围，避免全页扫描）
        const suggHandle = await this.page.evaluateHandle((tagText) => {
          // 精确选择器：小红书话题建议下拉的已知容器
          const allItems = Array.from(document.querySelectorAll(
            '.tag-item, .topic-item, .item.is-selected, .topic-list .item, ' +
            '[class*="topic-list"] > *, [class*="suggest"] li, [class*="dropdown"] li'
          )).filter(el => el.offsetParent !== null && el.textContent.includes('#'))

          // 优先精确匹配
          const exact = allItems.find(el => el.textContent.includes('#' + tagText))
          if (exact) return exact

          // fallback: 第一个可见的带 # 的建议
          if (allItems.length > 0) return allItems[0]

          return null
        }, tag)

        const suggEl = suggHandle.asElement()
        if (suggEl) {
          const text = await this.page.evaluate(el => el.textContent.trim().substring(0, 30), suggEl)
          await this.clickElement(suggEl)
          this.log.info(`  选中话题: ${text}`)
        } else {
          // 无建议项时按 Enter 确认纯文本话题
          await this.page.keyboard.press('Enter')
          this.log.info(`  话题 "${tag}" Enter 确认`)
        }
        await sleep(800)

      } catch (err) {
        this.log.warn(`添加标签 "${tag}" 失败，跳过: ${err.message}`)
        // 按 Escape 关闭残留弹窗
        await this.page.keyboard.press('Escape').catch(() => {})
        await sleep(300)
      }
    }

    await this.conditionalScreenshot('xhs_step5_tags', 'step')
    await this.browseForStep('add_tags')
  }

  /**
   * 内容类型声明（2026-04 实测: 小红书已移除"原创声明"）
   *
   * 新 UI 为"添加内容类型声明"下拉，可选项:
   *   - 虚构演绎，仅供娱乐
   *   - 笔记含AI合成内容
   *   - 内容包含营销广告
   *   - 内容来源声明
   *
   * 正常原创内容: 无需选择任何声明，此步骤跳过
   * AI 生成内容: 应声明"笔记含AI合成内容"（通过 post.declareAI = true 触发）
   */
  async step_declareOriginal(post) {
    // 正常原创内容不需要声明（小红书已移除原创声明功能）
    if (!post?.declareAI) {
      this.log.info('[内容类型声明] 原创内容，无需声明，跳过')
      return
    }

    this.log.info('[内容类型声明] AI 内容，声明"笔记含AI合成内容"')
    try {
      const selectEl = await this.findByText('*', SELECTORS.contentTypeSelectText || '添加内容类型声明')
      if (!selectEl) {
        this.log.warn('[内容类型声明] 未找到声明选择器，跳过')
        return
      }
      await selectEl.click()
      await randomDelay(1000, 2000)

      const aiOption = await this.findByText('*', SELECTORS.contentTypeAIText || '笔记含AI合成内容')
      if (aiOption) {
        await aiOption.click()
        await randomDelay(1000, 2000)
        this.log.info('[内容类型声明] 已声明AI合成内容')
      } else {
        this.log.warn('[内容类型声明] 未找到AI合成内容选项')
      }
    } catch (err) {
      this.log.warn(`[内容类型声明] 设置失败，跳过: ${err.message}`)
    }
  }

  /**
   * 定时发布
   * @param {string} scheduleTime - ISO 时间字符串
   */
  async step_setScheduleTime(scheduleTime) {
    this.log.info(`[定时发布] 设置发布时间: ${scheduleTime}`)
    try {
      // 定时发布在"更多设置"区域，通过文本查找 checkbox
      const toggle = await this.findByText('*', SELECTORS.scheduleCheckboxText || '定时发布')
      if (!toggle) {
        this.log.warn('[定时发布] 未找到定时发布开关，跳过')
        return
      }
      await toggle.click()
      await randomDelay(1000, 2000)

      const date = new Date(scheduleTime)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

      // 尝试填入日期和时间
      const dateInput = await this.page.$(SELECTORS.scheduleDateInput)
      if (dateInput) {
        await dateInput.click({ clickCount: 3 })
        await this.page.keyboard.type(dateStr)
        await randomDelay(500, 1000)
      }

      const timeInput = await this.page.$(SELECTORS.scheduleTimeInput)
      if (timeInput) {
        await timeInput.click({ clickCount: 3 })
        await this.page.keyboard.type(timeStr)
        await randomDelay(500, 1000)
      }

      this.log.info(`[定时发布] 已设置: ${dateStr} ${timeStr}`)
    } catch (err) {
      this.log.warn(`[定时发布] 设置失败: ${err.message}`)
    }
  }

  async step6_publish() {
    if (this._dryRun) {
      this.log.info('[步骤6] dryRun 模式，内容已填写，等待人工确认后手动点击发布')
      return
    }
    this.log.info('[步骤6] 最终检查并发布')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    const waitAfterMin   = cfg('steps.publish.wait_after_min', 5000)
    const waitAfterMax   = cfg('steps.publish.wait_after_max', 15000)

    // 上下滚动检查内容
    await this.scroll()
    await randomDelay(reviewDelayMin, reviewDelayMax)

    // 发布前截图
    await this.conditionalScreenshot('xhs_before_publish', 'before_publish')

    // 发布按钮无可靠 CSS class（2026-04 实测），直接用文本匹配
    const btn = await this.findByText('button', SELECTORS.publishButtonText || '发布')
    if (!btn) {
      throw new Error('未找到发布按钮，页面结构可能已变更')
    }
    await btn.click()

    this.log.info('已点击发布按钮')

    // 等待并验证发布结果
    const publishResult = await this.waitForPublishResult({
      successTexts: ['发布成功', '已发布', '笔记已发布'],
      errorTexts: ['发布失败', '请重试', '网络错误', '内容违规', '审核'],
      timeout: Math.max(waitAfterMax, 10000)
    })
    if (publishResult.status === 'error') {
      throw new Error(`发布失败: ${publishResult.evidence}`)
    }

    // 发布后截图
    await this.conditionalScreenshot('xhs_after_publish', 'after_publish')
  }

}
