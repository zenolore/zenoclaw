import fs from 'node:fs'
import path from 'node:path'
import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 百家号文章发布适配器（2026-04-16 MCP 实测重写）
 *
 * 文章发布页: https://baijiahao.baidu.com/builder/rc/edit?type=news
 *
 * 页面组件:
 *   标题 → Lexical contenteditable div[data-lexical-editor]
 *   正文 → UEditor iframe#ueditor_0 body.view[contenteditable]
 *   封面 → 单图/三图 radio → 选择封面按钮 → 弹窗上传
 *   智能创作 → 自动生成播客 / 图文转动态 checkbox
 *   创作声明 → 采用AI生成内容 / 来源说明 checkbox
 *
 * 发布流程:
 *   Step 1  打开发布页
 *   Step 2  输入标题（Lexical contenteditable）
 *   Step 3  输入正文（iframe UEditor） / contentBlocks
 *   Step 4  上传封面图（弹窗流程）
 *   Step 5  配置选项（智能创作 + 创作声明）
 *   Step 6  点击发布
 */

const S = PUBLISH_SELECTORS

export class BaijiahaoAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'baijiahao'
    this.publishUrl = 'https://baijiahao.baidu.com/builder/rc/edit?type=news'
  }

  getHomeUrl() { return 'https://baijiahao.baidu.com/builder/rc/home' }
  getLoginUrl() { return 'https://baijiahao.baidu.com/' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  // ─── 入口 ─────────────────────────────────────────────────────────
  async publish(post) {
    this.log.info('========== 百家号发布开始 ==========')

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

      // 2026-04-17: 百家号也会自动把正文首图作为封面（与头条一致），所以先 step4 再 step3
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

      await this.verifyPageState(normalizedPost)

      await this.showStatus('发布文章...').catch(() => {})
      await this.step6_publish(normalizedPost)

      await this.showStatus('发布完成！').catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 百家号发布完成 ==========')
      return this.buildResult(true, '百家号发布成功')
    } catch (err) {
      this.log.error(`百家号发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  // ─── normalizePostForPublish ─────────────────────────────────────
  normalizePostForPublish(post) {
    const normalized = {
      ...post,
      coverType: post.coverType || ((post.images && post.images.length > 0) ? 'single' : undefined),
    }
    if (normalized.coverType === 'single' && (!normalized.images || normalized.images.length < 1)) {
      throw new Error('百家号单图封面至少需要 1 张图片')
    }
    if (normalized.coverType === 'triple' && (!normalized.images || normalized.images.length < 3)) {
      throw new Error('百家号三图封面至少需要 3 张图片')
    }
    return normalized
  }

  // ─── Step 1: 打开发布页 ──────────────────────────────────────────
  async step1_openPublishPage() {
    this.log.info('[Step 1] 打开百家号文章发布页')
    await this.navigateTo(this.publishUrl)
    await randomDelay(cfg('timing.action_delay_min', 2000), cfg('timing.action_delay_max', 5000))

    const currentUrl = this.page.url()
    if (currentUrl.includes(S.loginPageIndicator) || currentUrl.includes(S.loginPageIndicatorAlt)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录百家号')
    }

    // 关闭可能的弹窗（"我知道了"等提示）
    await this.dismissPopups()

    // 等待编辑器就绪
    await this.page.waitForSelector(S.titleEditor, { timeout: 10000 }).catch(() => {
      this.log.warn('Lexical 标题编辑器未在 10s 内出现，尝试继续')
    })

    await this.conditionalScreenshot('baijiahao_step1_open', 'step')
  }

  // ─── Step 2: 输入标题 ────────────────────────────────────────────
  async step2_inputTitle(title) {
    this.log.info('[Step 2] 输入标题（Lexical 编辑器）')
    await randomDelay(1000, 2000)

    // 尝试 Lexical contenteditable div
    const candidates = [S.titleEditor, S.titleSimulator, 'textarea', 'input[type="text"]']
    let clicked = false
    for (const sel of candidates) {
      try {
        await this.page.click(sel)
        clicked = true
        this.log.info(`标题输入框已点击: ${sel}`)
        break
      } catch { /* next */ }
    }
    if (!clicked) throw new Error('未找到标题输入框')

    await randomDelay(300, 600)

    // Lexical 编辑器需要通过剪贴板粘贴输入，CDP Input.insertText 无法触发其内部状态更新
    await this.page.evaluate((sel, text) => {
      const el = document.querySelector(sel)
      if (!el) return
      el.focus()
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, S.titleEditor, title)
    await randomDelay(800, 1500)

    // 回读验证
    const readBack = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return el?.textContent?.trim() || ''
    }, S.titleEditor).catch(() => '')
    if (readBack.length > 0 && readBack.includes(title.slice(0, 10))) {
      this.log.info(`标题已输入: ${readBack.slice(0, 30)}`)
    } else {
      // Fallback: 使用 keyboard.type（逐字输入，兼容性更好但较慢）
      this.log.warn(`ClipboardEvent 粘贴未生效（回读: "${readBack.slice(0, 20)}"），尝试 keyboard.type`)
      // 先清空
      await this.page.click(S.titleEditor)
      await this.page.keyboard.down('Control')
      await this.page.keyboard.press('a')
      await this.page.keyboard.up('Control')
      await this.page.keyboard.press('Backspace')
      await randomDelay(200, 400)
      await this.page.keyboard.type(title, { delay: 30 })
      await randomDelay(500, 1000)

      const readBack2 = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel)
        return el?.textContent?.trim() || ''
      }, S.titleEditor).catch(() => '')
      this.log.info(`标题 keyboard.type 结果: ${readBack2.slice(0, 30)}`)
    }

    await randomDelay(500, 1500)
  }

  // ─── Step 3: 输入正文（纯文本模式） ─────────────────────────────
  async step3_inputContent(content) {
    this.log.info('[Step 3] 输入正文（iframe UEditor）')
    // 移除可能遮挡 iframe 的 SVG rect 覆盖层
    await this._removeEditorOverlay()
    const editorBody = await this._getEditorBody()
    await editorBody.click()
    await randomDelay(300, 600)
    const cdp = await this.page.target().createCDPSession()
    await cdp.send('Input.insertText', { text: content })
    await cdp.detach()
    this.log.info(`正文输入完成（${content.length} 字）`)
    await randomDelay(500, 1500)
  }

  // ─── Step 3: 输入正文（contentBlocks 图文混排） ──────────────────
  async step3_inputContentBlocks(contentBlocks) {
    this.log.info(`[Step 3] 输入正文 contentBlocks（${contentBlocks.length} 个块）`)
    await this._removeEditorOverlay()
    const editorBody = await this._getEditorBody()
    const editorFrame = await this._getEditorFrame()
    await editorBody.click()
    await randomDelay(300, 600)

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]
      if (block.type === 'text') {
        // 粘贴文字
        await editorFrame.evaluate((text) => {
          const dt = new DataTransfer()
          dt.setData('text/plain', text)
          document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
        }, block.value)
        await randomDelay(300, 500)
        // 按 Enter 换行
        await this.page.keyboard.press('Enter')
        await randomDelay(200, 400)
        this.log.info(`  文字块 ${i + 1} 已输入 (${block.value?.length || 0} 字)`)
      } else if (block.type === 'image') {
        // 粘贴图片
        const imgPath = block.src
        if (!imgPath || !fs.existsSync(imgPath)) {
          this.log.warn(`  图片块 ${i + 1} 文件不存在: ${imgPath}，跳过`)
          continue
        }
        const buf = fs.readFileSync(imgPath)
        const base64 = buf.toString('base64')
        const ext = path.extname(imgPath).toLowerCase()
        const mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png'
        const fileName = path.basename(imgPath)

        await editorFrame.evaluate(async (b64, mime, name) => {
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const blob = new Blob([bytes], { type: mime })
          const file = new File([blob], name, { type: mime })
          const dt = new DataTransfer()
          dt.items.add(file)
          document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
        }, base64, mimeType, fileName)

        this.log.info(`  图片上传中: ${fileName}`)
        await randomDelay(4000, 6000)
        // 换行，光标移到下一行
        await this.page.keyboard.press('ArrowDown')
        await this.page.keyboard.press('End')
        await this.page.keyboard.press('Enter')
        await randomDelay(300, 500)
      }
    }
    this.log.info('contentBlocks 正文输入完成')
  }

  // ─── Step 4: 封面配置 ────────────────────────────────────────────
  async step4_configCover(post) {
    const coverType = post.coverType || 'single'
    if (coverType === 'none') {
      this.log.info('[Step 4] 无封面模式，跳过')
      return
    }

    this.log.info(`[Step 4] 配置封面（${coverType}）`)

    // 选择封面类型 radio
    const radioSel = coverType === 'triple' ? S.coverRadioTriple : S.coverRadioSingle
    try {
      await this.page.evaluate((sel) => {
        const r = document.querySelector(sel)
        if (r) r.click()
      }, radioSel)
      this.log.info(`封面类型已选择: ${coverType}`)
    } catch {
      this.log.warn(`未找到封面类型 radio: ${radioSel}，使用默认`)
    }
    await randomDelay(800, 1500)

    // 滚动到封面区域，等待 "选择封面" 按钮渲染
    await this.page.evaluate(() => {
      const radio3 = document.querySelector('input[type="radio"][value="three"]')
      const radio1 = document.querySelector('input[type="radio"][value="one"]')
      const anchor = radio3 || radio1
      anchor?.scrollIntoView({ block: 'center' })
    }).catch(() => {})
    await randomDelay(500, 1000)

    // 2026-04-17: 百家号可能从草稿/AI 预生成自动填充封面，需要先清空所有已有封面
    // 点击每个 item 下 hoverOverlay 里的"删除"button，重置为"选择封面"空槽
    const cleared = await this.page.evaluate(() => {
      const list = document.querySelector('[class*="list"][class*="three"], [class*="list"][class*="one"]')
      if (!list) return 0
      const items = list.querySelectorAll('[class*="item"]')
      let count = 0
      for (const item of items) {
        const hasCover = !!item.querySelector('[class*="coverWrapper"], [class*="coverImg"]')
        if (!hasCover) continue
        // 触发 hover
        ;['mouseenter', 'mouseover', 'mousemove'].forEach(t => {
          item.dispatchEvent(new MouseEvent(t, { bubbles: true }))
        })
        // 找"删除"button
        const btns = item.querySelectorAll('button')
        for (const b of btns) {
          const t = b.textContent?.trim()
          if (t === '删除' || t === '移除') { b.click(); count++; break }
        }
      }
      return count
    })
    if (cleared > 0) {
      this.log.info(`[Step 4] 清空 ${cleared} 张已有封面（AI/草稿预填）`)
      await randomDelay(1000, 1500)
      // 可能有"确认删除"弹窗，点击确定
      await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button')
        for (const b of btns) {
          const t = b.textContent?.trim()
          if ((t === '确定' || t === '确认') && b.offsetParent !== null) { b.click(); return true }
        }
        return false
      }).catch(() => {})
      await randomDelay(800, 1200)
    }

    const requiredCount = coverType === 'triple' ? 3 : 1
    const imagePaths = (post.images || []).slice(0, requiredCount)

    for (let i = 0; i < imagePaths.length; i++) {
      const imgPath = imagePaths[i]
      if (!fs.existsSync(imgPath)) {
        this.log.warn(`封面图文件不存在: ${imgPath}，跳过`)
        continue
      }

      // 2026-04-17: 三图模式 DOM 结构 _93c3fe2a3121c388-list._93c3fe2a3121c388-three
      // > _93c3fe2a3121c388-item (x3) > cheetah-spin-* > _73a3a52aab7e3a36-default > _73a3a52aab7e3a36-content > _73a3a52aab7e3a36-text "选择封面"
      // 实测点击目标是 _73a3a52aab7e3a36-default（带 width/height style 的 div）
      // 诊断：输出当前 cover-list 的 HTML
      if (i === 0) {
        const listDiag = await this.page.evaluate(() => {
          const list = document.querySelector('[class*="list"][class*="three"], [class*="list"][class*="one"]')
          return {
            listExists: !!list,
            listClass: list ? String(list.className).slice(0, 80) : '',
            itemCount: list?.querySelectorAll('[class*="item"]').length || 0,
            firstItemHTML: list?.querySelector('[class*="item"]')?.outerHTML?.slice(0, 600) || '',
          }
        })
        this.log.info(`[诊断] cover-list: ${JSON.stringify(listDiag)}`)
      }

      // 2026-04-17 百家号封面点击策略：
      //   空槽 → 点击"选择封面"文本 → 弹窗上传
      //   已有图 → 点击 hoverOverlay 里的"换封面"button → 弹窗上传
      const clicked = await this.page.evaluate((text, index) => {
        const list = document.querySelector('[class*="list"][class*="three"], [class*="list"][class*="one"]')
        if (!list) return { strategy: 'no-list' }
        const items = list.querySelectorAll('[class*="item"]')
        const item = items[index] || items[0]
        if (!item) return { strategy: 'no-item', itemsTotal: items.length }

        // 判断：该 item 是否已有封面图（coverWrapper / coverImg）
        const hasCover = !!item.querySelector('[class*="coverWrapper"], [class*="coverImg"], img')

        if (hasCover) {
          // 已有封面 → hover 触发 overlay 显示，再点击"编辑/换封面"button（完整 mouse 事件链）
          const overlay = item.querySelector('[class*="hoverOverlay"]')
          ;['mouseenter', 'mouseover', 'mousemove'].forEach(t => {
            item.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
            if (overlay) overlay.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
          })
          // 点击"编辑/换封面"button（完整 mouse 事件链：pointerdown/mousedown/mouseup/click）
          const btns = item.querySelectorAll('button')
          for (const b of btns) {
            const t = b.textContent?.trim() || ''
            if (t && !t.includes('删除') && !t.includes('确定') && !t.includes('取消')) {
              const rect = b.getBoundingClientRect()
              const x = rect.left + rect.width / 2
              const y = rect.top + rect.height / 2
              const evtInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }
              b.dispatchEvent(new PointerEvent('pointerover', evtInit))
              b.dispatchEvent(new PointerEvent('pointerenter', evtInit))
              b.dispatchEvent(new MouseEvent('mouseover', evtInit))
              b.dispatchEvent(new MouseEvent('mouseenter', evtInit))
              b.dispatchEvent(new PointerEvent('pointerdown', evtInit))
              b.dispatchEvent(new MouseEvent('mousedown', evtInit))
              b.dispatchEvent(new PointerEvent('pointerup', evtInit))
              b.dispatchEvent(new MouseEvent('mouseup', evtInit))
              b.click()
              return { strategy: 'hover-replace', itemIndex: index, btnText: t, btnCount: btns.length }
            }
          }
          return { strategy: 'no-btn-in-cover', itemIndex: index }
        }

        // 空槽 → 点击"选择封面"文本叶子
        const leaves = Array.from(item.querySelectorAll('*')).filter(el => el.children.length === 0)
        const textEl = leaves.find(el => el.textContent?.trim() === text)
        if (textEl) {
          textEl.click()
          return { strategy: 'text-leaf', itemIndex: index, className: textEl.className?.slice(0, 50) }
        }
        // fallback: _73a3a52aab7e3a36-text 类
        const textClass = item.querySelector('[class*="-text"]')
        if (textClass) {
          textClass.click()
          return { strategy: 'text-class', itemIndex: index }
        }
        return { strategy: 'empty-no-text', itemIndex: index }
      }, S.coverSelectButtonText, i)

      this.log.info(`  封面 ${i + 1} 点击结果: ${JSON.stringify(clicked)}`)
      if (clicked.strategy === 'none' || clicked.strategy === 'no-list' || clicked.strategy === 'no-item') {
        this.log.warn(`  未找到第 ${i + 1} 个封面槽位，跳过`)
        continue
      }

      // 2026-04-17: React onMouseDown 可能拒绝 evaluate 合成事件；再用 Puppeteer 真实 mouse 事件补点击
      // 先获取目标按钮坐标
      const targetRect = await this.page.evaluate((index, hasCoverTxt) => {
        const list = document.querySelector('[class*="list"][class*="three"], [class*="list"][class*="one"]')
        const items = list?.querySelectorAll('[class*="item"]')
        const item = items?.[index] || items?.[0]
        if (!item) return null
        const hasCover = !!item.querySelector('[class*="coverWrapper"], [class*="coverImg"], img')
        let target = null
        if (hasCover) {
          const btns = item.querySelectorAll('button')
          for (const b of btns) {
            const t = b.textContent?.trim() || ''
            if (t && !t.includes('删除') && !t.includes('确定') && !t.includes('取消')) { target = b; break }
          }
        } else {
          const leaves = Array.from(item.querySelectorAll('*')).filter(el => el.children.length === 0)
          target = leaves.find(el => el.textContent?.trim() === hasCoverTxt)
        }
        if (!target) return null
        target.scrollIntoView({ block: 'center' })
        const r = target.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, i, S.coverSelectButtonText)

      if (targetRect && targetRect.x > 0 && targetRect.y > 0) {
        // 真实鼠标点击
        await this.page.mouse.move(targetRect.x, targetRect.y, { steps: 10 })
        await randomDelay(200, 400)
        await this.page.mouse.click(targetRect.x, targetRect.y, { delay: 100 })
        this.log.info(`  封面 ${i + 1} 真实鼠标点击: (${Math.round(targetRect.x)}, ${Math.round(targetRect.y)})`)
      }
      await randomDelay(1500, 2500)

      // 在弹窗内设置 file input（可能在 body 下）
      let fileInput = await this.page.$(S.coverFileInput)
      if (!fileInput) {
        // fallback：任意 image/* input
        fileInput = await this.page.$('input[type="file"][accept*="image"]')
      }
      if (!fileInput) {
        this.log.warn('未找到弹窗内 file input，跳过')
        try { await this.clickByText('button', S.coverCancelButtonText) } catch {}
        continue
      }
      await fileInput.uploadFile(imgPath)
      this.log.info(`封面图 ${i + 1}/${imagePaths.length} 已选择: ${path.basename(imgPath)}`)
      await randomDelay(2500, 4500)

      // 点击确定
      try {
        await this.clickByText('button', S.coverConfirmButtonText)
        this.log.info(`封面图 ${i + 1} 确认完成`)
      } catch {
        this.log.warn('未找到确定按钮，尝试继续')
      }
      await randomDelay(1500, 2500)
    }
  }

  // ─── Step 5: 配置发布选项 ────────────────────────────────────────
  async step5_configOptions(post) {
    this.log.info('[Step 5] 配置发布选项')

    // 智能创作 → 自动生成播客（默认勾选，如果不需要可取消）
    if (post.disablePodcast) {
      await this._toggleCheckboxByLabel(S.autoPodcastCheckbox, false)
    }
    // 智能创作 → 图文转动态
    if (post.enableArticleToDynamic) {
      await this._toggleCheckboxByLabel(S.articleToDynamicCheckbox, true)
    }

    // 创作声明 → 采用AI生成内容
    if (post.declareAiContent) {
      await this._toggleCheckboxByLabel(S.aiContentCheckbox, true)
    }
    // 创作声明 → 来源说明
    if (post.declareSource) {
      await this._toggleCheckboxByLabel(S.sourceCitationCheckbox, true)
    }

    await randomDelay(500, 1000)
    this.log.info('发布选项配置完成')
  }

  // ─── verifyPageState ─────────────────────────────────────────────
  async verifyPageState(post) {
    this.log.info('[验证] 发布前回读页面状态')

    // 回读标题
    const titleText = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return el?.textContent?.trim() || ''
    }, S.titleEditor).catch(() => '')
    const titleOk = titleText.length > 0
    this.log.info(`  标题: ${titleOk ? '✅' : '❌'} (${titleText.slice(0, 30)})`)

    // 回读正文字数（页面底部显示 "字数 N"）
    const wordCount = await this.page.evaluate(() => {
      const all = document.querySelectorAll('*')
      for (const el of all) {
        const text = el.textContent?.trim()
        if (text && /^字数\s*\d+$/.test(text)) return text.match(/\d+/)?.[0] || '0'
      }
      return '0'
    }).catch(() => '0')
    this.log.info(`  字数: ${wordCount}`)

    // 回读封面类型（优先用 radio value，备选检查 DOM class）
    const coverState = await this.page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"]')
      for (const r of radios) {
        if (r.checked) return r.value === 'three' ? 'triple' : (r.value === 'one' ? 'single' : r.value)
      }
      // 备选：检查 wrapper 上的 checked class
      const wrappers = document.querySelectorAll('[class*="radio"]')
      for (const w of wrappers) {
        if (w.className.includes('checked') && w.textContent?.includes('三图')) return 'triple'
        if (w.className.includes('checked') && w.textContent?.includes('单图')) return 'single'
      }
      return 'unknown'
    }).catch(() => 'unknown')
    this.log.info(`  封面类型: ${coverState}`)

    this.addStepEvidence('verifyPageState', { titleOk, wordCount, coverState })
  }

  // ─── Step 6: 发布 ────────────────────────────────────────────────
  async step6_publish(post) {
    if (this._dryRun) {
      this.log.info('[Step 6] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[Step 6] 点击发布')
    await this.clickByText('button', S.publishButtonText)
    await randomDelay(2000, 5000)

    await this.conservativeVerifyPublishResult({
      guardName: 'baijiahao_step6_publish',
      waitOptions: {
        successTexts: ['发布成功', '发表成功', '提交成功', '保存成功'],
        errorTexts: ['发布失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核'],
        timeout: 12000,
      },
      useVisionWhenUnknown: false,
    })
  }

  // ─── 辅助方法 ────────────────────────────────────────────────────

  /** 移除遮挡 UEditor iframe 的 SVG rect 覆盖层 */
  async _removeEditorOverlay() {
    try {
      const removed = await this.page.evaluate(() => {
        let count = 0
        // 百家号编辑器上方有一个透明 SVG rect 拦截鼠标事件
        const rects = document.querySelectorAll('rect[pointer-events="auto"]')
        rects.forEach(r => { r.remove(); count++ })
        return count
      })
      if (removed > 0) this.log.info(`已移除 ${removed} 个编辑器遮罩层`)
    } catch { /* ignore */ }
  }

  /** 获取 UEditor iframe 内的 body 元素 */
  async _getEditorBody() {
    const frames = this.page.frames()
    for (const frame of frames) {
      if (frame === this.page.mainFrame()) continue
      try {
        const body = await frame.$(S.contentIframeBody) || await frame.$(S.contentIframeBodyAlt)
        if (body) return body
      } catch { /* skip */ }
    }
    throw new Error('未找到百家号正文 iframe 编辑器 body')
  }

  /** 获取 UEditor iframe frame 对象 */
  async _getEditorFrame() {
    const frames = this.page.frames()
    for (const frame of frames) {
      if (frame === this.page.mainFrame()) continue
      try {
        const body = await frame.$(S.contentIframeBody) || await frame.$(S.contentIframeBodyAlt)
        if (body) return frame
      } catch { /* skip */ }
    }
    throw new Error('未找到百家号正文 iframe 编辑器 frame')
  }

  /** 通过文本标签切换 checkbox 状态 */
  async _toggleCheckboxByLabel(labelText, targetChecked) {
    try {
      const result = await this.page.evaluate((text, target) => {
        // 沿父级向上找文本，匹配包含 labelText 的 checkbox
        const checkboxes = document.querySelectorAll('input[type="checkbox"]')
        for (const cb of checkboxes) {
          let el = cb, label = ''
          for (let i = 0; i < 5; i++) {
            el = el.parentElement
            if (!el) break
            const t = el.textContent?.trim()
            if (t && t.length > 2 && t.length < 50) { label = t; break }
          }
          if (label.includes(text)) {
            if (cb.checked !== target) {
              // 点击 wrapper 而非 hidden input，确保 UI 联动
              const wrapper = cb.closest('.cheetah-checkbox-wrapper') || cb.parentElement
              wrapper.click()
              return { found: true, toggled: true, label }
            }
            return { found: true, toggled: false, label }
          }
        }
        return { found: false }
      }, labelText, targetChecked)

      if (result.found) {
        this.log.info(`  ${labelText}: ${result.toggled ? '已切换' : '已是目标状态'}`)
      } else {
        this.log.warn(`  ${labelText}: 未找到`)
      }
    } catch (err) {
      this.log.warn(`  ${labelText} 切换失败: ${err.message}`)
    }
  }

  /** 关闭页面上可能存在的提示弹窗 */
  async dismissPopups() {
    const dismissTexts = ['我知道了', '关闭', '知道了']
    for (const text of dismissTexts) {
      try {
        const btn = await this.findByText('button', text)
        if (btn) {
          await this.clickElement(btn)
          this.log.info(`已关闭弹窗: ${text}`)
          await randomDelay(500, 1000)
        }
      } catch { /* ignore */ }
    }
    // 点击页面其他位置可能关闭的引导提示
    try {
      const nextBtn = await this.findByText('button', '下一步')
      if (nextBtn) {
        // AI 工具引导提示，连续点击跳过
        for (let i = 0; i < 5; i++) {
          const btn = await this.findByText('button', '下一步') || await this.findByText('button', '我知道了')
          if (!btn) break
          await this.clickElement(btn)
          await randomDelay(300, 600)
        }
      }
    } catch { /* ignore */ }
  }
}
