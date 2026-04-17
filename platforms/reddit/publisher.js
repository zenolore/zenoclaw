import { BasePlatformAdapter } from '../base.js'
import { randomDelay, sleep } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'
import path from 'path'

/**
 * Reddit 帖子发布适配器
 *
 * 发布页面: https://www.reddit.com/submit
 *
 * Reddit 特点:
 *   - 标题 + 正文（富文本或 Markdown）
 *   - 需要选择 subreddit
 *   - 支持图片/链接/投票等多种帖子类型
 *   - 建议人工复核
 */

const SELECTORS = PUBLISH_SELECTORS

export class RedditAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'reddit'
    this.publishUrl = 'https://www.reddit.com/submit'
    this._subreddit = null
  }

  // 平台元数据
  getHomeUrl() { return 'https://www.reddit.com/' }
  getLoginUrl() { return 'https://www.reddit.com/login' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  async publish(post) {
    this.log.info('========== Reddit 发帖开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

    try {
      await this.showStatus('正在预热浏览...').catch(() => {})
      await this.warmupBrowse()

      // 通过 URL 预选 subreddit（最可靠的方式，避免 shadow DOM 选择器问题）
      this._subreddit = post.subreddit || null
      await this.showStatus('正在打开发帖页面...').catch(() => {})
      await this.step1_openPage()

      // 如果 URL 方式没有预选成功，用 UI 选择器补救
      if (this._subreddit) {
        const currentSub = await this.page.evaluate(() => {
          const input = document.querySelector('input[name="subredditName"]')
          return input?.value || ''
        })
        if (!currentSub) {
          await this.showStatus('正在选择社区...').catch(() => {})
          await this.step2_selectSubreddit(this._subreddit)
        } else {
          this.log.info(`[步骤2] subreddit 已通过 URL 预选: r/${currentSub}`)
        }
      }

      await this.showStatus('正在输入标题...').catch(() => {})
      await this.step3_inputTitle(post.title)
      await this.showStatus('正在输入文案...').catch(() => {})
      await this.step4_inputContent(post.content)

      // 图片上传：部分 subreddit 禁止图片帖（tab 会 disabled），跳过即可
      if (post.images && post.images.length > 0) {
        try {
          await this.showStatus('正在上传图片...').catch(() => {})
          await this.step5_uploadImage(post.images[0])
        } catch (imgErr) {
          this.log.warn(`图片上传跳过（该社区可能不支持）: ${imgErr.message}`)
        }
      }

      await this.showStatus('正在发布帖子...').catch(() => {})
      await this.step6_submit()
      await this.showStatus('发布完成！').catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      await this.hideStatus().catch(() => {})
      this.log.info('========== Reddit 发帖成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`Reddit 发帖失败: ${err.message}`)
      await this.conditionalScreenshot('reddit_error', 'error')
      return this.buildResult(false, err)
    }
  }

  async step1_openPage() {
    // 如果有 subreddit，直接用 URL 预选
    const url = this._subreddit
      ? `https://www.reddit.com/r/${this._subreddit}/submit?type=TEXT`
      : this.publishUrl
    this.log.info(`[步骤1] 打开 Reddit 发帖页面: ${url}`)
    await this.navigateTo(url, {
      pageDescription: 'Reddit 发帖页面（submit page）',
      expectedElements: ['标题输入框', '正文编辑区']
    })

    const currentUrl = this.page.url()
    if (currentUrl.includes(SELECTORS.loginPageIndicator) || currentUrl.includes(SELECTORS.ageVerifyIndicator)) {
      throw new Error('未登录或需要年龄验证，请先在浏览器中登录 Reddit 并完成年龄确认')
    }

    // 视觉验证页面就绪
    await this.visionCheckPageReady('Reddit 发帖页面', {
      expectedElements: ['标题输入框', '正文编辑区', '社区选择或帖子类型选项'],
      targetDelayMs: 5000
    })

    await this.conditionalScreenshot('reddit_step1_open', 'step')
    await this.browseForStep('open_page')
  }

  async step2_selectSubreddit(subreddit) {
    this.log.info(`[步骤2] 选择 subreddit: ${subreddit}`)
    try {
      const input = await this.page.$(SELECTORS.subredditInput)
      if (input) {
        await this.click(SELECTORS.subredditInput)
        await randomDelay(500, 1000)
        await this.type(SELECTORS.subredditInput, subreddit)
        await randomDelay(2000, 3000)
        // 选择第一个建议
        await this.page.keyboard.press('ArrowDown')
        await this.page.keyboard.press('Enter')
        await randomDelay(1000, 2000)
      }
    } catch (err) {
      this.log.warn(`选择 subreddit 失败: ${err.message}`)
    }
  }

  async step3_inputTitle(title) {
    this.log.info('[步骤3] 输入标题（shadow DOM textarea）')

    const elementTimeout = cfg('browser.element_timeout', 30000)

    // 等待外层 web component 出现
    await this.page.waitForSelector(SELECTORS.titleComponent, { visible: true, timeout: elementTimeout })

    // 通过 shadow DOM 找内部 textarea 并点击
    const focused = await this.page.evaluate((compSel, inputSel) => {
      const comp = document.querySelector(compSel)
      if (!comp || !comp.shadowRoot) return false
      const textarea = comp.shadowRoot.querySelector(inputSel)
      if (!textarea) return false
      textarea.focus()
      textarea.click()
      return true
    }, SELECTORS.titleComponent, SELECTORS.titleInputInShadow)

    if (!focused) {
      // fallback：直接点击外层 component
      await this.page.click(SELECTORS.titleComponent)
    }

    await randomDelay(300, 800)

    // CDP insertText 输入标题
    const cdp = await this.page.target().createCDPSession()
    await cdp.send('Input.insertText', { text: title })
    await cdp.detach()

    await this.actionPause()
    await this.conditionalScreenshot('reddit_step3_title', 'step')

    // 视觉验证标题已输入
    await this.visionCheckContent({ title }, { targetDelayMs: 3000 })

    await this.browseForStep('input_title')
  }

  async step4_inputContent(content) {
    this.log.info('[步骤4] 输入正文（contenteditable rte 区域）')

    const elementTimeout = cfg('browser.element_timeout', 30000)

    // slot="rte" contenteditable div（正文编辑区，实测 visible=true）
    const bodySel = await this.findSelector([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
      SELECTORS.contentInputFallback,
    ])

    await this.page.waitForSelector(bodySel, { visible: true, timeout: elementTimeout })
    await this.page.click(bodySel)
    await randomDelay(500, 1000)

    // CDP insertText 输入正文
    const cdp = await this.page.target().createCDPSession()
    const paragraphs = content.split('\n')
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].length > 0) {
        await cdp.send('Input.insertText', { text: paragraphs[i] })
      }
      if (i < paragraphs.length - 1) {
        await randomDelay(200, 500)
        await this.page.keyboard.press('Enter')
        await randomDelay(500, 1500)
      }
    }
    await cdp.detach()

    await this.actionPause()
    await this.conditionalScreenshot('reddit_step4_content', 'step')

    // 视觉验证正文已输入
    await this.visionCheckContent({ content }, { targetDelayMs: 3000 })

    await this.browseForStep('input_content')
  }

  async step5_uploadImage(imagePath) {
    this.log.info('[步骤5] 上传图片')
    const absolutePath = path.resolve(imagePath)
    await this.uploadFile(SELECTORS.imageInput, [absolutePath])

    const pollInterval = cfg('upload.processing_poll_interval', 5000)
    await sleep(pollInterval)
    this.log.info('图片上传完成')
    await this.browseForStep('upload_images')
  }

  async step6_submit() {
    if (this._dryRun) {
      this.log.info('[步骤6] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[步骤6] 提交帖子')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    const waitAfterMin = cfg('steps.publish.wait_after_min', 5000)
    const waitAfterMax = cfg('steps.publish.wait_after_max', 15000)

    await randomDelay(reviewDelayMin, reviewDelayMax)
    await this.conditionalScreenshot('reddit_before_publish', 'before_publish')

    // 发布按钮在填写内容后才出现（懒加载），最多等 15s
    // Reddit 新版界面按钮在 shadow DOM 内，page.$$('button') 找不到
    let clicked = false
    const deadline = Date.now() + 15000
    const btnTexts = [SELECTORS.publishButtonText, SELECTORS.publishButtonTextAlt, ...(SELECTORS.publishButtonTextFallbacks || [])]
    while (!clicked && Date.now() < deadline) {
      // 1) light DOM 文本匹配（发帖 → Post → 发布 → Submit）
      for (const text of btnTexts) {
        const btn = await this.findByText('button', text)
        if (btn) {
          await btn.click()
          clicked = true
          this.log.info(`已点击发布按钮（light DOM 文本匹配: "${text}"）`)
          break
        }
      }
      if (clicked) break

      // 2) shadow DOM 深度搜索（Reddit 新版按钮在 shreddit-composer shadow root 内）
      for (const text of btnTexts) {
        const shadowClicked = await this.page.evaluate((targetText) => {
          function findBtnInShadow(root) {
            const buttons = root.querySelectorAll('button')
            for (const btn of buttons) {
              if (btn.textContent?.trim() === targetText && !btn.disabled) {
                btn.click()
                return true
              }
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot && findBtnInShadow(el.shadowRoot)) return true
            }
            return false
          }
          return findBtnInShadow(document)
        }, text)
        if (shadowClicked) {
          clicked = true
          this.log.info(`已点击发布按钮（shadow DOM 文本匹配: "${text}"）`)
          break
        }
      }
      if (clicked) break

      // 3) type=submit 降级（light DOM）
      const submitBtn = await this.page.$(SELECTORS.publishButtonType)
      if (submitBtn) {
        const text = await submitBtn.evaluate(el => el.textContent.trim())
        if (!text.includes('筛选') && !text.includes('filter') && !text.includes('应用')) {
          await submitBtn.click()
          clicked = true
          this.log.info(`已点击发布按钮（type=submit, text="${text}"）`)
          break
        }
      }
      await sleep(1000)
    }

    if (!clicked) {
      // 选择器都没找到 → 视觉定位发布按钮
      this.log.info('[步骤6] 选择器未命中，尝试视觉定位发布按钮')
      const visionClick = await this.visionLocateAndClick('发布帖子的按钮（Post 或 发布）')
      if (!visionClick.clicked) {
        throw new Error('未找到发布按钮，选择器和视觉定位均失败')
      }
      clicked = true
    }

    await randomDelay(waitAfterMin, waitAfterMax)
    await this.conditionalScreenshot('reddit_after_publish', 'after_publish')

    // 视觉判断发布结果 + 自动处理弹窗
    const publishResult = await this.visionCheckPublishResult({ platformName: 'Reddit' })
    this.log.info(`[视觉] 发布结果: ${publishResult.status} — ${publishResult.details}`)

    if (publishResult.status === 'need_confirm' || publishResult.status === 'need_close') {
      // 如果第一次没处理掉弹窗，再试一次
      if (!publishResult.popupHandled) {
        await this.visionHandlePopup(publishResult.status === 'need_confirm' ? 'confirm' : 'close')
      }
    }
  }

}
