import fs from 'node:fs'
import path from 'node:path'
import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 微信公众号文章发布适配器
 *
 * 后台首页: https://mp.weixin.qq.com/
 * 编辑器: "新的创作"→"文章" 打开新标签页
 *
 * 微信公众号特点:
 *   - ProseMirror 富文本编辑器
 *   - 标题 textarea#title + 正文 .ProseMirror
 *   - 作者 input#author + 摘要 textarea#js_description
 *   - 原创声明 checkbox + 封面图 file input
 *   - 发表/保存草稿/预览 按钮
 */

const S = PUBLISH_SELECTORS

export class WechatAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'wechat'
    this.homeUrl = 'https://mp.weixin.qq.com/'
    this.editorPage = null
  }

  getHomeUrl() { return this.homeUrl }
  getLoginUrl() { return 'https://mp.weixin.qq.com/' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  async publish(post) {
    this.log.info('========== 微信公众号发布开始 ==========')

    try {
      const normalizedPost = this.normalizePostForPublish(post)
      this.log.info(`标题: ${normalizedPost.title}`)
      this._dryRun = !!normalizedPost.dryRun
      if (this._dryRun) this.log.info('[dryRun] 填写内容后不点击发表按钮')

      await this.warmupBrowse()

      await this.runStep('openEditor', () => this.step1_openEditor())
      await this.runStep('inputTitle', () => this.step2_inputTitle(normalizedPost.title))
      if (normalizedPost.contentBlocks?.length) {
        await this.runStep('inputContent', () => this.step3_inputContentBlocks(normalizedPost.contentBlocks))
      } else {
        await this.runStep('inputContent', () => this.step3_inputContent(normalizedPost.content))
      }
      await this.runStep('inputAuthor', () => this.step4_inputAuthor(normalizedPost.author || ''))
      await this.runStep('inputDigest', () => this.step5_inputDigest(normalizedPost.summary || normalizedPost.content.substring(0, 80)))
      await this.runStep('setOriginal', () => this.step5b_setOriginal())

      if (normalizedPost.images && normalizedPost.images.length > 0) {
        await this.runStep('uploadCover', () => this.step6_uploadCover(normalizedPost.images[0]))
      }

      await this.verifyPageState(normalizedPost)

      await this.runStep('publish', () => this.step7_publish())

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 微信公众号发布完成 ==========')
      return this.buildResult(true, '微信公众号发布成功')
    } catch (err) {
      this.log.error(`微信公众号发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  // ─── normalizePostForPublish ─────────────────────────────────
  normalizePostForPublish(post) {
    const normalized = {
      ...post,
      coverType: post.coverType || ((post.images && post.images.length > 0) ? 'single' : undefined),
    }
    // 微信只支持单图封面
    if (normalized.coverType === 'triple') {
      this.log.warn('微信公众号不支持三图封面，降级为单图')
      normalized.coverType = 'single'
    }
    return normalized
  }

  async step1_openEditor() {
    this.log.info('[Step 1] 打开微信公众号编辑器')
    await this.navigateTo(this.homeUrl)
    await randomDelay(2000, 4000)

    // 登录检测
    const currentUrl = this.page.url()
    if (currentUrl.includes(S.loginPageIndicator) || currentUrl.includes('passport')) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录微信公众号')
    }

    // 方式1: 点击"新的创作"区域的"文章"卡片
    // Playwright 诊断确认: 卡片是 div.new-creation__menu-item，标题是 div.new-creation__menu-title
    let editorOpened = false

    const handle = await this.page.evaluateHandle(() => {
      // 精确匹配: 找 .new-creation__menu-title 文字为“文章”的卡片
      const titles = document.querySelectorAll('.new-creation__menu-title')
      for (const t of titles) {
        if (t.textContent.trim() === '文章') {
          return t.closest('.new-creation__menu-item') || t
        }
      }
      // 兜底: 找任何包含“文章”且是卡片类的元素
      const items = document.querySelectorAll('.new-creation__menu-item')
      for (const item of items) {
        if (item.textContent.trim().includes('文章')) {
          return item
        }
      }
      return null
    })
    const articleCard = handle.asElement()
    const clickedArticle = !!articleCard
    if (articleCard) await this.clickElement(articleCard)
    if (clickedArticle) {
      this.log.info('已点击"新的创作 → 文章"卡片')
      await randomDelay(3000, 5000)
    } else {
      this.log.warn('"文章"卡片未找到')
    }

    // 检测新标签页（兼容 CDP 连接模式）
    try {
      const browser = this.page.browser()
      const pages = await browser.pages()
      // 从后往前找包含 appmsg 的页面
      for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i].url().includes('appmsg')) {
          this.editorPage = pages[i]
          this.page = pages[i]
          await this.reinitCursor()
          editorOpened = true
          this.log.info(`编辑器已打开: ${pages[i].url().substring(0, 80)}`)
          break
        }
      }
    } catch (e) {
      this.log.warn(`获取浏览器标签页失败: ${e.message}`)
    }

    // 方式2: 如果按钮流程未成功，检查当前页面是否已有编辑器元素
    if (!editorOpened) {
      const hasEditor = await this.page.$(S.titleInput) || await this.page.$(S.contentInput)
      if (hasEditor) {
        editorOpened = true
        this.log.info('当前页面已包含编辑器元素')
      }
    }

    // 方式3: 直接导航到编辑器URL
    if (!editorOpened) {
      this.log.info('按钮流程未成功，尝试直接导航到编辑器...')
      const editorUrl = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77'
      await this.navigateTo(editorUrl)
      // 条件等待：编辑器元素就绪（替代盲等 randomDelay）
      const ready = await this.waitForEditorReady(
        [S.titleInput, S.titleInputAlt, 'textarea[placeholder*="标题"]'],
        [S.contentInput, S.contentInputAlt, '.ProseMirror'],
        20000
      )
      if (ready) editorOpened = true
    }

    if (!editorOpened) {
      this.log.warn('编辑器未打开，可能需要手动登录或操作')
    }

    await this.conditionalScreenshot('wechat_step1_editor', 'step')
  }

  async step2_inputTitle(title) {
    this.log.info('[Step 2] 输入标题')
    // Playwright 确认: 标题是 textarea#title (class="frm_input js_title")
    // 通过人类化层输入（ghost-cursor 点击 + IME 模拟）
    const titleSels = [S.titleInput, S.titleInputAlt, 'textarea[placeholder*="标题"]']
    const titleSelector = await this.findSelector(titleSels)
    await this.paste(titleSelector, title)
    const titleOk = await this.assertInputValue(
      [S.titleInput, S.titleInputAlt, 'textarea[placeholder*="标题"]'],
      title, '标题'
    )
    if (!titleOk) throw new Error('标题输入验证失败，内容可能未正确填入')
    this.log.info('标题输入完成')
    await randomDelay(500, 1500)
  }

  async step3_inputContent(content) {
    this.log.info('[Step 3] 输入正文（ProseMirror）')
    const contentSels = [S.contentInput, S.contentInputAlt, '.ProseMirror']
    const contentSelector = await this.findSelector(contentSels)

    // 点击编辑器获取焦点
    await this.page.click(contentSelector)
    await randomDelay(300, 600)

    // 使用 ClipboardEvent 粘贴（ProseMirror 对 CDP Input.insertText + IME 模拟兼容性差）
    await this.page.evaluate((sel, text) => {
      const el = document.querySelector(sel)
      if (!el) return
      el.focus()
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, contentSelector, content)
    await randomDelay(800, 1500)

    // 验证
    const contentOk = await this.assertRichTextContent(
      [S.contentInput, S.contentInputAlt, '.ProseMirror'],
      content, '正文'
    )
    if (!contentOk) {
      // fallback: CDP insertText
      this.log.warn('ClipboardEvent 粘贴失败，降级为 CDP insertText')
      await this.page.click(contentSelector)
      await this.page.keyboard.down('Control')
      await this.page.keyboard.press('a')
      await this.page.keyboard.up('Control')
      await this.page.keyboard.press('Backspace')
      await randomDelay(300, 500)
      const cdp = await this.page.target().createCDPSession()
      await cdp.send('Input.insertText', { text: content })
      await cdp.detach().catch(() => {})
      await randomDelay(500, 1000)
    }
    this.log.info('正文输入完成')
    await randomDelay(300, 800)
  }

  async step4_inputAuthor(author) {
    if (!author) return
    this.log.info('[Step 4] 输入作者')
    // Playwright 确认: 作者是 input#author (class="frm_input js_author")
    // 通过人类化层输入（ghost-cursor 点击 + IME 模拟）
    const authorSels = [S.authorInput, S.authorInputAlt, 'input[placeholder*="作者"]']
    let authorSelector
    try {
      authorSelector = await this.findSelector(authorSels)
    } catch {
      this.log.warn('未找到作者输入框，跳过')
      return
    }
    await this.paste(authorSelector, author)
    this.log.info('作者输入完成')
    await randomDelay(300, 800)
  }

  async step5_inputDigest(digest) {
    this.log.info('[Step 5] 输入摘要')
    // Playwright 确认: 摘要是 textarea#js_description (class="frm_textarea js_desc")
    // 通过人类化层输入（ghost-cursor 点击 + IME 模拟）
    const digestSels = [S.digestInput, S.digestInputAlt, 'textarea[placeholder*="选填"]']
    let digestSelector
    try {
      digestSelector = await this.findSelector(digestSels)
    } catch {
      this.log.warn('未找到摘要输入框，跳过')
      return
    }
    await this.paste(digestSelector, digest)
    this.log.info('摘要输入完成')
    await randomDelay(500, 1000)
  }

  async step5b_setOriginal() {
    this.log.info('[Step 5b] 设置原创声明')
    try {
      // Playwright 确认: 点击 .setting-group__switch.js_original_apply 弹出对话框
      // 对话框内: 声明类型(文字原创) + 作者 + 白名单 + 同意协议 + 确定
      const origSels = [S.originalSection, S.originalSectionAlt, '.js_original_apply']
      let clicked = false
      for (const sel of origSels) {
        try {
          await this.click(sel)
          clicked = true
          this.log.info(`原创声明区域已点击: ${sel}`)
          break
        } catch { /* next */ }
      }
      if (!clicked) { this.log.warn('未找到原创声明入口，跳过'); return }

      await randomDelay(1000, 2000)

      // 点击“我已阅读并同意”复选框（evaluateHandle + ghost-cursor 点击）
      const agreeHandle = await this.page.evaluateHandle(() => {
        const agreeTexts = document.querySelectorAll('span, label, div, a')
        for (const el of agreeTexts) {
          if (el.textContent?.includes('我已阅读并同意') && el.offsetParent) {
            return el
          }
        }
        return null
      })
      const agreeEl = agreeHandle.asElement()
      if (agreeEl) {
        await this.clickElement(agreeEl)
        this.log.info('“我已阅读并同意”已点击')
      }
      await randomDelay(500, 1000)

      // 点击“确定”按钮（evaluateHandle + ghost-cursor 点击）
      const confirmHandle = await this.page.evaluateHandle(() => {
        const btns = document.querySelectorAll('button, a')
        for (const btn of btns) {
          if (btn.textContent?.trim() === '确定' && btn.offsetParent) {
            return btn
          }
        }
        return null
      })
      const confirmEl = confirmHandle.asElement()
      const agreedAndConfirmed = !!confirmEl
      if (confirmEl) await this.clickElement(confirmEl)

      if (agreedAndConfirmed) this.log.info('原创声明已确认')
      else this.log.warn('原创声明确认失败，可能需要手动操作')
      await randomDelay(500, 1000)
    } catch (e) {
      this.log.warn(`原创声明设置失败: ${e.message}`)
    }
  }

  async step6_uploadCover(imagePath) {
    this.log.info('[Step 6] 上传封面图')
    try {
      const fileInput = await this.page.$(S.coverFileInput)
        || await this.page.$('input[type="file"]')
      if (!fileInput) { this.log.warn('未找到封面上传入口，跳过'); return }
      await fileInput.uploadFile(imagePath)
      await randomDelay(2000, 4000)
      this.log.info('封面图已上传')
    } catch (e) {
      this.log.warn(`封面上传失败: ${e.message}`)
    }
  }

  /**
   * Step 3 变体：输入富文本正文（contentBlocks 图文混排）
   */
  async step3_inputContentBlocks(contentBlocks) {
    this.log.info(`[Step 3] 输入正文 contentBlocks（${contentBlocks.length} 块）`)
    const contentSels = [S.contentInput, S.contentInputAlt, '.ProseMirror']
    const contentSelector = await this.findSelector(contentSels)
    await this.page.click(contentSelector)
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
  }

  // ─── verifyPageState ───────────────────────────────────────
  async verifyPageState(post) {
    this.log.info('[验证] 发布前回读页面状态')

    // 回读标题
    const titleText = await this.page.evaluate(() => {
      const textarea = document.querySelector('textarea#title') || document.querySelector('textarea.js_title')
      return textarea?.value?.trim() || ''
    }).catch(() => '')
    const titleOk = titleText.length > 0
    this.log.info(`  标题: ${titleOk ? '✅' : '❌'} (${titleText.slice(0, 30)})`)

    // 回读正文长度
    const contentLen = await this.page.evaluate(() => {
      const el = document.querySelector('.ProseMirror[contenteditable="true"]') || document.querySelector('#js_editor [contenteditable="true"]')
      return el?.innerText?.trim()?.length || 0
    }).catch(() => 0)
    this.log.info(`  正文字数: ${contentLen}`)

    // 回读作者
    const authorText = await this.page.evaluate(() => {
      const input = document.querySelector('input#author') || document.querySelector('input.js_author')
      return input?.value?.trim() || ''
    }).catch(() => '')
    this.log.info(`  作者: ${authorText || '(未填)'}`)

    // 发表按钮是否可见
    const publishBtnVisible = await this.page.evaluate(() => {
      const btn = document.querySelector('button.mass_send')
      return btn ? btn.offsetParent !== null : false
    }).catch(() => false)
    this.log.info(`  发表按钮: ${publishBtnVisible ? '✅ 可见' : '❌ 不可见'}`)

    this.addStepEvidence('verifyPageState', { titleOk, contentLen, authorText, publishBtnVisible })
  }

  async step7_publish() {
    if (this._dryRun) {
      this.log.info('[Step 7] dryRun 模式，内容已填写，等待人工确认后手动发表')
      return
    }
    this.log.info('[Step 7] 点击发表')
    // Playwright 确认: 发表按钮是 button.mass_send
    const pubSels = [S.publishButton, 'button.mass_send']
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
        const btns = document.querySelectorAll('button')
        for (const b of btns) {
          if (b.textContent?.trim() === '发表' && b.offsetParent) {
            return b
          }
        }
        return null
      })
      const element = handle.asElement()
      if (element) await this.clickElement(element)
      else throw new Error('未找到发表按钮')
    }
    this.log.info('发表按钮已点击')
    const publishResult = await this.waitForPublishResult({
      successTexts: ['发表成功', '已发表', '发布成功', '群发成功'],
      errorTexts: ['发表失败', '请重试', '网络错误', '发送失败'],
      timeout: 10000
    })
    if (publishResult.status === 'error') {
      throw new Error(`发表失败: ${publishResult.evidence}`)
    }
  }
}
