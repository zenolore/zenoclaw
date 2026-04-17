import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 搜狐号文章发布适配器
 *
 * 内容管理页: https://mp.sohu.com/mpfe/v4/contentManagement/first/page
 * 文章编辑页: 通过"发布内容"→"文章"导航到达
 *
 * 搜狐号特点:
 *   - Quill 富文本编辑器（.ql-editor contenteditable）
 *   - 标题 input + 正文 Quill + 摘要 textarea
 *   - 原创声明 toggle + 封面自动/手动
 */

const S = PUBLISH_SELECTORS

export class SohuAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'sohu'
    this.contentManagementUrl = 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page'
    this.editorUrl = 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1'
  }

  getHomeUrl() { return this.contentManagementUrl }
  getLoginUrl() { return 'https://mp.sohu.com/' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  async publish(post) {
    this.log.info('========== 搜狐号发布开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 填写内容后不点击发布按钮')

    try {
      await this.warmupBrowse()

      await this.runStep('navigateToEditor', () => this.step1_navigateToEditor())
      await this.runStep('inputTitle', () => this.step2_inputTitle(post.title))
      await this.runStep('inputContent', () => this.step3_inputContent(post.content))
      await this.runStep('inputSummary', () => this.step4_inputSummary(post.summary || post.content.substring(0, 60)))
      await this.runStep('setOriginal', () => this.step5_setOriginal())
      await this.runStep('setInfoSource', () => this.step5b_setInfoSource(post.infoSource || 'ai'))
      await this.runStep('setTopic', () => this.step5c_setTopic(post.tags))

      if (post.images && post.images.length > 0) {
        await this.runStep('uploadCover', () => this.step6_uploadCover(post.images[0]))
      }

      await this.runStep('publish', () => this.step7_publish())

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 搜狐号发布完成 ==========')
      return this.buildResult(true, '搜狐号发布成功')
    } catch (err) {
      this.log.error(`搜狐号发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  async step1_navigateToEditor() {
    this.log.info('[Step 1] 导航到搜狐号文章编辑器')

    // Playwright 诊断确认: 已有标签页有完整 DOM(686 元素)，新标签页 Vue 不渲染
    // 策略: 优先复用已有搜狐号标签页
    let foundExisting = false
    try {
      const browser = this.page.browser()
      const pages = await browser.pages()
      this.log.info(`[Step 1] 共 ${pages.length} 个标签页`)
      for (const p of pages) {
        const url = p.url()
        if (url.includes('mp.sohu.com')) {
          this.log.info(`[Step 1] 找到搜狐号标签页: ${url.substring(0, 80)}`)
          this.page = p
          await this.reinitCursor()
          await p.bringToFront()
          foundExisting = true
          break
        }
      }
    } catch (e) {
      this.log.warn(`查找已有标签页失败: ${e.message}`)
    }

    // 导航到编辑器页面
    // 使用 page.evaluate + window.location.href 进行页内跳转
    // 避免 page.goto 的 evaluateOnNewDocument 重新注入脚本干扰 Vue SPA
    const needNav = foundExisting
      ? !(this.page.url().includes('addarticle') || this.page.url().includes('addnews'))
      : true

    if (!needNav) {
      this.log.info('[Step 1] 已在编辑器页面，直接使用')
    } else {
      this.log.info('[Step 1] 通过页内跳转导航到编辑器')
      await this.page.evaluate((url) => { window.location.href = url }, this.editorUrl)
      // 等待页面跳转完成
      try {
        await this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 })
      } catch {
        this.log.warn('waitForNavigation 超时，继续等待...')
      }
      // 条件等待：编辑器元素就绪（替代盲等 randomDelay）
      await this.waitForEditorReady(
        [S.titleInput, S.titleInputAlt, 'input[placeholder*="标题"]'],
        [S.contentInput, S.contentInputAlt, '.ql-editor'],
        20000
      )
    }

    // 登录检测
    const currentUrl = this.page.url()
    if (currentUrl.includes(S.loginPageIndicator) || currentUrl.includes('passport')) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录搜狐号')
    }

    this.log.info(`[Step 1] 当前URL: ${currentUrl.substring(0, 80)}`)
    await this.conditionalScreenshot('sohu_step1_editor', 'step')
  }

  async step2_inputTitle(title) {
    this.log.info('[Step 2] 输入标题')

    // 等待 Vue SPA 渲染完成（最多 15 秒）
    const titleSels = [S.titleInput, S.titleInputAlt, 'input[placeholder*="标题"]']
    let ready = false
    for (const sel of titleSels) {
      try {
        await this.page.waitForSelector(sel, { timeout: 15000 })
        ready = true
        this.log.info(`标题输入框就绪: ${sel}`)
        break
      } catch { /* next */ }
    }
    if (!ready) {
      // DOM 诊断
      const diag = await this.page.evaluate(() => {
        const inputs = document.querySelectorAll('input, textarea')
        return Array.from(inputs).slice(0, 10).map(el => ({
          tag: el.tagName, placeholder: el.placeholder || '', className: (el.className || '').substring(0, 50)
        }))
      })
      this.log.error(`DOM 中 input/textarea: ${JSON.stringify(diag)}`)
      throw new Error('未找到标题输入框（Vue 可能未渲染）')
    }

    // 通过人类化层输入（ghost-cursor 点击 + IME 模拟）
    const selector = await this.findSelector(titleSels)
    await this.paste(selector, title)
    const titleOk = await this.assertInputValue(
      [S.titleInput, S.titleInputAlt, 'input[placeholder*="标题"]'],
      title, '标题'
    )
    if (!titleOk) throw new Error('标题输入验证失败，内容可能未正确填入')
    this.log.info('标题输入完成')
    await randomDelay(500, 1500)
  }

  async step3_inputContent(content) {
    this.log.info('[Step 3] 输入正文')

    // ⚠️ Quill 编辑器（contenteditable），通过人类化层输入（ghost-cursor + IME 模拟）
    const contentSels = [S.contentInput, S.contentInputAlt, '.ql-editor']
    let contentSelector
    try {
      contentSelector = await this.findSelector(contentSels)
    } catch {
      this.log.warn('未找到正文编辑器，跳过')
      return
    }
    await this.paste(contentSelector, content)
    const contentOk = await this.assertRichTextContent(
      [S.contentInput, S.contentInputAlt, '.ql-editor'],
      content, '正文'
    )
    if (!contentOk) throw new Error('正文输入验证失败，内容可能未正确填入')
    this.log.info('正文输入完成')
    await randomDelay(500, 1500)
  }

  async step4_inputSummary(summary) {
    this.log.info('[Step 4] 输入摘要')
    const summarySels = [S.summaryInput, S.summaryInputAlt, 'textarea[placeholder*="摘要"]']
    let summarySelector
    try {
      summarySelector = await this.findSelector(summarySels)
    } catch {
      this.log.warn('未找到摘要输入框，跳过')
      return
    }
    await this.paste(summarySelector, summary)
    const summaryOk = await this.assertInputValue(
      [S.summaryInput, S.summaryInputAlt, 'textarea[placeholder*="摘要"]'],
      summary, '摘要'
    )
    if (!summaryOk) throw new Error('摘要输入验证失败，内容可能未正确填入')
    this.log.info('摘要输入完成')
    await randomDelay(500, 1000)
  }

  async step5_setOriginal() {
    this.log.info('[Step 5] 设置原创声明')
    try {
      // Playwright 确认: 原创是 .original-state .toggle-Original (toggle 开关)
      const toggleSels = [S.originalToggle, S.originalSection, '.toggle-Original']
      let clicked = false
      for (const sel of toggleSels) {
        try {
          await this.click(sel)
          clicked = true
          this.log.info(`原创声明已点击: ${sel}`)
          break
        } catch { /* next */ }
      }
      if (!clicked) {
        // fallback: 通过文本查找，evaluateHandle 获取元素后走 ghost-cursor 点击
        const handle = await this.page.evaluateHandle(() => {
          const els = document.querySelectorAll('.original-state, .toggle-Original, p, span')
          for (const el of els) {
            if (el.textContent?.trim()?.startsWith('原创') && el.offsetParent) {
              return el
            }
          }
          return null
        })
        const element = handle.asElement()
        if (element) {
          await this.clickElement(element)
          this.log.info('原创声明已通过文本点击')
        } else {
          this.log.warn('未找到原创声明选项，跳过')
        }
      }
      await randomDelay(500, 1000)
    } catch (e) {
      this.log.warn(`原创声明设置失败: ${e.message}`)
    }
  }

  async step5b_setInfoSource(source = 'ai') {
    this.log.info(`[Step 5b] 设置信息来源: ${source}`)
    try {
      // Playwright 确认: 信息来源是 radio 组 (el-radio)
      // source: 'none'=无特别声明, 'quote'=引用, 'ai'=AI创作, 'fiction'=虚构
      const textMap = {
        none: S.infoSourceNoneText,
        quote: S.infoSourceQuoteText,
        ai: S.infoSourceAIText,
        fiction: S.infoSourceFictionText,
      }
      const targetText = textMap[source] || S.infoSourceAIText

      const handle = await this.page.evaluateHandle((text) => {
        const labels = document.querySelectorAll('.el-radio, .el-radio__label, label')
        for (const el of labels) {
          if (el.textContent?.trim() === text && el.offsetParent) {
            return el
          }
        }
        return null
      }, targetText)
      const element = handle.asElement()
      const clicked = !!element
      if (element) await this.clickElement(element)

      if (clicked) this.log.info(`信息来源已选择: ${targetText}`)
      else this.log.warn(`未找到信息来源选项: ${targetText}，跳过`)
      await randomDelay(500, 1000)
    } catch (e) {
      this.log.warn(`信息来源设置失败: ${e.message}`)
    }
  }

  async step5c_setTopic(tags) {
    if (!tags || tags.length === 0) return
    this.log.info(`[Step 5c] 设置话题: ${tags[0]}`)
    try {
      // Playwright 确认: 话题是 .select-topic 下的 el-select 组件
      // 先点击 el-select__input 激活下拉，再输入关键词
      // 通过人类化层输入话题关键词（ghost-cursor + IME 模拟）
      const topicSels = [S.topicSelectInput, S.topicSearchInput, S.topicSearchInputAlt]
      let topicSelector
      try {
        topicSelector = await this.findSelector(topicSels)
      } catch {
        this.log.warn('未找到话题输入框，跳过')
        return
      }
      await this.paste(topicSelector, tags[0])
      await randomDelay(1000, 2000)

      // 选择第一个下拉选项（evaluateHandle + ghost-cursor 点击）
      const handle = await this.page.evaluateHandle(() => {
        const items = document.querySelectorAll('.el-select-dropdown__item, .el-scrollbar li')
        for (const item of items) {
          if (item.offsetParent && item.textContent?.trim()) {
            return item
          }
        }
        return null
      })
      const dropItem = handle.asElement()
      if (dropItem) {
        const selected = await this.page.evaluate(el => el.textContent.trim(), dropItem)
        await this.clickElement(dropItem)
        this.log.info(`话题已选择: ${selected}`)
      } else {
        this.log.warn('话题下拉无可选项')
      }
      await randomDelay(500, 1000)
    } catch (e) {
      this.log.warn(`话题设置失败: ${e.message}`)
    }
  }

  async step6_uploadCover(imagePath) {
    this.log.info('[Step 6] 上传封面图')
    try {
      const coverBtn = await this.findByText('div', S.coverUploadText)
      if (coverBtn) {
        await this.clickElement(coverBtn)
        await randomDelay(1000, 2000)
      }
      const fileInput = await this.findElement([S.coverFileInput, 'input[type="file"]'])
      if (fileInput) {
        await this.uploadFile(fileInput, imagePath)
        await randomDelay(2000, 4000)
      } else {
        this.log.warn('未找到封面文件上传入口，跳过')
      }
    } catch (e) {
      this.log.warn(`封面上传失败: ${e.message}`)
    }
  }

  async step7_publish() {
    if (this._dryRun) {
      this.log.info('[Step 7] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[Step 7] 点击发布')
    // Playwright 确认: 发布按钮是 li.publish-report-btn.active.positive-button
    const pubSels = [S.publishButton, 'li.positive-button']
    let clicked = false
    for (const sel of pubSels) {
      try {
        await this.click(sel)
        clicked = true
        break
      } catch { /* next */ }
    }
    if (!clicked) {
      // fallback: 文本查找，evaluateHandle + ghost-cursor 点击
      const handle = await this.page.evaluateHandle(() => {
        const items = document.querySelectorAll('li, button')
        for (const el of items) {
          if (el.textContent?.trim() === '发布' && el.offsetParent) {
            return el
          }
        }
        return null
      })
      const element = handle.asElement()
      if (element) await this.clickElement(element)
      else throw new Error('未找到发布按钮')
    }
    this.log.info('发布按钮已点击')
    const publishResult = await this.waitForPublishResult({
      successTexts: ['发布成功', '已发布', '提交成功', '审核中'],
      errorTexts: ['发布失败', '请重试', '网络错误'],
      successUrlPattern: 'contentManagement',
      timeout: 10000
    })
    if (publishResult.status === 'error') {
      throw new Error(`发布失败: ${publishResult.evidence}`)
    }
  }
}
