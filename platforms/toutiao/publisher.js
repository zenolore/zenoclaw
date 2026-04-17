import fs from 'node:fs'
import path from 'node:path'
import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 今日头条文章发布适配器（2026-04-14 全量实测重写）
 *
 * 文章发布页: https://mp.toutiao.com/profile_v4/graphic/publish
 *
 * 页面组件库: byte-* + syl-* ProseMirror 富文本编辑器
 *
 * 发布流程:
 *   Step 1  打开发布页
 *   Step 2  输入标题（textarea）
 *   Step 3  粘贴/输入正文（ProseMirror div[contenteditable]）
 *   Step 4  上传封面图（点击 .article-cover-add → 等待 file input 出现）
 *   Step 5  设置广告（默认选"不投放广告"）
 *   Step 6  设置作品声明（可选）
 *   Step 7  点击"预览并发布"（button.publish-btn-last）
 */

const S = PUBLISH_SELECTORS

export class ToutiaoAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'toutiao'
    this.publishUrl = 'https://mp.toutiao.com/profile_v4/graphic/publish'
  }

  getHomeUrl() { return 'https://www.toutiao.com/' }
  getLoginUrl() { return 'https://www.toutiao.com/auth/login/' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  async publish(post) {
    this.log.info('========== 头条发布开始 ==========')

    try {
      const normalizedPost = this.normalizePostForPublish(post)
      this.log.info(`标题: ${normalizedPost.title}`)
      this._dryRun = !!normalizedPost.dryRun
      if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')
      await this.showStatus('预热浏览...').catch(() => {})
      await this.warmupBrowse()

      await this.showStatus('打开发布页面...').catch(() => {})
      await this.step1_openPublishPage()

      await this.showStatus('输入标题...').catch(() => {})
      await this.step2_inputTitle(normalizedPost.title)

      // 2026-04-17: 头条会自动把正文首图作为单图封面，这会污染三图模式
      // 所以先上传封面（step4），再插入正文（step3）
      if (normalizedPost.coverType || (normalizedPost.images && normalizedPost.images.length > 0)) {
        await this.showStatus('上传封面图...').catch(() => {})
        await this.step4_configCover(normalizedPost)
      }

      await this.showStatus('输入正文...').catch(() => {})
      if (normalizedPost.contentBlocks?.length) {
        await this.step3_inputContentBlocks(normalizedPost.contentBlocks)
      } else {
        await this.step3_inputContent(normalizedPost.content)
      }

      await this.showStatus('配置发布选项...').catch(() => {})
      await this.step5_configOptions(normalizedPost)

      // 发布前全选项验证：回读页面实际状态
      await this.verifyPageState(normalizedPost)

      await this.showStatus('发布文章...').catch(() => {})
      await this.step6_publish(normalizedPost)

      await this.showStatus('发布完成！').catch(() => {})
      await this.hideStatus().catch(() => {})

      // 2026-04-15 安全加固：仅在“未出现显式失败”时才继续走发布后浏览。
      // 原因：头条原逻辑点击后只等待 2-5 秒，若页面出现违规/失败提示，旧逻辑仍会继续伪装成功链路。
      // 当前策略：step6_publish 内已经接入 conservativeVerifyPublishResult()；若命中显式失败会直接抛错进入 catch。
      // 回退方式：删除 step6_publish() 里的 conservativeVerifyPublishResult() 调用，即可恢复旧行为。
      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 头条发布完成 ==========')
      return this.buildResult(true, '头条发布成功')
    } catch (err) {
      this.log.error(`头条发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  // ─── Step 1: 打开发布页 ───────────────────────────────────────────────
  async step1_openPublishPage() {
    this.log.info('[Step 1] 打开头条文章发布页')
    await this.navigateTo(this.publishUrl)
    await randomDelay(cfg('timing.action_delay_min', 1500), cfg('timing.action_delay_max', 3000))
  }

  // ─── Step 2: 输入标题 ────────────────────────────────────────────────
  async step2_inputTitle(title) {
    this.log.info('[Step 2] 输入标题')
    const el = await this.findElement([S.titleInput])
    if (!el) throw new Error('未找到标题输入框 (textarea[placeholder*="请输入文章标题"])')
    await el.click()
    await randomDelay(200, 500)
    await this.humanTypeInElement(el, title)
    await randomDelay(500, 1200)
  }

  // ─── Step 3: 输入正文（ProseMirror 富文本，用剪贴板粘贴保留格式）─────
  //
  // ══════════════════════════════════════════════════════════════════════
  // 【正文插图方案】2026-04-16 MCP 实测确认
  //
  // 头条编辑器 (ProseMirror) 支持两种高效内容插入方式：
  //
  // 1. 纯文字段落 — ClipboardEvent + text/plain 或 text/html
  //    page.evaluate((text) => {
  //      const dt = new DataTransfer()
  //      dt.setData('text/plain', text)
  //      document.activeElement.dispatchEvent(
  //        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
  //      )
  //    }, textContent)
  //
  // 2. 正文内嵌图片 — ClipboardEvent + File 对象（编辑器自动上传至头条 CDN）
  //    page.evaluate(async (base64, mimeType, fileName) => {
  //      const bin = atob(base64)
  //      const bytes = new Uint8Array(bin.length)
  //      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  //      const blob = new Blob([bytes], { type: mimeType })
  //      const file = new File([blob], fileName, { type: mimeType })
  //      const dt = new DataTransfer()
  //      dt.items.add(file)
  //      document.activeElement.dispatchEvent(
  //        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
  //      )
  //    }, base64Data, 'image/png', 'photo.png')
  //    // 粘贴后等待 3~5s 让编辑器完成 CDN 上传
  //    // 上传成功后 img 节点会自动获得 web_uri 属性
  //
  // 完整插入流程（段落和图片交替）:
  //   for (const block of contentBlocks) {
  //     if (block.type === 'text')  → 粘贴文字
  //     if (block.type === 'image') → 粘贴图片文件 → 等待上传 → ArrowDown+Enter 定位光标
  //   }
  //
  // 【文章数据格式要求】
  // 若需要正文插图，post 对象应提供 contentBlocks 数组（替代纯文本 content）：
  //
  //   post.contentBlocks = [
  //     { type: 'text',  value: '第一段文字内容...' },
  //     { type: 'image', src: '/absolute/path/to/image1.png', caption: '图片说明（可选，最多50字）' },
  //     { type: 'text',  value: '第二段文字内容...' },
  //     { type: 'image', src: '/absolute/path/to/image2.jpg', caption: '' },
  //     { type: 'text',  value: '第三段文字内容...' },
  //   ]
  //
  // 规则：
  //   - type='text'  的 value 支持多行（\n），编辑器会自动分段
  //   - type='image' 的 src 必须是本地绝对路径（Puppeteer 读文件转 base64）
  //   - 支持 jpg/jpeg/png 格式，单张最大 20MB
  //   - caption 可选，最多 50 字（头条平台限制）
  //   - 如果只有纯文本 content（无 contentBlocks），走现有的纯文字粘贴逻辑
  //   - 建议文字段落不要太短（<50字），否则审核可能判定为低质内容
  //
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Step 3 变体：输入富文本正文（文字 + 图片交替）
   * @param {Array<{type:'text'|'image', value?:string, src?:string, caption?:string}>} contentBlocks
   */
  async step3_inputContentBlocks(contentBlocks) {
    this.log.info(`[Step 3] 输入富文本正文 (${contentBlocks.length} 块, ${contentBlocks.filter(b => b.type === 'image').length} 张图片)`)
    const el = await this.findElement([S.contentInput, S.contentInputAlt])
    if (!el) throw new Error('未找到正文编辑器 (.ProseMirror[contenteditable="true"])')

    await el.click()
    await randomDelay(300, 700)

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]

      if (block.type === 'text' && block.value) {
        // 粘贴文字段落
        await this.page.evaluate((text) => {
          const dt = new DataTransfer()
          dt.setData('text/plain', text)
          document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
        }, block.value)
        await randomDelay(300, 600)
        this.log.info(`  文字块 ${i + 1}: ${block.value.slice(0, 30)}...`)

      } else if (block.type === 'image' && block.src) {
        // 读取本地文件，通过 ClipboardEvent 粘贴 File 对象
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

        // 等待编辑器上传图片到 CDN
        this.log.info(`  图片块 ${i + 1}: ${fileName} 上传中...`)
        await randomDelay(4000, 6000)

        // 验证上传是否成功
        const uploaded = await this.page.evaluate(() => {
          const imgs = document.querySelectorAll('div.ProseMirror img')
          const last = imgs[imgs.length - 1]
          return last?.getAttribute('web_uri') || ''
        })
        if (uploaded) {
          this.log.info(`  ✅ 上传成功: ${uploaded.slice(0, 40)}`)
        } else {
          this.log.warn(`  ⚠️ 图片可能仍在上传中`)
        }

        // 光标移到图片下方，准备接下一个块
        await this.page.keyboard.press('ArrowDown')
        await this.page.keyboard.press('End')
        await this.page.keyboard.press('Enter')
        await randomDelay(200, 400)
      }
    }

    await randomDelay(800, 1500)
    this.log.info('[Step 3] 富文本正文输入完成')
  }

  async step3_inputContent(content) {
    this.log.info('[Step 3] 输入正文')
    const el = await this.findElement([S.contentInput, S.contentInputAlt])
    if (!el) throw new Error('未找到正文编辑器 (.ProseMirror[contenteditable="true"])')

    await el.click()
    await randomDelay(300, 700)

    // 使用剪贴板粘贴，保留换行和格式（比逐字输入快且自然）
    await this.page.evaluate((text) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    }, content)

    // 如果粘贴失败（编辑器内容仍为空），降级为逐字输入
    await randomDelay(500, 1000)
    const editorText = await this.page.evaluate(() => {
      const el = document.querySelector('.ProseMirror')
      return el ? el.innerText.trim() : ''
    })
    if (!editorText || editorText === '请输入正文') {
      this.log.warn('[Step 3] 剪贴板粘贴失败，降级为逐字输入')
      await el.click()
      await this.page.keyboard.down('Control')
      await this.page.keyboard.press('a')
      await this.page.keyboard.up('Control')
      await this.humanTypeInElement(el, content)
    }

    await randomDelay(800, 1500)
  }

  normalizePostForPublish(post) {
    const normalized = {
      ...post,
      coverType: post.coverType || ((post.images && post.images.length > 0) ? 'single' : undefined),
      declarations: Array.isArray(post.declarations)
        ? [...new Set(post.declarations.map(item => (item || '').trim()).filter(Boolean))]
        : undefined,
    }

    if (normalized.tags && normalized.tags.length > 0) {
      throw new Error('头条图文标签由平台自动匹配，当前发布契约不支持手动标签字段')
    }

    if (normalized.coverType === 'single' && (!normalized.images || normalized.images.length < 1)) {
      throw new Error('头条单图封面至少需要 1 张图片')
    }

    if (normalized.coverType === 'triple' && (!normalized.images || normalized.images.length < 3)) {
      throw new Error('头条三图封面至少需要 3 张图片')
    }

    if (normalized.scheduleTime) {
      const scheduleDate = new Date(normalized.scheduleTime)
      if (Number.isNaN(scheduleDate.getTime())) {
        throw new Error(`头条定时发布时间无效: ${normalized.scheduleTime}`)
      }
    }

    return normalized
  }

  async step4_configCover(post) {
    const coverType = post.coverType || ((post.images && post.images.length > 0) ? 'single' : undefined)
    if (!coverType) return

    await this.setCoverMode(coverType)

    if (coverType === 'none') {
      return
    }

    const requiredCount = coverType === 'triple' ? 3 : 1
    const imagePaths = (post.images || []).slice(0, requiredCount)

    if (requiredCount === 1) {
      await this.step4_uploadCover(imagePaths[0])
      return
    }

    await this.uploadCoverImages(imagePaths)

    const selectedFileCount = await this.page.$$eval(S.coverFileInput, nodes => {
      return nodes.reduce((sum, node) => {
        return sum + (node instanceof HTMLInputElement && node.files ? node.files.length : 0)
      }, 0)
    }).catch(() => 0)
    if (selectedFileCount > 0 && selectedFileCount < requiredCount) {
      throw new Error(`封面上传未完成: ${selectedFileCount}/${requiredCount}`)
    }
  }

  async setCoverMode(coverType) {
    const selector = {
      single: S.coverModeSingle,
      triple: S.coverModeTriple,
      none: S.coverModeNone,
    }[coverType]

    if (!selector) throw new Error(`不支持的封面模式: ${coverType}`)

    const radio = await this.findElement([selector])
    if (!radio) throw new Error(`未找到封面模式控件: ${coverType}`)

    const currentChecked = await this.isCheckboxChecked(selector)
    if (!currentChecked) {
      // 2026-04-17: 头条 byte-design radio 仅点击 input 不触发视觉+DOM 更新，
      // 必须点击外层 label.byte-radio 才能触发 re-render（三图模式下 .article-cover-images 需要重新渲染）
      const labelText = coverType === 'triple' ? '三图' : (coverType === 'single' ? '单图' : '无封面')
      await this.page.evaluate((text) => {
        const labels = document.querySelectorAll('.article-cover-radio-group label.byte-radio')
        for (const l of labels) {
          if (l.textContent?.trim() === text) { l.click(); return true }
        }
        return false
      }, labelText)
      // 等待视觉+DOM 更新
      await randomDelay(800, 1500)
    }

    const finalChecked = await this.isCheckboxChecked(selector)
    if (!finalChecked) throw new Error(`封面模式未生效: ${coverType}`)
  }

  async uploadCoverImages(imagePaths) {
    // 2026-04-17 三图模式实测流程：
    //   1. 头条会自动把正文首图作为单图封面 → 需要先删除自动封面
    //   2. 切换到 triple 后，点击 .article-cover-add → 弹窗出现
    //   3. 弹窗内 input[type="file"][multiple] 可一次上传 3 张
    //   4. 不需要逐张点击 add

    // Step A: 清理自动封面（头条会自动把正文首图作为单图封面）
    await this._clearAutoCovers()
    // Step B: blur 编辑器焦点，避免编辑器 handler 抢占后续点击事件
    await this.page.evaluate(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur()
      }
    }).catch(() => {})
    await randomDelay(300, 500)

    // Step C: 初始化 file input（通过 evaluate 在页面上下文中点击，避免 stale handle）
    const initialInputs = await this.page.$$(S.coverFileInput)
    let fileInput = initialInputs[0]

    if (!fileInput) {
      // 2026-04-17: 重新查询 + 页面上下文 click（避免 stale handle 和 overlay 拦截）
      const clickResult = await this.page.evaluate((addSel) => {
        const btn = document.querySelector(addSel)
        if (!btn) return { clicked: false, reason: 'not-found' }
        btn.scrollIntoView({ block: 'center' })
        btn.click()
        return { clicked: true, rect: btn.getBoundingClientRect() }
      }, S.coverAddBtn)
      if (!clickResult.clicked) {
        throw new Error(`未找到封面上传入口 (${S.coverAddBtn}): ${clickResult.reason}`)
      }
      this.log.info(`[Step 4] 封面入口已点击 (通过 evaluate)`)
      await randomDelay(1000, 1800)
      await this.page.waitForFunction((sel) => {
        return document.querySelectorAll(sel).length > 0
      }, { timeout: 8000 }, S.coverFileInput).catch(() => null)
      let after = await this.page.$$(S.coverFileInput)
      if (!after.length) {
        // 诊断：检查 upload-handler 是否存在
        const diag = await this.page.evaluate(() => ({
          allFileInputs: document.querySelectorAll('input[type="file"]').length,
          allFileInputDetails: Array.from(document.querySelectorAll('input[type="file"]')).map(i => ({
            accept: i.accept, multiple: i.multiple,
            parentClass: i.parentElement?.className?.slice(0, 80),
          })),
          hasUploadHandler: !!document.querySelector('.upload-handler, .upload-handler-drag'),
          hasDialog: !!document.querySelector('.byte-modal, [role="dialog"], .byte-popover-content'),
        }))
        this.log.warn(`[诊断] 点击 add 后: ${JSON.stringify(diag)}`)
        // fallback: 尝试用通用 input[type="file"] selector
        const anyFileInput = await this.page.$('input[type="file"][accept*="image"]')
        if (anyFileInput) {
          this.log.info('[Step 4] fallback 使用通用 input[type="file"][accept*="image"]')
          fileInput = anyFileInput
        }
      } else {
        fileInput = after[0]
      }
      if (!fileInput) throw new Error('点击封面入口后仍未出现 file input')
    }

    const multiple = await fileInput.evaluate(node => node instanceof HTMLInputElement ? !!node.multiple : false).catch(() => false)
    if (multiple) {
      // 一次上传所有图片
      this.log.info(`[Step 4] 三图 multiple input 一次上传 ${imagePaths.length} 张`)
      await this.uploadFile(fileInput, imagePaths)
      // 关闭弹窗（如有"确定"按钮点击）
      await randomDelay(1500, 2500)
      await this.page.keyboard.press('Escape').catch(() => {})
      return
    }

    // 不 multiple：逐张点击 add 上传
    for (let index = 0; index < imagePaths.length; index++) {
      const currentInputs = await this.page.$$(S.coverFileInput)
      const emptyInput = await this.findFirstEmptyFileInput(currentInputs)
      if (emptyInput) {
        await this.uploadFile(emptyInput, imagePaths[index])
        continue
      }
      const addButtons = await this.page.$$(S.coverAddBtn)
      const button = addButtons[Math.min(index, addButtons.length - 1)]
      if (!button) throw new Error(`未找到第 ${index + 1} 个封面上传入口`)
      await this.uploadCoverImageFromButton(button, imagePaths[index])
    }
  }

  /**
   * 清理头条自动从正文抓取的封面（正文有图时头条会自动使用首图作为单图封面）
   * 方法：在 .article-cover-images 下查找所有 .article-cover-delete 并逐个点击
   */
  async _clearAutoCovers() {
    try {
      const removed = await this.page.evaluate(() => {
        // 方案 A: 遍历所有删除按钮
        let count = 0
        const deleteBtns = document.querySelectorAll('.article-cover-images .article-cover-delete, .article-cover-img-wrap .article-cover-delete')
        for (const btn of deleteBtns) {
          btn.click()
          count++
        }
        return count
      })
      if (removed > 0) {
        this.log.info(`[Step 4] 清理了 ${removed} 张自动封面`)
        await randomDelay(500, 1000)
        // 可能有"确认删除"弹窗，点击确定
        await this.page.evaluate(() => {
          const btns = document.querySelectorAll('button')
          for (const b of btns) {
            const t = b.textContent?.trim()
            if ((t === '确定' || t === '确认' || t === '删除') && b.offsetParent !== null) {
              b.click()
              return true
            }
          }
          return false
        }).catch(() => {})
        await randomDelay(500, 800)
      }
    } catch (err) {
      this.log.warn(`[Step 4] 清理自动封面失败: ${err.message}`)
    }
  }

  async findFirstEmptyFileInput(inputs) {
    for (const input of inputs) {
      const fileCount = await input.evaluate(node => node instanceof HTMLInputElement && node.files ? node.files.length : 0)
      if (!fileCount) return input
    }
    return null
  }

  async uploadCoverImageFromButton(button, imagePath) {
    const beforeCount = await this.page.$$eval(S.coverFileInput, nodes => nodes.length).catch(() => 0)
    await button.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {})
    try {
      await button.click()
    } catch {
      await this.clickElement(button)
    }
    await randomDelay(500, 900)

    await this.page.waitForFunction((sel, count) => {
      return document.querySelectorAll(sel).length > count || document.querySelectorAll(sel).length > 0
    }, { timeout: 3000 }, S.coverFileInput, beforeCount).catch(() => null)

    const fileInputs = await this.page.$$(S.coverFileInput)
    const emptyInput = await this.findFirstEmptyFileInput(fileInputs)
    const targetInput = emptyInput || fileInputs[fileInputs.length - 1] || await this.page.$('input[type="file"]')
    if (!targetInput) throw new Error('未找到封面 file input')

    await this.uploadFile(targetInput, imagePath)
  }

  // ─── Step 4: 上传封面图 ──────────────────────────────────────────────
  // 头条封面 file input 是动态注入的：
  //   1. 先确保"单图"模式已选中
  //   2. 点击 .article-cover-add 触发文件选择对话框
  //   3. 等待 input[type=file] 出现后上传
  async step4_uploadCover(imagePath) {
    this.log.info('[Step 4] 上传封面图:', imagePath)

    const directInput = await this.page.$(S.coverFileInput)
    if (directInput) {
      await this.uploadFile(directInput, imagePath)
      await randomDelay(2000, 4000)
      this.log.info('[Step 4] 封面上传完成')
      return
    }

    // 确保选中"单图"模式（value=2）
    try {
      await this.page.evaluate((sel) => {
        const radio = document.querySelector(sel)
        if (radio && !radio.checked) radio.click()
      }, S.coverModeSingle)
      await randomDelay(300, 600)
    } catch { /* 忽略，继续尝试上传 */ }

    // 点击上传触发区
    const addBtn = await this.findElement([S.coverAddBtn])
    if (!addBtn) {
      this.log.warn('[Step 4] 未找到封面上传触发区 (.article-cover-add)，跳过')
      return
    }

    // 监听 file input 的动态注入（点击前注册 MutationObserver）
    const fileInputPromise = this.page.waitForSelector(S.coverFileInput, { timeout: 8000 }).catch(() => null)
    await addBtn.click()
    await randomDelay(500, 1000)

    const fileInput = await fileInputPromise
    if (!fileInput) {
      // 降级：直接找页面上任意 input[type=file]
      const anyFileInput = await this.page.$('input[type="file"]')
      if (!anyFileInput) {
        this.log.warn('[Step 4] 未找到 file input，跳过封面上传')
        return
      }
      await this.uploadFile(anyFileInput, imagePath)
    } else {
      await this.uploadFile(fileInput, imagePath)
    }

    await randomDelay(2000, 4000)
    this.log.info('[Step 4] 封面上传完成')
  }

  async readNormalizedText(selector) {
    return this.page.evaluate((sel) => {
      const node = document.querySelector(sel)
      return node ? (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim() : ''
    }, selector)
  }

  async isCheckboxChecked(selector) {
    return this.page.evaluate((sel) => {
      const input = document.querySelector(sel)
      return input instanceof HTMLInputElement ? !!input.checked : false
    }, selector)
  }

  async getCheckedLabels(selector) {
    // MCP 实测: byte-checkbox-checked class 是唯一可靠的 checked 判定
    return this.page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel))
        .filter(node => node.classList.contains('byte-checkbox-checked'))
        .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    }, selector)
  }

  async getVisibleTexts(selector) {
    return this.page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel))
        .map(node => (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    }, selector)
  }

  async hasVisibleElement(selector) {
    return this.page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel)).some(node => {
        const style = window.getComputedStyle(node)
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && (node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0)
      })
    }, selector)
  }

  async findElementByText(selector, text) {
    const elements = await this.page.$$(selector)
    for (const element of elements) {
      const content = await element.evaluate(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
      if (content.includes(text)) return element
    }
    return null
  }

  async findElementByTexts(selector, texts) {
    for (const text of texts) {
      const element = await this.findElementByText(selector, text)
      if (element) return element
    }
    return null
  }

  async readInputValue(selector) {
    return this.page.evaluate((sel) => {
      const node = document.querySelector(sel)
      return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? (node.value || '').trim()
        : ''
    }, selector)
  }

  async setInputValue(selector, value, label) {
    const input = await this.page.$(selector)
    if (!input) throw new Error(`未找到${label}输入框`)

    await input.evaluate((node, nextValue) => {
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return
      const prototype = node instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      if (descriptor?.set) {
        descriptor.set.call(node, nextValue)
      } else {
        node.value = nextValue
      }
      node.dispatchEvent(new Event('input', { bubbles: true }))
      node.dispatchEvent(new Event('change', { bubbles: true }))
      node.dispatchEvent(new Event('blur', { bubbles: true }))
    }, value)
    await randomDelay(400, 700)

    const finalValue = await this.readInputValue(selector)
    if (!finalValue || !finalValue.includes(value)) {
      throw new Error(`${label}输入未生效，当前值: ${finalValue || '空'}`)
    }
  }

  async setCheckboxState(clickSelector, inputSelector, desiredChecked, label, useMouseEvents = false) {
    const target = await this.findElement([clickSelector])
    if (!target) throw new Error(`未找到${label}控件`)

    const current = await this.isCheckboxChecked(inputSelector)
    if (current !== desiredChecked) {
      await this.page.evaluate((sel, mouseEvents) => {
        const node = document.querySelector(sel)
        if (!node) return
        if (mouseEvents) {
          for (const type of ['mousedown', 'mouseup', 'click']) {
            node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
          }
          return
        }
        node.click()
      }, clickSelector, useMouseEvents)
      await randomDelay(300, 600)
    }

    const finalChecked = await this.isCheckboxChecked(inputSelector)
    if (finalChecked !== desiredChecked) {
      throw new Error(`${label}未生效，当前状态: ${finalChecked}`)
    }
  }

  async isToggleLikeChecked(element) {
    return element.evaluate(node => {
      const input = node.querySelector('input[type="checkbox"], input[type="radio"]')
      const ariaChecked = node.getAttribute('aria-checked')
      const className = typeof node.className === 'string' ? node.className : ''
      return !!(input && input.checked)
        || ariaChecked === 'true'
        || /checked|selected|active/.test(className)
    })
  }

  async setDeclarationStateByText(text, shouldCheck) {
    // MCP 实测: label.byte-checkbox.checkbot-item，checked = byte-checkbox-checked class
    // 使用 page.evaluate 内部 click（Puppeteer element.click() 不触发 byte-ui React 状态）
    const result = await this.page.evaluate((selector, targetText, nextChecked) => {
      const normalize = (v) => (v || '').replace(/\s+/g, ' ').trim()
      const labels = Array.from(document.querySelectorAll(selector))
      const target = labels.find(n => normalize(n.textContent).includes(targetText))
      if (!target) return { found: false }
      const checked = target.classList.contains('byte-checkbox-checked')
      if (checked !== nextChecked) {
        target.scrollIntoView({ block: 'center', inline: 'center' })
        target.click()
        return { found: true, changed: true }
      }
      return { found: true, changed: false }
    }, S.declarationCheckbox, text, shouldCheck)

    if (!result.found) throw new Error(`未找到作品声明: ${text}`)
    if (result.changed) await randomDelay(500, 800)
  }

  async setDeclarationStates(declarations = []) {
    // MCP 实测: 头条作品声明是**单选**（React 组件强制只允许 1 项）
    // HTML 标签虽然是 checkbox，但点第二个会自动取消第一个
    const desired = declarations.map(item => (item || '').trim()).filter(Boolean)
    if (desired.length === 0) return

    const itemCount = await this.page.$$eval(S.declarationCheckbox, nodes => nodes.length).catch(() => 0)
    if (itemCount === 0) {
      throw new Error('未找到作品声明控件')
    }

    const available = await this.page.$$eval(S.declarationCheckbox, nodes => {
      return nodes
        .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    }).catch(() => [])

    // 单选：只取最后一个值
    const target = desired[desired.length - 1]
    if (desired.length > 1) {
      this.log.info(`[作品声明] 头条只支持单选，取最后一项: ${target}`)
    }

    if (!available.some(text => text.includes(target))) {
      throw new Error(`未找到作品声明: ${target}`)
    }

    await this.setDeclarationStateByText(target, true)

    // 校验
    const checkedDeclarations = await this.getCheckedLabels(S.declarationCheckbox)
    if (!checkedDeclarations.some(text => text.includes(target))) {
      throw new Error(`作品声明勾选失败，当前: ${checkedDeclarations.join(' | ') || '无'}`)
    }
  }

  // ─── Step 5: 配置发布选项 ────────────────────────────────────────────
  async step5_configOptions(post) {
    const failures = []
    try {
      if (post.location) {
        this.log.info(`[Step 5] 设置位置: ${post.location}`)
        const select = await this.findElement([S.locationSelect])
        if (!select) throw new Error('未找到位置选择器')
        await this.page.evaluate((sel) => document.querySelector(sel)?.click(), S.locationSelect)
        await randomDelay(300, 600)
        const inputExists = await this.page.$(S.locationInput)
        if (!inputExists) throw new Error('未找到位置输入框')
        await this.page.focus(S.locationInput)
        await randomDelay(200, 400)
        await this.page.keyboard.down('Control')
        await this.page.keyboard.press('a')
        await this.page.keyboard.up('Control')
        await this.page.keyboard.press('Backspace').catch(() => {})
        await this.page.keyboard.type(post.location, { delay: 120 })
        await randomDelay(800, 1200)
        await this.page.keyboard.press('ArrowDown').catch(() => {})
        await randomDelay(200, 300)
        await this.page.keyboard.press('Enter').catch(() => {})
        await randomDelay(500, 900)
        const locationValue = await this.readNormalizedText(S.locationValue) || await this.readNormalizedText(S.locationCell)
        if (!locationValue.includes(post.location)) {
          throw new Error(`当前页面显示: ${locationValue || '空'}`)
        }
      }
    } catch (e) { failures.push(`[Step 5] 位置未对上: ${e.message}`) }

    // 广告设置：默认不投放广告（除非 post.enableAd = true）
    try {
      if (typeof post.enableAd === 'boolean') {
        this.log.info(`[Step 5] ${post.enableAd ? '开启' : '关闭'}投放广告`)
        const targetSelector = post.enableAd ? S.adRadioOn : S.adRadioOff
        const radio = await this.findElement([targetSelector])
        if (!radio) throw new Error('未找到广告单选项')
        const current = await this.isCheckboxChecked(targetSelector)
        if (!current) {
          await this.page.evaluate((sel) => {
            const input = document.querySelector(sel)
            if (input instanceof HTMLInputElement && !input.checked) input.click()
          }, targetSelector)
          await randomDelay(300, 600)
        }
        const finalChecked = await this.isCheckboxChecked(targetSelector)
        if (!finalChecked) throw new Error(`广告设置未生效: ${post.enableAd}`)
      }
    } catch (e) { failures.push(`[Step 5] 广告设置未对上: ${e.message}`) }

    try {
      if (typeof post.declareFirstPublish === 'boolean') {
        this.log.info(`[Step 5] ${post.declareFirstPublish ? '开启' : '关闭'}头条首发`)
        const exclusiveInputSelector = `${S.exclusiveCheckboxItem} input[type="checkbox"]`
        await this.setCheckboxState(
          S.exclusiveCheckboxItem,
          exclusiveInputSelector,
          post.declareFirstPublish,
          '头条首发'
        )
        await randomDelay(300, 600)
      }
    } catch (e) { failures.push(`[Step 5] 首发声明未对上: ${e.message}`) }

    try {
      if (typeof post.publishWeiToutiao === 'boolean') {
        this.log.info(`[Step 5] ${post.publishWeiToutiao ? '开启' : '关闭'}同步微头条`)
        await this.setCheckboxState(
          S.microToutiaoToggle,
          S.microToutiaoInput,
          post.publishWeiToutiao,
          '同步微头条'
        )
        await randomDelay(300, 600)
      }
    } catch (e) { failures.push(`[Step 5] 微头条未对上: ${e.message}`) }

    // 作品声明（可选，post.declarations = ['个人观点'] 等）
    if (Array.isArray(post.declarations)) {
      try {
        this.log.info(`[Step 5] 设置作品声明: ${post.declarations.join(' | ') || '清空'}`)
        await this.setDeclarationStates(post.declarations)
        await randomDelay(300, 600)
      } catch (e) { failures.push(`[Step 5] 作品声明未对上: ${e.message}`) }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('；'))
    }
  }

  // ─── 发布前验证：回读页面所有选项的实际状态 ────────────────────────
  async verifyPageState(post) {
    const state = await this.page.evaluate(() => {
      const result = {}

      // 标题
      const titleTA = document.querySelector('textarea[placeholder*="标题"]')
      result.title = titleTA?.value || ''

      // 正文字数
      const editor = document.querySelector('div.ProseMirror')
      result.contentLength = (editor?.innerText || '').replace(/\s/g, '').length

      // 封面模式
      const coverRadios = document.querySelectorAll('.article-cover-radio-group label.byte-radio')
      for (const r of coverRadios) {
        const input = r.querySelector('input[type="radio"]')
        if (input?.checked) result.coverMode = r.textContent?.trim()
      }

      // 位置
      const posView = document.querySelector('.position-select .byte-select-view')
      result.location = posView?.textContent?.trim() || ''

      // 投放广告
      const adRadios = document.querySelectorAll('input[type="radio"]')
      for (const r of adRadios) {
        const label = r.closest('label')
        if (r.checked && label?.textContent?.includes('广告')) {
          result.ad = label.textContent.trim()
        }
      }

      // 头条首发（input.checked）
      const fpInput = document.querySelector('.exclusive-checkbox-wraper .byte-checkbox input[type="checkbox"]')
      result.firstPublish = fpInput ? !!fpInput.checked : null

      // 同步微头条（input.checked）
      const mtLabels = document.querySelectorAll('label.byte-checkbox')
      for (const l of mtLabels) {
        if (l.textContent?.includes('发布得更多收益')) {
          const input = l.querySelector('input[type="checkbox"]')
          result.weiToutiao = input ? !!input.checked : null
        }
      }

      // 作品声明
      const declLabels = document.querySelectorAll('.source-wrap label.byte-checkbox.checkbot-item')
      result.declarations = Array.from(declLabels)
        .filter(l => l.classList.contains('byte-checkbox-checked'))
        .map(l => l.textContent?.replace(/\s+/g, ' ').trim())

      return result
    })

    // 日志输出验证结果
    this.log.info(`[验证] 标题: "${state.title?.slice(0, 20)}..." (${state.title?.length || 0}字)`)
    this.log.info(`[验证] 正文: ${state.contentLength}字`)
    this.log.info(`[验证] 封面: ${state.coverMode || '未知'}`)
    this.log.info(`[验证] 位置: ${state.location || '未设置'}`)
    this.log.info(`[验证] 广告: ${state.ad || '未知'}`)
    this.log.info(`[验证] 首发: ${state.firstPublish}`)
    this.log.info(`[验证] 微头条: ${state.weiToutiao}`)
    this.log.info(`[验证] 声明: ${state.declarations?.join(' | ') || '无'}`)

    // 关键字段比对
    const warnings = []
    if (post.title && !state.title?.includes(post.title.slice(0, 10))) {
      warnings.push(`标题不匹配: 期望含"${post.title.slice(0, 10)}" 实际"${state.title?.slice(0, 20)}"`)
    }
    if (state.contentLength < 10) {
      warnings.push(`正文过短: ${state.contentLength}字`)
    }
    if (typeof post.enableAd === 'boolean') {
      const expectAd = post.enableAd ? '投放广告赚收益' : '不投放广告'
      if (!state.ad?.includes(expectAd)) {
        warnings.push(`广告不匹配: 期望"${expectAd}" 实际"${state.ad}"`)
      }
    }
    if (typeof post.declareFirstPublish === 'boolean' && state.firstPublish !== post.declareFirstPublish) {
      warnings.push(`首发状态不匹配: 期望${post.declareFirstPublish} 实际${state.firstPublish}`)
    }
    if (typeof post.publishWeiToutiao === 'boolean' && state.weiToutiao !== post.publishWeiToutiao) {
      warnings.push(`微头条状态不匹配: 期望${post.publishWeiToutiao} 实际${state.weiToutiao}`)
    }
    if (Array.isArray(post.declarations) && post.declarations.length > 0) {
      const target = post.declarations[post.declarations.length - 1]
      if (!state.declarations?.some(d => d.includes(target))) {
        warnings.push(`声明不匹配: 期望含"${target}" 实际[${state.declarations?.join(',')}]`)
      }
    }

    if (warnings.length > 0) {
      this.log.warn(`[验证] ⚠️ ${warnings.length}项不匹配:\n  ${warnings.join('\n  ')}`)
    } else {
      this.log.info('[验证] ✅ 所有选项验证通过')
    }
  }

  // ─── Step 6: 点击"预览并发布" ────────────────────────────────────────
  async step6_publish(post) {
    if (post.scheduleTime) {
      this.log.info(`[Step 6] 定时发布: ${post.scheduleTime}`)

      // 2026-04-16 实测: 头条"定时发布"按钮在部分账号上无效（onclick=noop, class=byte-btn-default）
      // 功能可能受账号权限/平台灰度控制。先尝试点击，失败则降级为普通发布。
      const btns = await this.page.$$('button.publish-btn')
      let scheduleBtn = null
      for (const btn of btns) {
        const text = await btn.evaluate(n => (n.textContent || '').trim())
        if (text === '定时发布') { scheduleBtn = btn; break }
      }

      if (scheduleBtn) {
        await scheduleBtn.click()
        await randomDelay(500, 1000)

        const modal = await this.page.waitForSelector(S.scheduleModal, { timeout: 5000 }).catch(() => null)
        if (modal) {
          // 弹窗出现，选择日期/时间
          const date = new Date(post.scheduleTime)
          const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`
          const hourStr = String(date.getHours())
          const minuteStr = String(date.getMinutes())

          await this.selectScheduleDropdown(S.scheduleDaySelect, dateStr, '日期')
          await this.selectScheduleDropdown(S.scheduleHourSelect, hourStr, '小时')
          await this.selectScheduleDropdown(S.scheduleMinuteSelect, minuteStr, '分钟')

          if (this._dryRun) {
            this.log.info('[Step 6] dryRun 模式：已选好定时发布时间，跳过确认')
            return
          }

          const confirmButton = await this.page.waitForSelector(S.scheduleConfirmButton, { timeout: 3000 }).catch(() => null)
          if (!confirmButton) throw new Error('未找到定时发布确认按钮')
          await confirmButton.click()
          await randomDelay(2000, 5000)

          await this.conservativeVerifyPublishResult({
            guardName: 'toutiao_step6_schedule_publish',
            waitOptions: {
              successTexts: ['定时发布成功', '发布成功', '发表成功', '提交成功', '设置成功', '保存成功'],
              errorTexts: ['发布失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核'],
              timeout: 12000,
            },
            useVisionWhenUnknown: false,
          })
          return
        }

        // 弹窗未出现 — 按钮无效
        this.log.info('[Step 6] 定时发布弹窗未出现（按钮可能对当前账号不可用）')
      } else {
        this.log.info('[Step 6] 未找到定时发布按钮')
      }

      // 降级处理
      if (this._dryRun) {
        this.log.info('[Step 6] dryRun 模式：定时发布不可用，跳过（内容已填写）')
        return
      }
      this.log.info('[Step 6] 定时发布不可用，降级为立即发布')
    }

    if (this._dryRun) {
      this.log.info('[Step 6] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }

    this.log.info('[Step 6] 点击「预览并发布」')
    const publishClicked = await this.page.evaluate((sel) => {
      const btns = document.querySelectorAll(sel)
      for (const btn of btns) {
        if ((btn.textContent || '').trim() === '预览并发布') {
          btn.scrollIntoView({ block: 'center', inline: 'center' })
          btn.click()
          return true
        }
      }
      return false
    }, S.publishBtnAlt)
    if (!publishClicked) throw new Error('未找到发布按钮')
    await randomDelay(2000, 5000)

    // 2026-04-15 安全加固：头条接入“保守发布结果校验”。
    // 修改原因：旧逻辑只做点击 + 固定等待，无法识别平台已经明确返回的失败/审核/频繁提示。
    // 修改策略：
    // - 只拦截明确失败文本；
    // - success / unknown 都先保持兼容，不直接收紧为失败；
    // - 不改标题/正文/导航逻辑，降低回归面。
    // 回退方式：删除下方 conservativeVerifyPublishResult() 调用。
    await this.conservativeVerifyPublishResult({
      guardName: 'toutiao_step6_publish',
      waitOptions: {
        successTexts: ['发布成功', '发表成功', '提交成功', '保存成功'],
        errorTexts: ['发布失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核'],
        timeout: 12000,
      },
      useVisionWhenUnknown: false,
    })
  }

  async selectScheduleDropdown(triggerSelector, optionText, label) {
    // 用 mouse.click() 生成 isTrusted 事件
    const triggerRect = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, triggerSelector)
    if (!triggerRect) throw new Error(`未找到定时${label}选择器`)
    await this.page.mouse.click(triggerRect.x, triggerRect.y)
    await randomDelay(300, 600)

    // 选项也用 mouse.click()
    const optRect = await this.page.evaluate((sel, text) => {
      const items = document.querySelectorAll(sel)
      for (const item of items) {
        if ((item.textContent || '').trim() === text) {
          item.scrollIntoView({ block: 'center', inline: 'center' })
          const r = item.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }
      }
      return null
    }, S.scheduleOption, optionText)
    if (!optRect) throw new Error(`未找到定时${label}选项: ${optionText}`)
    await this.page.mouse.click(optRect.x, optRect.y)
    await randomDelay(300, 600)
  }
}
