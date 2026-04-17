import fs from 'node:fs'
import path from 'node:path'
import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'

/**
 * 知乎专栏文章发帖适配器
 *
 * 发帖页面: https://zhuanlan.zhihu.com/write
 *
 * ⚠️ 选择器基于 2026 年页面结构，改版后需更新 selectors.js
 *
 * 知乎特点:
 *   - 专栏文章模式（长文），非动态/想法
 *   - 标题 + 正文（富文本编辑器）
 *   - 封面图单张
 *   - 话题标签（搜索选择）
 *   - 投稿到专栏（可选）
 */

const SELECTORS = PUBLISH_SELECTORS

export class ZhihuAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'zhihu'
    this.publishUrl = 'https://zhuanlan.zhihu.com/write'
  }

  // 平台元数据
  getHomeUrl() { return 'https://www.zhihu.com/' }
  getLoginUrl() { return 'https://www.zhihu.com/signin' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  /**
   * 执行完整的发帖流程
   */
  async publish(post) {
    this.log.info('========== 知乎发帖开始 ==========')

    try {
      const normalizedPost = this.normalizePostForPublish(post)
      this.log.info(`标题: ${normalizedPost.title}`)
      this._dryRun = !!normalizedPost.dryRun
      if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

      // 发帖前预热浏览：先浏览首页 feed，建立自然行为链
      await this.showStatus('正在预热浏览...').catch(() => {})
      await this.warmupBrowse()

      await this.showStatus('正在打开写文章页面...').catch(() => {})
      await this.step1_openPublishPage()

      // 知乎是先填标题/正文，再上传封面图
      await this.showStatus('正在输入标题...').catch(() => {})
      await this.step2_inputTitle(normalizedPost.title)

      // 正文末尾追加 #hashtags（与旧 Playwright 逻辑对齐 L982-987）
      let bodyContent = normalizedPost.content
      if (normalizedPost.tags?.length) {
        const hashTags = normalizedPost.tags.map(t => `#${t.replace(/^#/, '')}`).join(' ')
        bodyContent = `${normalizedPost.content}\n\n${hashTags}`
      }
      await this.showStatus('正在输入正文...').catch(() => {})
      if (normalizedPost.contentBlocks?.length) {
        await this.step3_inputContentBlocks(normalizedPost.contentBlocks)
      } else {
        await this.step3_inputContent(bodyContent)
      }

      if (normalizedPost.images && normalizedPost.images.length > 0) {
        await this.showStatus('正在上传封面图...').catch(() => {})
        await this.step4_uploadCover(normalizedPost.images[0])
      }

      await this.showStatus('正在选择投稿问题...').catch(() => {})
      await this.step4b_selectQuestion(normalizedPost.tags || [])

      if (normalizedPost.tags && normalizedPost.tags.length > 0) {
        await this.showStatus('正在添加话题标签...').catch(() => {})
        await this.step5_addTags(normalizedPost.tags)
      }

      await this.verifyPageState(normalizedPost)

      // AI 视觉验证：发布前截图确认内容正确
      const verification = await this.verifyBeforePublish({
        title: normalizedPost.title,
        content: normalizedPost.content?.slice(0, 100),
        imageCount: normalizedPost.images?.length || 0
      })
      if (!verification.pass && verification.confidence > 0.8) {
        if (this._dryRun) {
          throw new Error(`[视觉验证] 内容验证未通过（置信度 ${verification.confidence}）: ${verification.details}`)
        }
        this.log.warn(`[视觉验证] 内容验证未通过，但继续发布: ${verification.details}`)
      }

      await this.showStatus('正在发布文章...').catch(() => {})
      await this.step6_publish()
      await this.showStatus('发布完成！').catch(() => {})

      // 补足时间到目标总时长
      await this.fillRemainingTime()

      // 返回首页后继续浏览（dry-run 模式留在发布页供人工检查）
      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      await this.hideStatus().catch(() => {})
      this.log.info('========== 知乎发帖成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`知乎发帖失败: ${err.message}`)
      await this.conditionalScreenshot('zhihu_error', 'error')
      return this.buildResult(false, err)
    }
  }

  // ============================================================
  // 各步骤实现
  // ============================================================

  async step1_openPublishPage() {
    this.log.info('[步骤1] 从首页点击「写文章」进入发帖')

    // 确保在首页（warmupBrowse 可能已导航过，也可能禁用了）
    const currentUrl = this.page.url()
    if (!currentUrl.includes('zhihu.com')) {
      await this.navigateTo(this.getHomeUrl())
    }

    // 登录检测
    const afterUrl = this.page.url()
    if (afterUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录知乎')
    }

    // 找到并点击「写文章」按钮
    const writeBtn = await this.findByText('a', '写文章')
      || await this.findByText('button', '写文章')
    if (!writeBtn) {
      // fallback：直接导航到写文章页
      this.log.warn('[步骤1] 未找到「写文章」按钮，fallback 直接导航')
      await this.navigateTo(this.publishUrl)
    } else {
      await this.clickElement(writeBtn)
      this.log.info('[步骤1] 已点击「写文章」，等待编辑页加载')
      await sleep(3000)
    }

    // 等待标题输入框出现，确认编辑页已加载
    try {
      await this.page.waitForSelector(SELECTORS.titleInput, { timeout: 10000 })
      this.log.info('[步骤1] 写文章页面已加载')
    } catch {
      // 再试 alt 选择器
      try {
        await this.page.waitForSelector(SELECTORS.titleInputAlt, { timeout: 5000 })
        this.log.info('[步骤1] 写文章页面已加载（alt selector）')
      } catch {
        throw new Error('写文章页面未加载，标题输入框未出现')
      }
    }

    await this.conditionalScreenshot('zhihu_step1_open', 'step')
  }

  async step2_inputTitle(title) {
    this.log.info('[步骤2] 输入标题')

    const selector = await this.findSelector([
      SELECTORS.titleInput,
      SELECTORS.titleInputAlt,
    ])

    await this.paste(selector, title)
    await this.actionPause()
    await this.conditionalScreenshot('zhihu_step2_title', 'step')
    await this.browseForStep('input_title')
  }

  async step3_inputContent(content) {
    this.log.info('[步骤3] 输入正文')

    const selector = await this.findSelector([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
      SELECTORS.contentInputFallback,
    ])

    // CDP insertText：对 Draft.js / contenteditable 富文本编辑器可靠
    await this.paste(selector, content)
    await this.actionPause()
    await this.conditionalScreenshot('zhihu_step3_content', 'step')
    await this.browseForStep('input_content')
  }

  /**
   * Step 3 变体：输入富文本正文（文字 + 图片交替 contentBlocks）
   */
  async step3_inputContentBlocks(contentBlocks) {
    this.log.info(`[步骤3] 输入正文 contentBlocks（${contentBlocks.length} 块）`)

    const selector = await this.findSelector([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
      SELECTORS.contentInputFallback,
    ])
    await this.page.click(selector)
    await randomDelay(300, 600)

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]
      if (block.type === 'text' && block.value) {
        await this.page.evaluate((text) => {
          const dt = new DataTransfer()
          dt.setData('text/plain', text)
          document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
        }, block.value)
        await randomDelay(300, 500)
        await this.page.keyboard.press('Enter')
        await randomDelay(200, 400)
        this.log.info(`  文字块 ${i + 1}: ${block.value.slice(0, 30)}...`)
      } else if (block.type === 'image' && block.src) {
        if (!fs.existsSync(block.src)) {
          this.log.warn(`  图片不存在，跳过: ${block.src}`)
          continue
        }
        const buf = fs.readFileSync(block.src)
        const base64 = buf.toString('base64')
        const ext = path.extname(block.src).toLowerCase()
        const mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png'
        const fileName = path.basename(block.src)

        await this.page.evaluate(async (b64, mime, name) => {
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const blob = new Blob([bytes], { type: mime })
          const file = new File([blob], name, { type: mime })
          const dt = new DataTransfer()
          dt.items.add(file)
          document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
        }, base64, mimeType, fileName)

        this.log.info(`  图片块 ${i + 1}: ${fileName} 上传中...`)
        await randomDelay(4000, 6000)
        await this.page.keyboard.press('ArrowDown')
        await this.page.keyboard.press('End')
        await this.page.keyboard.press('Enter')
        await randomDelay(300, 500)
      }
    }
    this.log.info('contentBlocks 正文输入完成')
    await this.conditionalScreenshot('zhihu_step3_contentblocks', 'step')
  }

  async step4_uploadCover(imagePath) {
    this.log.info('[步骤4] 上传封面图')

    const absolutePath = path.resolve(imagePath)

    // 滚动到页面底部，确保「发布设置」区域可见
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await sleep(800)

    // 等价 Playwright: page.locator("text=添加文章封面").first()
    // 找最内层（textContent 最短）包含目标文本的元素
    const coverBtn = await this.page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll('div, span, a, button'))
      const matches = all.filter(d => d.textContent?.includes('添加文章封面'))
      matches.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0))
      return matches[0] || null
    })
    const coverEl = coverBtn.asElement()
    if (!coverEl) {
      this.log.warn('  未找到「添加文章封面」按钮，跳过')
      return
    }

    // 1:1 翻译旧 Playwright 逻辑:
    //   const [fileChooser] = await Promise.all([
    //     page.waitForEvent("filechooser", { timeout: 5000 }),
    //     coverBtn.click()
    //   ]);
    //   await fileChooser.setFiles(coverPath);
    this.log.info('  点击「添加文章封面」+ waitForFileChooser...')
    try {
      const [fileChooser] = await Promise.all([
        this.page.waitForFileChooser({ timeout: 5000 }),
        coverEl.click(),
      ])
      await fileChooser.accept([absolutePath])
      this.log.info('  封面文件已传入')
      await sleep(2000)
    } catch (err) {
      this.log.warn(`  waitForFileChooser 失败: ${err.message}`)
    }

    this.log.info('封面图上传完成')
    await this.conditionalScreenshot('zhihu_step4_cover', 'step')
    await this.browseForStep('upload_images')
  }

  /**
   * 投稿至问题（自动选择第一个推荐问题）
   * 翻译自 Playwright zhihuSelectQuestion (playwrightRunner.ts L708-756)
   */
  async step4b_selectQuestion(tags = []) {
    this.log.info('[步骤4b] 投稿至问题')

    try {
      // 滚动到发布设置区域
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await sleep(800)

      // 找"投稿至问题"区域的下拉按钮（button 标签，精确匹配"未选择"）
      const ddHandle = await this.page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'))
        return buttons.find(b => b.textContent.trim() === '未选择') || null
      })
      const dropdownBtn = ddHandle.asElement()
      if (!dropdownBtn) {
        this.log.info('  未找到「未选择」按钮（可能已选过问题），跳过')
        return
      }

      this.log.info('  点击「未选择」下拉框...')
      await dropdownBtn.click()
      await sleep(2000)

      // 用第一个 tag 作为关键词搜索相关问题
      const keyword = tags[0] || ''
      if (keyword) {
        const searchInput = await this.page.$('input[placeholder*="关键"]')
          || await this.page.$('input[placeholder*="问题"]')
        if (searchInput) {
          this.log.info(`  搜索关键词: ${keyword}`)
          await this.page.evaluate(el => { el.focus(); el.value = '' }, searchInput)
          await sleep(200)
          const cdp = await this.page.target().createCDPSession()
          await cdp.send('Input.insertText', { text: keyword })
          await cdp.detach().catch(() => {})
          // 点击搜索按钮或按 Enter
          await this.page.keyboard.press('Enter')
          await sleep(2000)
        }
      }

      // 找精确文本为"选择"的按钮（排除"未选择"等）
      const selectBtnHandle = await this.page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'))
        return buttons.find(b => b.textContent.trim() === '选择') || null
      })
      const selectBtn = selectBtnHandle.asElement()

      if (selectBtn) {
        await selectBtn.click()
        this.log.info('  已点击「选择」按钮')
        await sleep(800)

        // 点击"确定"
        const confirmHandle = await this.page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button'))
          return buttons.find(b => b.textContent.trim() === '确定') || null
        })
        const confirmBtn = confirmHandle.asElement()
        if (confirmBtn) {
          await confirmBtn.click()
          this.log.info('  已确认投稿问题')
          await sleep(500)
        }
      } else {
        // 无搜索结果，关闭对话框
        await this.page.keyboard.press('Escape').catch(() => {})
        this.log.info('  无匹配问题可选')
      }
    } catch (err) {
      this.log.warn(`  投稿至问题失败: ${err.message}`)
    }
  }

  async step5_addTags(tags) {
    this.log.info(`[步骤5] 添加 ${tags.length} 个话题标签`)

    const searchDelayMin = cfg('steps.add_tags.search_delay_min', 800)
    const searchDelayMax = cfg('steps.add_tags.search_delay_max', 1200)
    const selectDelayMin = cfg('steps.add_tags.select_delay_min', 1000)
    const selectDelayMax = cfg('steps.add_tags.select_delay_max', 2000)

    // 滚动到页面底部，发布设置区域可见
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await randomDelay(500, 1000)

    for (const tag of tags.slice(0, 5)) {
      try {
        // 第一步：点「添加话题」按钮（搜索框才会出现）
        const addBtn = await this.findByText('button', SELECTORS.addTopicButtonText)
        if (!addBtn) {
          this.log.warn('未找到「添加话题」按钮，跳过标签添加')
          break
        }
        await addBtn.click()
        await randomDelay(searchDelayMin, searchDelayMax)

        // 第二步：等待搜索框出现（轮询，最多 8s）
        let tagInput = null
        for (let i = 0; i < 16; i++) {
          tagInput = await this.page.$(SELECTORS.tagInput)
          if (tagInput) break
          await sleep(500)
        }
        if (!tagInput) throw new Error(`话题搜索框未出现 (${SELECTORS.tagInput})`)

        // 第三步：输入话题关键词
        this.log.info(`  输入话题: ${tag}`)
        await this.page.evaluate(el => { el.scrollIntoView(); el.focus() }, tagInput)
        await sleep(300)
        const cdp = await this.page.target().createCDPSession()
        await cdp.send('Input.insertText', { text: tag })
        await cdp.detach().catch(() => {})
        await randomDelay(selectDelayMin, selectDelayMax)

        // 第四步：点击建议列表中的第一个匹配 button（知乎建议项是 180x40 的 button）
        const suggHandle = await this.page.evaluateHandle((tagText) => {
          const buttons = Array.from(document.querySelectorAll('button'))
          // 优先精确匹配
          const exact = buttons.find(b => {
            const r = b.getBoundingClientRect()
            return b.textContent.trim() === tagText && r.height > 20 && r.height < 60
              && window.getComputedStyle(b).cursor === 'pointer'
          })
          if (exact) return exact
          // fallback: 建议列表中第一个（180x40 左右的 button）
          return buttons.find(b => {
            const r = b.getBoundingClientRect()
            return r.width > 100 && r.height > 20 && r.height < 60
              && b.textContent.trim().length < 20
              && b.textContent.trim().length > 0
              && window.getComputedStyle(b).cursor === 'pointer'
              && b.textContent.trim() !== '添加话题'
              && !b.textContent.includes('发布')
              && !b.textContent.includes('预览')
          }) || null
        }, tag)
        const suggBtn = suggHandle.asElement()

        if (suggBtn) {
          const suggText = await this.page.evaluate(el => el.textContent.trim(), suggBtn)
          await suggBtn.click()
          this.log.info(`  话题「${suggText}」已点击选中`)
        } else {
          // 最终 fallback: 按 Enter
          await this.page.keyboard.press('Enter')
          this.log.info(`  话题「${tag}」Enter fallback`)
        }
        await sleep(800)

        // 第五步：Escape 关闭残留下拉
        await this.page.keyboard.press('Escape').catch(() => {})
        await sleep(300)

        // 再滚动到底部
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await sleep(300)

      } catch (err) {
        this.log.warn(`  添加标签 "${tag}" 失败: ${err.message}`)
        // 点击空白关闭可能残留的弹窗
        await this.page.mouse.click(100, 400).catch(() => {})
        await sleep(300)
      }
    }

    await this.conditionalScreenshot('zhihu_step5_tags', 'step')
    await this.browseForStep('add_tags')
  }

  async step6_publish() {
    if (this._dryRun) {
      this.log.info('[步骤6] dryRun 模式，内容已填写，等待人工确认后手动点击发布')
      return
    }
    this.log.info('[步骤6] 最终检查并发布')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)

    // 上下滚动检查内容
    await this.scroll()
    await randomDelay(reviewDelayMin, reviewDelayMax)

    // 查找发布按钮（CSS + 文本匹配 fallback）
    let publishEl = await this.page.$(SELECTORS.publishButton)
    if (!publishEl) {
      publishEl = await this.findByText('button', '发布')
    }
    if (!publishEl) {
      throw new Error('未找到发布按钮，页面结构可能已变更')
    }

    // 滚动到按钮可视区域，用 clickElement 带鼠标轨迹点击
    await publishEl.evaluate(node => node.scrollIntoView({ block: 'center' }))
    await randomDelay(300, 600)
    await this.clickElement(publishEl)
    this.log.info('已点击发布按钮，等待发布结果...')

    // 等待 URL 变化 — 知乎发布成功后跳转到 /p/xxxxx
    let published = await this._waitForUrlChange(15000)

    // 首次失败 → fallback: 用 page.click 重试
    if (!published) {
      this.log.warn('[步骤6] 首次点击未生效，用 page.click 重试')
      try {
        const retryEl = await this.page.$(SELECTORS.publishButton)
          || await this.findByText('button', '发布')
        if (retryEl) await retryEl.click()
      } catch { /* ignore */ }
      published = await this._waitForUrlChange(10000)
    }

    if (!published) {
      await this.conditionalScreenshot('zhihu_publish_failed', 'error')
      throw new Error('发布失败：点击发布按钮后页面未跳转，文章可能未发出')
    }

    this.log.info(`[步骤6] 发布成功：页面已跳转到 ${this.page.url()}`)
    await this.conditionalScreenshot('zhihu_after_publish', 'after_publish')

    // 关闭「发布成功」分享弹窗
    await this._closeSuccessDialog()
  }

  /**
   * 关闭发布成功后的分享弹窗
   */
  async _closeSuccessDialog() {
    try {
      await sleep(1500)
      // 弹窗右上角 X 关闭按钮
      const closeBtn = await this.page.evaluateHandle(() => {
        // 弹窗内的关闭按钮（SVG close icon 或 × 文本）
        const btns = Array.from(document.querySelectorAll('button, [role="button"], .Modal-closeButton, .css-1dbjc4n'))
        const closeBtn = btns.find(b => {
          const svg = b.querySelector('svg')
          const text = b.textContent?.trim()
          const ariaLabel = b.getAttribute('aria-label')
          return ariaLabel === '关闭' || text === '×' || text === 'X'
            || (svg && b.getBoundingClientRect().width < 50)
        })
        if (closeBtn) return closeBtn
        // fallback: modal overlay 外层点击
        const modal = document.querySelector('.Modal-backdrop, .Overlay, [class*="modal"]')
        return modal || null
      })
      const el = closeBtn.asElement()
      if (el) {
        await el.click()
        this.log.info('[步骤6] 已关闭发布成功弹窗')
        await sleep(800)
      } else {
        // fallback: Escape 关闭
        await this.page.keyboard.press('Escape')
        this.log.info('[步骤6] Escape 关闭弹窗')
        await sleep(800)
      }
    } catch (e) {
      this.log.debug(`关闭发布成功弹窗失败: ${e.message}`)
      await this.page.keyboard.press('Escape').catch(() => {})
    }
  }

  /**
   * 等待 URL 从 /write 变化（知乎发布成功后跳转到文章页）
   * @param {number} timeoutMs - 最大等待时间
   * @returns {Promise<boolean>} URL 是否已变化
   */
  async _waitForUrlChange(timeoutMs) {
    const pollInterval = 1000
    const maxAttempts = Math.ceil(timeoutMs / pollInterval)

    for (let i = 0; i < maxAttempts; i++) {
      await sleep(pollInterval)
      const url = this.page.url()
      if (!url.includes('/write')) return true
    }
    return false
  }

  // ─── normalizePostForPublish ─────────────────────────────────────
  normalizePostForPublish(post) {
    const normalized = {
      ...post,
      coverType: post.coverType || ((post.images && post.images.length > 0) ? 'single' : undefined),
    }
    // 知乎只支持单图封面
    if (normalized.coverType === 'triple') {
      this.log.warn('知乎不支持三图封面，降级为单图')
      normalized.coverType = 'single'
    }
    if (normalized.coverType === 'single' && (!normalized.images || normalized.images.length < 1)) {
      throw new Error('知乎单图封面至少需要 1 张图片')
    }
    return normalized
  }

  // ─── verifyPageState ─────────────────────────────────────────────
  async verifyPageState(post) {
    this.log.info('[验证] 发布前回读页面状态')

    // 回读标题
    const titleText = await this.page.evaluate(() => {
      const textarea = document.querySelector('label.WriteIndex-titleInput textarea')
      return textarea?.value?.trim() || ''
    }).catch(() => '')
    const titleOk = titleText.length > 0
    this.log.info(`  标题: ${titleOk ? '✅' : '❌'} (${titleText.slice(0, 30)})`)

    // 回读正文长度
    const contentLen = await this.page.evaluate(() => {
      const el = document.querySelector('.Editable-content.RichText') || document.querySelector('div[contenteditable="true"]')
      return el?.innerText?.trim()?.length || 0
    }).catch(() => 0)
    this.log.info(`  正文字数: ${contentLen}`)

    // 回读发布按钮是否可见
    const publishBtnVisible = await this.page.evaluate(() => {
      const btn = document.querySelector('button.Button--primary')
      return btn ? btn.offsetParent !== null : false
    }).catch(() => false)
    this.log.info(`  发布按钮: ${publishBtnVisible ? '✅ 可见' : '❌ 不可见'}`)

    this.addStepEvidence('verifyPageState', { titleOk, contentLen, publishBtnVisible })
  }

}
