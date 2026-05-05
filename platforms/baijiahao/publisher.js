import fs from 'node:fs'
import path from 'node:path'
import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import {
  PUBLISH_SELECTORS,
  INTERACT_SELECTORS,
  CREATOR_ENTRY_SELECTORS
} from './selectors.js'
import { isVideoPublishPost, runVideoPublishDryRun } from '../video-publish-dry-run.js'

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

  /**
   * 多入口策略：每次进文章发布页换一种方式（按 persona 偏好 + 历史去重）
   *
   * 百家号实测发现后台首页有醒目的「发布作品」按钮（div#home-publish-btn）。
   * 候选：
   *   - dashboard:  从后台 home 点击「发布作品」按钮（自然路由）
   *   - directUrl:  直接 goto edit?type=news（兜底）
   */
  getCreatorEntryStrategies() {
    const ENTRY = CREATOR_ENTRY_SELECTORS
    const editUrl = this.publishUrl
    const homeUrl = this.getHomeUrl()

    return [
      {
        key: 'dashboard',
        label: '后台首页「发布作品」按钮',
        weight: 3,
        run: async (adapter) => {
          await adapter.navigateTo(homeUrl)
          await randomDelay(2000, 3500)
          let clicked = false
          for (const sel of ENTRY.dashboardPublishButton) {
            try { await adapter.clickEntrySelector(sel); clicked = true; break } catch { /* next */ }
          }
          if (!clicked) {
            try { clicked = await adapter.clickByText('div', ENTRY.dashboardPublishButtonText, { timeoutMs: 3500 }) } catch { /* next */ }
          }
          if (!clicked) throw new Error('百家号「发布作品」按钮未命中')
          await randomDelay(2000, 4000)
          // 发布作品按钮可能弹出选项面板（文章/视频/动态）；直接 goto 文章 edit URL 避免分支
          await adapter.navigateTo(editUrl)
          await randomDelay(1500, 3000)
        }
      },
      {
        key: 'directUrl',
        label: '直接 URL 进入文章编辑器',
        weight: 1,
        run: async (adapter) => {
          await adapter.navigateTo(editUrl)
          await randomDelay(800, 1800)
        }
      }
    ]
  }

  // ─── 入口 ─────────────────────────────────────────────────────────
  async publish(post) {
    this.log.info('========== 百家号发布开始 ==========')

    if (isVideoPublishPost(post)) {
      try {
        return await runVideoPublishDryRun(this, this.platformName, post)
      } catch (err) {
        this.log.error(`百家号视频 dryRun 失败: ${err.message}`)
        return { ...this.buildResult(false, err), contentType: 'video', dryRun: true }
      }
    }

    try {
      const normalizedPost = this.normalizePostForPublish(post)
      this.log.info(`标题: ${normalizedPost.title}`)
      this._dryRun = !!normalizedPost.dryRun
      if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')

      // 设置任务标签和步骤
      this._overlayTaskLabel = '百家号 · 文章发布任务执行中'
      const hasCover = normalizedPost.coverType || (normalizedPost.images && normalizedPost.images.length > 0)
      const steps = ['预热浏览', '打开发布页面', '输入标题', '输入正文']
      if (hasCover) steps.push('配置封面图')
      steps.push('配置发布选项', '模拟人工通读检查', '发布文章')
      const T = steps.length
      let S = 0

      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开发布页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在通过多入口策略打开发布页面', { next: '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())

      S++
      await this.showStatus('正在模拟人工输入标题', { next: '输入正文', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step2_inputTitle(normalizedPost.title))

      // 2026-04-18: 先输正文（百家号会自动把正文首图作为封面），再 step4 做封面细调
      //   原因：zenoclaw page 级 ws 降级模式下 fileChooser 无法触发，无法直接上传封面文件
      //   依赖正文首图 = 我们 Step 3 里 paste 的 AI 生成插画（非手机截图），符合用户预期
      S++
      await this.showStatus('正在模拟人工输入正文内容', { next: hasCover ? '配置封面图' : '配置发布选项', step: S, total: T }).catch(() => {})
      if (normalizedPost.contentBlocks?.length) {
        await this.runStep('inputContent', () => this.step3_inputContentBlocks(normalizedPost.contentBlocks))
      } else {
        await this.runStep('inputContent', () => this.step3_inputContent(normalizedPost.content))
      }

      if (hasCover) {
        S++
        await this.showStatus('正在配置封面图样式', { next: '配置发布选项', step: S, total: T }).catch(() => {})
        await this.runStep('configCover', () => this.step4_configCover(normalizedPost))
      }

      S++
      await this.showStatus('正在配置发布选项参数', { next: '通读检查', step: S, total: T }).catch(() => {})
      await this.runStep('configOptions', () => this.step5_configOptions(normalizedPost))

      await this.verifyPageState(normalizedPost)

      // 写完后通读检查：滚到顶看标题、慢速滚到底、偶发回滚
      S++
      await this.showStatus('正在模拟人工通读检查内容', { next: '发布文章', step: S, total: T }).catch(() => {})
      await this.runStep('reviewBeforeSubmit', () => this.reviewBeforeSubmit())

      S++
      await this.showStatus('正在点击发布按钮提交文章', { step: S, total: T }).catch(() => {})
      await this.runStep('publish', () => this.step6_publish(normalizedPost))

      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      // 2026-04-26 新增：发布成功后、跳首页之前，抓真实文章页 URL
      if (!this._dryRun) {
        await this.captureRealPostUrl(normalizedPost).catch((e) => {
          this.log.warn(`[发布后] 抓取真实文章 URL 失败: ${e.message}（不影响发布结果）`)
        })
      }

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
    this.log.info('[Step 1] 打开百家号文章发布页（多入口策略）')
    // 不再直接 goto；按 persona 偏好 + 历史去重选一种入口；全部失败时兜底 goto
    await this.navigateToPublishViaEntry()
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

    // 2026-04-18：强制清空 Lexical — 百家号 /edit?type=news 会加载最近未提交草稿，
    // 旧代码 ClipboardEvent paste 会"追加到旧内容后面"，并且回读判定太宽（only substring check），
    // 导致标题累积成垃圾。必须显式清空 + 严格 === 回读。
    await this.page.click(S.titleEditor)
    this.log.info(`标题输入框已点击: ${S.titleEditor}`)
    await randomDelay(300, 600)

    // 1) 全选 + Backspace 清空
    await this.page.keyboard.down('Control')
    await this.page.keyboard.press('a')
    await this.page.keyboard.up('Control')
    await randomDelay(150, 300)
    await this.page.keyboard.press('Backspace')
    await randomDelay(300, 500)
    // 再兜底：删除所有残余字符
    for (let i = 0; i < 3; i++) {
      const remain = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel)
        return (el?.textContent || '').length
      }, S.titleEditor).catch(() => 0)
      if (remain === 0) break
      await this.page.keyboard.down('Control')
      await this.page.keyboard.press('a')
      await this.page.keyboard.up('Control')
      await this.page.keyboard.press('Delete')
      await randomDelay(200, 400)
    }
    const afterClear = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return (el?.textContent || '').trim()
    }, S.titleEditor).catch(() => '')
    if (afterClear.length > 0) {
      this.log.warn(`[Step 2] 清空后仍有残余: "${afterClear.slice(0, 30)}"`)
    } else {
      this.log.info('[Step 2] 标题已清空')
    }

    // 2) keyboard.type 输入（对 Lexical 兼容性最稳，每字触发合成事件）
    await this.page.keyboard.type(title, { delay: 20 })
    await randomDelay(600, 1000)

    // 3) 严格回读：必须等于期望标题
    const readBack = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return (el?.textContent || '').trim()
    }, S.titleEditor).catch(() => '')
    if (readBack === title) {
      this.log.info(`[Step 2] 标题已输入（严格校验通过）: ${readBack.slice(0, 30)}`)
    } else {
      // 最后一搏：ClipboardEvent paste（已清空过，不会追加）
      this.log.warn(`[Step 2] keyboard.type 回读不一致（got "${readBack.slice(0, 30)}"），改用 ClipboardEvent paste`)
      await this.page.evaluate((sel, text) => {
        const el = document.querySelector(sel)
        if (!el) return
        el.focus()
        const dt = new DataTransfer()
        dt.setData('text/plain', text)
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      }, S.titleEditor, title)
      await randomDelay(600, 1000)
      const readBack2 = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel)
        return (el?.textContent || '').trim()
      }, S.titleEditor).catch(() => '')
      if (readBack2 !== title) {
        throw new Error(`[Step 2] 标题输入失败：期望="${title.slice(0, 30)}" 实际="${readBack2.slice(0, 30)}"`)
      }
      this.log.info(`[Step 2] 标题已输入（paste fallback）: ${readBack2.slice(0, 30)}`)
    }

    await randomDelay(500, 1500)
  }

  // ─── Step 3: 输入正文（纯文本模式） ─────────────────────────────
  // 2026-04-18 重写：用 UEditor 官方 API (window.UE_V2.instants['ueditorInstant0'].setContent)
  // 原因：旧实现用 ClipboardEvent plain-text paste，UEditor 的 paste handler 不处理纯文本 → 文字根本没写进去
  async step3_inputContent(content) {
    this.log.info(`[Step 3] 输入正文（UEditor API，${(content || '').length} 字）`)
    await this._removeEditorOverlay()
    const html = this._textToParagraphs(content || '')
    const res = await this.page.evaluate((h) => {
      const ue = window.UE_V2?.instants?.['ueditorInstant0'] || Object.values(window.UE_V2?.instants || {})[0]
      if (!ue?.setContent) return { ok: false, reason: 'no-ue' }
      ue.setContent(h)
      ue.focus?.()
      return { ok: true, len: (ue.getContentTxt?.() || '').length }
    }, html)
    if (!res.ok) throw new Error(`[Step 3] UEditor 不可用: ${res.reason}`)
    this.log.info(`[Step 3] 正文输入完成（UEditor 回读 ${res.len} 字）`)
    await randomDelay(500, 1200)
  }

  // ─── Step 3: 输入正文（contentBlocks 图文混排） ──────────────────
  // 2026-04-18 重写：
  //   1) 用 UEditor.setContent('<p><br></p>') 清空（替代旧的"光标定位 + paste"）
  //   2) 文字块 → UEditor.execCommand('insertHtml', '<p>...</p>')
  //   3) 图片块 → iframe ClipboardEvent paste File（UEditor 的图片 paste handler 工作正常）
  //   4) 严格回读 UEditor.getContentTxt().length 必须 >= 期望文字 * 0.5
  async step3_inputContentBlocks(contentBlocks) {
    this.log.info(`[Step 3] 输入正文 contentBlocks（${contentBlocks.length} 个块，UEditor API）`)
    await this._removeEditorOverlay()

    // (0) 清空 UEditor（清除之前残留的旧草稿/图片占位符）
    const clearRes = await this.page.evaluate(() => {
      const ue = window.UE_V2?.instants?.['ueditorInstant0'] || Object.values(window.UE_V2?.instants || {})[0]
      if (!ue?.setContent) return { ok: false, reason: 'no-ue-setContent' }
      ue.setContent('<p><br></p>')
      ue.focus?.()
      return { ok: true }
    })
    if (!clearRes.ok) throw new Error(`[Step 3] UEditor 不可用: ${clearRes.reason}`)
    this.log.info('[Step 3] UEditor 已清空')
    await randomDelay(500, 800)

    const editorFrame = await this._getEditorFrame()

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]
      if (block.type === 'text') {
        const text = (block.value || '').trim()
        if (!text) continue
        const html = this._textToParagraphs(text)

        const r = await this.page.evaluate((h) => {
          const ue = window.UE_V2?.instants?.['ueditorInstant0'] || Object.values(window.UE_V2?.instants || {})[0]
          if (!ue?.execCommand) return { ok: false }
          ue.focus?.()
          ue.execCommand('insertHtml', h)
          return { ok: true }
        }, html)
        if (!r.ok) throw new Error(`[Step 3] UEditor.execCommand 失败`)
        await randomDelay(250, 450)
        this.log.info(`  文字块 ${i + 1} 已输入 (${text.length} 字)`)
      } else if (block.type === 'image') {
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

        // 图片仍然走 iframe ClipboardEvent paste（实测 UEditor 图片 handler 工作）
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
      }
    }

    // 严格回读
    // 去掉 <<<xxx>>> 标记后计算期望纯文字长度
    const stripMarkers = (s) => (s || '').replace(/<<<(?:bq|ul|ol|hr)>>>/g, '').replace(/[【】]/g, '')
    const expected = contentBlocks.filter(b => b.type === 'text').reduce((s, b) => s + stripMarkers(b.value).replace(/\s+/g, '').length, 0)
    const stat = await this.page.evaluate(() => {
      const ue = window.UE_V2?.instants?.['ueditorInstant0'] || Object.values(window.UE_V2?.instants || {})[0]
      return {
        textLen: (ue?.getContentTxt?.() || '').replace(/\s+/g, '').length,
        htmlLen: (ue?.getContent?.() || '').length,
      }
    })
    this.log.info(`[Step 3] 回读: 纯文字 ${stat.textLen} 字 / 期望 ${expected} 字（HTML ${stat.htmlLen} 字符）`)
    if (stat.textLen < expected * 0.5) {
      throw new Error(`[Step 3] 正文严重不足: 实际 ${stat.textLen} 字 < 期望 ${expected} 字 × 50%`)
    }
    this.log.info('[Step 3] contentBlocks 正文输入完成')
  }

  /** 把 formatContentForRichEditor 格式化后的文本转成富 HTML（供 UEditor setContent/insertHtml）
   *  标记协议：<<<bq>>>引用 / <<<ul>>>列表项 / <<<ol>>>有序列表项 / <<<hr>>>水平线 / 【标题】/ 【加粗】
   */
  _textToParagraphs(text) {
    const escape = (s) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

    const inlineBold = (line) => {
      return escape(line).replace(/【(.+?)】/g, '<strong>$1</strong>')
    }

    const lines = (text || '').split(/\n/)
    if (lines.length === 0) return '<p><br></p>'

    const out = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i].trim()
      if (!line) { i++; continue }

      // 水平线
      if (line === '<<<hr>>>') { out.push('<hr>'); i++; continue }

      // 引用块（合并连续 <<<bq>>> 行）
      if (line.startsWith('<<<bq>>>')) {
        const qLines = []
        while (i < lines.length && lines[i].trim().startsWith('<<<bq>>>')) {
          qLines.push(lines[i].trim().slice(8))
          i++
        }
        out.push(`<blockquote><p>${inlineBold(qLines.join(' '))}</p></blockquote>`)
        continue
      }

      // 无序列表（合并连续 <<<ul>>> 行）
      if (line.startsWith('<<<ul>>>')) {
        const items = []
        while (i < lines.length && lines[i].trim().startsWith('<<<ul>>>')) {
          items.push(lines[i].trim().slice(8))
          i++
        }
        out.push('<ul>' + items.map(x => `<li>${inlineBold(x)}</li>`).join('') + '</ul>')
        continue
      }

      // 有序列表（合并连续 <<<ol>>> 行）
      if (line.startsWith('<<<ol>>>')) {
        const items = []
        while (i < lines.length && lines[i].trim().startsWith('<<<ol>>>')) {
          items.push(lines[i].trim().slice(8))
          i++
        }
        out.push('<ol>' + items.map(x => `<li>${inlineBold(x)}</li>`).join('') + '</ol>')
        continue
      }

      // 整行 【标题】 → <h2>
      const headingMatch = line.match(/^【(.+)】$/)
      if (headingMatch) { out.push(`<h2>${escape(headingMatch[1])}</h2>`); i++; continue }

      // 普通段落
      out.push(`<p>${inlineBold(line)}</p>`)
      i++
    }
    return out.join('')
  }

  // ─── Step 4: 封面配置（2026-04-18 重写） ────────────────────────
  //
  // 关键 DOM（实测 probe-bj-cover.json）：
  //   #bjhNewsCover                               ← 稳定容器 ID
  //     [class*="_93c3fe2a3121c388-list"]         ← 封面 list（class 后缀是 "undefined" 而非 one/three，旧 selector 错了）
  //       [class*="_93c3fe2a3121c388-item"] (xN)  ← 每个封面槽
  //         img._73a3a52aab7e3a36-coverImg        ← 已有封面的 img
  //         button "编辑"/"更换"                   ← 已有封面时直接可见的替换按钮（无需 hover）
  //         空槽文本叶子 "选择封面"                ← 空槽时的触发点
  //
  // 百家号会**自动预填**草稿里上次上传过的封面 → 必须强制替换，否则会用旧图（手机截图）
  async step4_configCover(post) {
    const coverType = post.coverType || 'single'
    if (coverType === 'none') {
      this.log.info('[Step 4] 无封面模式，跳过')
      return
    }

    this.log.info(`[Step 4] 配置封面（${coverType}）`)

    // 1) 滚动到封面区
    await this.page.evaluate(() => {
      document.getElementById('bjhNewsCover')?.scrollIntoView({ block: 'center' })
    }).catch(() => {})
    await randomDelay(400, 700)

    // 2) 选择封面类型 radio（点 label 更稳）
    const radioValue = coverType === 'triple' ? 'three' : 'one'
    await this.page.evaluate((val) => {
      const scope = document.getElementById('bjhNewsCover')
      if (!scope) return
      const radios = scope.querySelectorAll('input[type="radio"]')
      for (const r of radios) {
        if (r.value === val && !r.checked) {
          const label = r.closest('label') || r
          label.click()
          return
        }
      }
    }, radioValue)
    this.log.info(`[Step 4] 封面类型已选择: ${coverType}`)
    await randomDelay(800, 1200)

    // 3) 等待 list DOM 渲染
    await this.page.waitForFunction(() => {
      const scope = document.getElementById('bjhNewsCover')
      if (!scope) return false
      return !!scope.querySelector('[class*="-list"] [class*="-item"]')
    }, { timeout: 8000 }).catch(() => {
      this.log.warn('[Step 4] 等待封面 list 超时，继续尝试')
    })

    // 4) 诊断当前封面状态
    const diag = await this.page.evaluate(() => {
      const scope = document.getElementById('bjhNewsCover')
      const list = scope?.querySelector('[class*="-list"]')
      const items = list?.querySelectorAll('[class*="-item"]') || []
      return {
        scopeExists: !!scope,
        listClass: list ? String(list.className).slice(0, 100) : '(null)',
        itemCount: items.length,
        firstItemHasImg: items[0] ? !!items[0].querySelector('[class*="coverImg"], img') : false,
        firstItemImgSrc: items[0]?.querySelector('img')?.src?.slice(0, 120) || '',
      }
    })
    this.log.info(`[Step 4] 诊断: ${JSON.stringify(diag)}`)

    // 2026-04-18：关键判断 — Step 3 后百家号会自动取正文首图做封面
    //   当 firstItemHasImg=true 且 src 是百家号 picproxy URL（本次会话新上传的正文图），直接采用
    //   这样避免走 fileChooser 路径（page 级 ws 模式下无法触发 native file dialog）
    if (coverType === 'single' && diag.firstItemHasImg && diag.firstItemImgSrc) {
      // 判断是否是本次会话的正文首图（URL 通常含 picproxy）
      if (/picproxy|bdimg|baidu/.test(diag.firstItemImgSrc)) {
        this.log.info(`[Step 4] ✅ 采用百家号自动填充的正文首图作为封面（来源: ${diag.firstItemImgSrc.slice(-60)}）`)
        await this.conditionalScreenshot('baijiahao_step4_autoCover', 'step')
        return
      }
    }

    const requiredCount = coverType === 'triple' ? 3 : 1
    const imagePaths = (post.images || []).slice(0, requiredCount)

    for (let i = 0; i < imagePaths.length; i++) {
      const imgPath = imagePaths[i]
      if (!fs.existsSync(imgPath)) {
        this.log.warn(`  封面图文件不存在: ${imgPath}，跳过`)
        continue
      }

      // 4.1) 定位触发元素 — 优先 cursor:pointer 的祖先容器，兜底用 item 中心坐标
      //   有封面 → 点"更换"button
      //   空槽 → 点 item 整个槽（React 在 item 上挂 onClick，且子元素的 click 会冒泡）
      const targetRect = await this.page.evaluate((index) => {
        const scope = document.getElementById('bjhNewsCover')
        const list = scope?.querySelector('[class*="-list"]')
        const items = list?.querySelectorAll('[class*="-item"]')
        const item = items?.[index]
        if (!item) return null

        const hasCover = !!item.querySelector('[class*="coverImg"], img')
        let target = null

        if (hasCover) {
          // 优先"更换"
          const btns = Array.from(item.querySelectorAll('button'))
          target = btns.find(b => (b.textContent || '').trim() === '更换')
          if (!target) {
            target = btns.find(b => {
              const t = (b.textContent || '').trim()
              return t && !/编辑|删除|确定|取消|移除/.test(t)
            })
          }
        } else {
          // 空槽 — 从"选择封面"文字叶子向上找 cursor:pointer 的祖先
          const leaves = Array.from(item.querySelectorAll('*')).filter(el => el.children.length === 0)
          const textLeaf = leaves.find(el => (el.textContent || '').trim() === '选择封面')
          if (textLeaf) {
            let anc = textLeaf
            for (let k = 0; k < 8 && anc; k++) {
              const cs = window.getComputedStyle(anc)
              if (cs.cursor === 'pointer') { target = anc; break }
              if (anc === item) break
              anc = anc.parentElement
            }
            // 兜底：用 item 本身作为 click target
            if (!target) target = item
          } else {
            target = item
          }
        }
        if (!target) return { found: false }
        target.scrollIntoView({ block: 'center' })
        const r = target.getBoundingClientRect()
        return {
          found: true,
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          tag: target.tagName,
          text: (target.textContent || '').trim().slice(0, 20),
          className: String(target.className || '').slice(0, 80),
          hasCover,
        }
      }, i)

      if (!targetRect?.found || !(targetRect.x > 0 && targetRect.y > 0)) {
        this.log.warn(`  封面 ${i + 1} 未找到触发按钮，跳过: ${JSON.stringify(targetRect)}`)
        continue
      }
      this.log.info(`  封面 ${i + 1} 触发按钮: ${targetRect.tag} "${targetRect.text}" (hasCover=${targetRect.hasCover})`)

      // 4.2) 百家号封面上传流程（经 Playwright 实测确认）：
      //   点击"选择封面"槽 → 弹出 cheetah-modal (tabsModal)
      //     → Tab "正文/本地上传" 含 cheetah-upload 组件，内有隐藏 <input type="file">
      //     → 上传后右侧出现 3:2 预览
      //     → 点击底部 "确定" 按钮完成封面设置

      let uploaded = false

      // Step A：点击封面槽，等待 cheetah-modal 弹出
      await this.page.mouse.move(targetRect.x, targetRect.y, { steps: 10 })
      await randomDelay(200, 350)
      await this.page.mouse.click(targetRect.x, targetRect.y, { delay: 80 })
      this.log.info(`  封面 ${i + 1} 已点击封面槽，等待弹窗...`)

      // 等待 tabsModal 出现（最多 5s）
      let modalFound = false
      const modalWaitStart = Date.now()
      while (Date.now() - modalWaitStart < 5000) {
        modalFound = await this.page.evaluate(() => {
          const m = document.querySelector('.cheetah-modal-body')
          return !!(m && m.offsetParent !== null && m.getBoundingClientRect().width > 200)
        }).catch(() => false)
        if (modalFound) break
        await new Promise(r => setTimeout(r, 300))
      }
      if (!modalFound) {
        this.log.warn(`  封面 ${i + 1} 弹窗未出现，尝试 waitForFileChooser 兜底`)
        // 兜底：也许点击直接触发了 file dialog（某些版本可能如此）
        try {
          const fileChooserPromise = this.page.waitForFileChooser({ timeout: 3000 })
          await this.page.mouse.click(targetRect.x, targetRect.y, { delay: 80 })
          const fc = await fileChooserPromise
          await fc.accept([imgPath])
          this.log.info(`  封面 ${i + 1} 上传（兜底 waitForFileChooser）: ${path.basename(imgPath)}`)
          uploaded = true
        } catch (e) {
          this.log.warn(`  封面 ${i + 1} 兜底 waitForFileChooser 也失败: ${e.message?.slice(0, 80)}`)
        }
        if (!uploaded) continue
      }

      // Step B：在 cheetah-modal 内找 cheetah-upload 里的隐藏 <input type="file">
      if (!uploaded && modalFound) {
        await randomDelay(500, 800)
        // 策略 1（最稳）：直接 uploadFile 到 modal 内的 file input
        const fileInputSelector = '.cheetah-modal-body input[type="file"], .cheetah-modal input[type="file"]'
        const fileInputs = await this.page.$$(fileInputSelector)
        this.log.info(`  封面 ${i + 1} 弹窗内 file input: ${fileInputs.length} 个`)

        if (fileInputs.length > 0) {
          try {
            // 用最后一个（最可能是当前活跃 tab 的 upload 组件）
            await fileInputs[fileInputs.length - 1].uploadFile(imgPath)
            this.log.info(`  封面 ${i + 1} 上传（uploadFile→modal input）: ${path.basename(imgPath)}`)
            uploaded = true
          } catch (e) {
            this.log.warn(`  封面 ${i + 1} uploadFile 到 modal input 失败: ${e.message?.slice(0, 80)}`)
          }
        }

        // 策略 2：点击"点击本地上传"区域 + waitForFileChooser
        if (!uploaded) {
          const uploadAreaInfo = await this.page.evaluate(() => {
            const modal = document.querySelector('.cheetah-modal-body')
            if (!modal) return null
            // 找"点击本地上传"文本
            const els = Array.from(modal.querySelectorAll('*'))
            for (const el of els) {
              const txt = (el.textContent || '').trim()
              if (/^点击本地上传$/.test(txt) && el.children.length === 0 && el.offsetParent !== null) {
                const r = el.getBoundingClientRect()
                return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: txt }
              }
            }
            // 找 cheetah-upload 区域
            const upload = modal.querySelector('.cheetah-upload, [class*="upload"]')
            if (upload && upload.offsetParent !== null) {
              const r = upload.getBoundingClientRect()
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: 'upload-area' }
            }
            return null
          })
          if (uploadAreaInfo) {
            this.log.info(`  封面 ${i + 1} 策略2: 点击 "${uploadAreaInfo.text}" + waitForFileChooser`)
            try {
              const [fc] = await Promise.all([
                this.page.waitForFileChooser({ timeout: 5000 }),
                (async () => {
                  await randomDelay(200, 400)
                  await this.page.mouse.click(uploadAreaInfo.x, uploadAreaInfo.y, { delay: 80 })
                })()
              ])
              await fc.accept([imgPath])
              this.log.info(`  封面 ${i + 1} 上传（策略2 waitForFileChooser）: ${path.basename(imgPath)}`)
              uploaded = true
            } catch (e) {
              this.log.warn(`  封面 ${i + 1} 策略2 失败: ${e.message?.slice(0, 80)}`)
            }
          }
        }
      }

      if (!uploaded) {
        this.log.warn(`  封面 ${i + 1} 所有上传策略失败，关闭弹窗`)
        await this.page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('.cheetah-modal button, .cheetah-modal-close'))
            .find(b => /^(取消|关闭)$/.test((b.textContent || '').trim()) || b.className?.includes('close'))
          if (btn) btn.click()
        }).catch(() => {})
        await randomDelay(1000, 1500)
        continue
      }

      // 4.3) 上传成功后，在弹窗内等待图片预览加载，然后点击"确定"
      await randomDelay(2000, 3000)
      let confirmed = false
      const confirmStart = Date.now()
      while (Date.now() - confirmStart < 12000) {
        const result = await this.page.evaluate(() => {
          // 在 cheetah-modal 内找"确定"按钮（cheetah-btn-primary）
          const modal = document.querySelector('.cheetah-modal-body') || document.querySelector('.cheetah-modal')
          if (!modal) return { status: 'no-modal' }
          // 找主要按钮
          const btns = Array.from(modal.querySelectorAll('button'))
          const confirmBtn = btns.find(b => {
            const txt = (b.textContent || '').trim()
            return /^(确定|确认|完成|保存)(\s*\(\d+\))?$/.test(txt) && !b.disabled
          })
          if (confirmBtn) {
            confirmBtn.scrollIntoView({ block: 'center' })
            confirmBtn.click()
            return { status: 'confirmed', text: (confirmBtn.textContent || '').trim() }
          }
          // 检查是否弹窗已消失（可能自动确认了）
          if (!modal.offsetParent) return { status: 'modal-gone' }
          return { status: 'waiting', btnTexts: btns.map(b => (b.textContent || '').trim()).filter(Boolean) }
        }).catch(() => ({ status: 'error' }))

        if (result.status === 'confirmed') {
          this.log.info(`  封面 ${i + 1} 弹窗已确认: "${result.text}"`)
          confirmed = true
          break
        }
        if (result.status === 'modal-gone' || result.status === 'no-modal') {
          this.log.info(`  封面 ${i + 1} 弹窗已自动关闭`)
          confirmed = true
          break
        }
        if (result.status === 'waiting') {
          this.log.info(`  封面 ${i + 1} 等待确认按钮... 当前按钮: ${JSON.stringify(result.btnTexts)}`)
        }
        await new Promise(r => setTimeout(r, 1000))
      }
      if (!confirmed) {
        this.log.warn(`  封面 ${i + 1} 确认按钮未找到（12s 超时），尝试强制点击`)
        // 兜底：用 page.click 点击 primary 按钮
        try {
          await this.page.click('.cheetah-modal .cheetah-btn-primary', { delay: 50 })
          this.log.info(`  封面 ${i + 1} 强制点击 cheetah-btn-primary`)
        } catch (e) {
          this.log.warn(`  封面 ${i + 1} 强制点击失败: ${e.message?.slice(0, 80)}`)
        }
      }
      await randomDelay(2000, 3000)
    }

    // 5) 严格回读：封面 img src 必须是百家号上传后的 picproxy URL，且文件名带上传时间戳
    const verify = await this.page.evaluate(() => {
      const scope = document.getElementById('bjhNewsCover')
      const imgs = Array.from(scope?.querySelectorAll('img') || [])
      return imgs.map(i => ({ src: (i.src || '').slice(0, 200), w: i.naturalWidth, h: i.naturalHeight }))
    })
    this.log.info(`[Step 4] 回读: ${verify.length} 张封面图`)
    verify.forEach((v, idx) => this.log.info(`  [${idx}] ${v.w}x${v.h} src=${v.src.slice(-80)}`))
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

    // 2026-04-18：
    //   旧代码 clickByText('button', '发布')，但页面有 3 个"发布"元素（div/button/span），
    //   容易误点。改用实测稳定的 [data-testid="publish-btn"]。
    //   关键：必须用 page.click（模拟真实 pointerdown/mouseup/click），
    //   不能用 evaluate btn.click()（百家号用 React 合成事件，btn.click 只触发 click 不触发 pointerdown → 不响应）
    this.log.info('[Step 6] 点击发布按钮 (data-testid="publish-btn")')
    const btnExists = await this.page.evaluate((sel) => {
      const btn = document.querySelector(sel)
      if (!btn) return 'not-found'
      if (btn.disabled) return 'disabled'
      btn.scrollIntoView({ block: 'center' })
      return 'ok'
    }, S.publishButton)
    if (btnExists === 'disabled') {
      throw new Error('[Step 6] 发布按钮被禁用（可能缺少必填项）')
    }

    // 2026-04-18：在 page 内注入 XHR/fetch hook 捕获 publish API 响应
    // 原因：zenoclaw 用 page 级 WebSocket 降级连接，puppeteer 事件路由 (on 'response'、CDP Network) 都失效
    // 直接在页面 JS 层 hook，用 window.__zenoPublishRes 回传结果
    await this.page.evaluate(() => {
      if (window.__zenoHookInstalled) return
      window.__zenoHookInstalled = true
      window.__zenoPublishRes = null
      window.__zenoPostLog = [] // 记录所有 POST 请求，用于诊断

      // 匹配 publish 相关 URL（兼容多种路径变体）
      const isPublishUrl = (url) => /publish|submit|save.*article|article.*save|pcui.*article/i.test(url)

      // Hook XMLHttpRequest
      const XhrOpen = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__zenoUrl = url
        this.__zenoMethod = method
        return XhrOpen.apply(this, arguments)
      }
      const XhrSend = XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.send = function() {
        if (this.__zenoMethod === 'POST') {
          this.addEventListener('loadend', () => {
            const entry = { via: 'xhr', method: 'POST', status: this.status, url: this.__zenoUrl, ts: Date.now() }
            window.__zenoPostLog.push(entry)
            if (window.__zenoPostLog.length > 20) window.__zenoPostLog.shift()
            if (this.__zenoUrl && isPublishUrl(this.__zenoUrl)) {
              window.__zenoPublishRes = {
                ...entry,
                body: (this.responseText || '').slice(0, 2000),
              }
            }
          })
        }
        return XhrSend.apply(this, arguments)
      }

      // Hook fetch
      const origFetch = window.fetch
      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input?.url || '')
        const method = init?.method || 'GET'
        const res = await origFetch.apply(this, arguments)
        if (method.toUpperCase() === 'POST') {
          const entry = { via: 'fetch', method: 'POST', status: res.status, url, ts: Date.now() }
          window.__zenoPostLog.push(entry)
          if (window.__zenoPostLog.length > 20) window.__zenoPostLog.shift()
          if (isPublishUrl(url)) {
            try {
              const text = await res.clone().text()
              window.__zenoPublishRes = { ...entry, body: text.slice(0, 2000) }
            } catch {}
          }
        }
        return res
      }
    })
    // 重置上一次的结果
    await this.page.evaluate(() => { window.__zenoPublishRes = null }).catch(() => {})

    if (btnExists !== 'ok') {
      this.log.warn('[Step 6] publish-btn testid 未找到，回退到文本点击')
      await this.clickByText('button', S.publishButtonText)
    } else {
      await randomDelay(200, 400)
      await this.page.click(S.publishButton, { delay: 50 })
      this.log.info('[Step 6] 发布按钮已点击（page.click）')
    }

    // 二次确认弹窗（并行）
    const confirmResult = await this._handleConfirmModal(5000)
    this.log.info(`[Step 6] 二次确认弹窗处理: ${confirmResult.action} (${confirmResult.text || '-'})`)

    // 轮询等待 page hook 回传结果（最多 15s）
    const waitStart = Date.now()
    let publishResponseRaw = null
    while (!publishResponseRaw && Date.now() - waitStart < 15000) {
      publishResponseRaw = await this.page.evaluate(() => window.__zenoPublishRes).catch(() => null)
      if (publishResponseRaw) break
      await new Promise(r => setTimeout(r, 300))
    }

    let publishApiResult = null
    if (publishResponseRaw?.body) {
      try {
        let body = publishResponseRaw.body
        const m = body.match(/\{[\s\S]*\}/)
        if (m) body = m[0]
        const json = JSON.parse(body)
        publishApiResult = { status: publishResponseRaw.status, errno: json.errno, errmsg: json.errmsg, data: json.data }
        this.log.info(`[Step 6] 📡 publish API 响应 (${publishResponseRaw.via}): errno=${json.errno} errmsg="${json.errmsg || '-'}"`)
      } catch (e) {
        publishApiResult = { parseError: e.message, rawBody: publishResponseRaw.body?.slice(0, 200) }
        this.log.warn(`[Step 6] ⚠️ 解析 publish API 响应失败: ${e.message} body=${publishResponseRaw.body?.slice(0, 200)}`)
      }
    } else {
      this.log.warn('[Step 6] ⚠️ 未捕获到 publish API 响应（15s 轮询超时）')
      // 诊断：输出所有捕获的 POST 请求
      const postLog = await this.page.evaluate(() => window.__zenoPostLog || []).catch(() => [])
      if (postLog.length > 0) {
        this.log.info(`[Step 6] 📋 POST 请求日志 (${postLog.length} 条):`)
        for (const entry of postLog.slice(-10)) {
          this.log.info(`  ${entry.via} ${entry.status} ${String(entry.url || '').slice(0, 120)}`)
        }
      } else {
        this.log.warn('[Step 6] 📋 未捕获到任何 POST 请求（发布按钮点击可能被前端拦截）')
      }
      // 兜底：扫描页面 toast 错误信息（百家号风控会弹 "系统繁忙，请稍后重试"）
      const toastErr = await this.page.evaluate(() => {
        const toasts = Array.from(document.querySelectorAll('[class*="toast"], [class*="Toast"], [class*="message"], [role="alert"], [class*="notification"]'))
          .filter(el => el.offsetParent !== null)
          .map(el => (el.textContent || '').trim())
          .filter(t => t.length > 2 && t.length < 200)
        return toasts
      }).catch(() => [])
      const errToast = toastErr.find(t => /系统繁忙|请稍后重试|发布失败|审核未通过|异常|验证|频繁|请上传封面|请选择封面|封面不能为空|请添加封面/.test(t))
      if (errToast) {
        throw new Error(`[Step 6] 百家号返回错误 toast: "${errToast}"（通常为账号风控或网络验证）`)
      }
    }

    // API 响应优先判定：errno === 0 → 成功；errno != 0 → 精准报错
    if (publishApiResult) {
      if (publishApiResult.errno === 0) {
        this.log.info('[Step 6] ✅ 发布 API 返回 errno=0 → 发布成功')
        return
      }
      if (publishApiResult.errno !== undefined && publishApiResult.errno !== null) {
        const hit = publishApiResult.data?.hit_rule ? `（${publishApiResult.data.hit_rule}）` : ''
        throw new Error(`[Step 6] 百家号发布被平台拒绝: errno=${publishApiResult.errno} ${publishApiResult.errmsg || ''}${hit}`)
      }
    }

    await randomDelay(1500, 3000)

    // 兜底：扫描页面状态（API 响应未捕获时的备用判断）
    // 2026-04-18：启用视觉模型兜底 — 当文本/URL 判定均为 unknown 时，截图让 AI 做最终判断
    const summary = await this.conservativeVerifyPublishResult({
      guardName: 'baijiahao_step6_publish',
      waitOptions: {
        successTexts: ['发布成功', '发表成功', '提交成功', '保存成功'],
        errorTexts: ['发布失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核'],
        timeout: 15000,
      },
      useVisionWhenUnknown: true,
    })

    if (summary.waitResult?.status === 'success') {
      this.log.info(`[Step 6] ✅ 发布成功（文本信号: ${summary.waitResult.evidence || '命中'}）`)
      return
    }

    // success 以外：再尝试通过 URL 跳转判定（成功后通常跳到 /content 或 /home）
    const currentUrl = this.page.url()
    if (/\/rc\/(content|home)/.test(currentUrl)) {
      this.log.info(`[Step 6] ✅ URL 已跳转到 ${currentUrl}，判定发布成功`)
      return
    }

    // 最后兜底：扫描整页是否已经出现成功文案
    const pageHasSuccess = await this.page.evaluate(() => {
      const t = document.body.innerText || ''
      return /发布成功|发表成功|提交成功|已发布|审核中/.test(t)
    }).catch(() => false)
    if (pageHasSuccess) {
      this.log.info('[Step 6] ✅ 页面文本含成功标志，判定发布成功')
      return
    }

    // 2026-04-18：视觉模型返回 success 也接受（在 conservativeVerifyPublishResult 启用视觉后）
    if (summary.visionResult?.status === 'success') {
      this.log.info(`[Step 6] ✅ 视觉模型确认发布成功: ${summary.visionResult.details}`)
      return
    }
    // 视觉模型检测到需要确认弹窗且已自动点击
    if (summary.visionResult?.status === 'need_confirm' && summary.visionResult?.popupHandled) {
      this.log.info('[Step 6] 视觉模型检测到确认弹窗并已点击，再次检查...')
      await randomDelay(2000, 4000)
      const recheckUrl = this.page.url()
      if (/\/rc\/(content|home)/.test(recheckUrl)) {
        this.log.info(`[Step 6] ✅ 视觉二次点击后 URL 已跳转: ${recheckUrl}`)
        return
      }
      const recheckText = await this.page.evaluate(() => {
        const t = document.body.innerText || ''
        return /发布成功|发表成功|提交成功|已发布|审核中/.test(t)
      }).catch(() => false)
      if (recheckText) {
        this.log.info('[Step 6] ✅ 视觉二次点击后页面文本确认成功')
        return
      }
    }

    // 全部判定失败
    throw new Error(
      `[Step 6] 发布结果无法确认（waitResult=${summary.waitResult?.status || 'unknown'}，vision=${summary.visionResult?.status || 'none'}，URL=${currentUrl}，confirm=${confirmResult.action}）。` +
      `检查网络/二次确认流程`
    )
  }

  /**
   * 2026-04-18：处理百家号发布后的二次确认弹窗
   * 轮询 timeoutMs 内若出现弹窗 + 确认按钮则点击
   * @returns { action: 'clicked' | 'none' | 'error', text?: string }
   */
  async _handleConfirmModal(timeoutMs = 8000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const result = await this.page.evaluate(({ modalSel, btnTexts }) => {
        const modals = Array.from(document.querySelectorAll(modalSel))
          .filter(m => {
            const r = m.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && m.offsetParent !== null
          })
        for (const modal of modals) {
          const btns = Array.from(modal.querySelectorAll('button'))
          for (const btn of btns) {
            const t = (btn.textContent || '').trim()
            if (btnTexts.includes(t) && !btn.disabled) {
              btn.scrollIntoView({ block: 'center' })
              btn.click()
              return { action: 'clicked', text: t }
            }
          }
        }
        return null
      }, { modalSel: S.confirmModal, btnTexts: S.confirmButtonTexts })
      if (result?.action === 'clicked') return result
      await randomDelay(500, 800)
    }
    return { action: 'none' }
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

  // ─── 发布后：抓真实文章 URL ───────────────────────────────────────────
  /**
   * 2026-04-26 新增：百家号作品列表抓真实文章 URL
   *
   * 列表入口（按优先级）:
   *   1) https://baijiahao.baidu.com/builder/rc/content/manage  - 内容管理（旧）
   *   2) https://baijiahao.baidu.com/builder/rc/content         - 新版内容管理
   *   3) https://baijiahao.baidu.com/builder/app/posts          - 部分账号作品列表
   *
   * 真实文章 URL pattern:
   *   https://baijiahao.baidu.com/s?id={article_id}
   *   或
   *   https://mbd.baidu.com/newspage/data/landingsuper?context={...}
   *
   * 列表项里的链接 selector:
   *   a[href*="baijiahao.baidu.com/s?id="]
   *   a[href*="mbd.baidu.com/newspage"]
   *
   * 匹配策略与头条一致：先按 title 严格匹配，再 fallback 取列表首条。
   */
  async captureRealPostUrl(post) {
    const title = (post && post.title) || ''
    this.log.info(`[captureRealPostUrl] 开始抓取百家号真实文章 URL（标题: ${title.slice(0, 24)}...）`)

    const LIST_URLS = [
      'https://baijiahao.baidu.com/builder/rc/content/manage',
      'https://baijiahao.baidu.com/builder/rc/content',
      'https://baijiahao.baidu.com/builder/app/posts',
    ]
    let curUrl = ''
    try { curUrl = this.page.url() } catch { /* page closed */ }
    const onListPage = /\/builder\/(rc\/content|app\/posts)/.test(curUrl)
    if (!onListPage) {
      this.log.info(`[captureRealPostUrl] 当前不在列表页 (${curUrl.slice(0, 60)})，跳转到 ${LIST_URLS[0]}`)
      try {
        await this.navigateTo(LIST_URLS[0])
        await randomDelay(2500, 4500)
      } catch (e) {
        this.log.warn(`[captureRealPostUrl] 跳转作品列表失败: ${e.message}`)
        return null
      }
    } else {
      await randomDelay(1500, 3000)
    }

    const captured = await this.page.evaluate((wantTitle) => {
      const HREF_PATTERNS = [
        /baijiahao\.baidu\.com\/s\?id=/,
        /mbd\.baidu\.com\/newspage\/data\/landingsuper/,
        /\/\/baijiahao\.baidu\.com\/u\?app_id=/,
      ]
      const allLinks = Array.from(document.querySelectorAll('a[href]'))
      const candidates = allLinks.filter(a => {
        const h = a.href || ''
        return HREF_PATTERNS.some(re => re.test(h))
      })
      if (candidates.length === 0) return { ok: false, reason: 'no-article-links' }

      if (wantTitle) {
        const titleNorm = wantTitle.replace(/\s+/g, '').slice(0, 18)
        for (const a of candidates) {
          let n = a
          for (let i = 0; i < 5 && n; i++) {
            const txt = (n.innerText || n.textContent || '').replace(/\s+/g, '')
            if (txt && txt.includes(titleNorm)) {
              return { ok: true, url: a.href, matched: 'title', title: txt.slice(0, 60) }
            }
            n = n.parentElement
          }
        }
      }
      return { ok: true, url: candidates[0].href, matched: 'first', title: (candidates[0].innerText || '').slice(0, 60) }
    }, title)

    if (!captured?.ok) {
      this.log.warn(`[captureRealPostUrl] DOM 中未找到文章链接 (${captured?.reason || 'unknown'})`)
      return null
    }
    this._capturedPublishedUrl = captured.url
    this.log.info(`[captureRealPostUrl] ✅ 抓到真实 URL（${captured.matched}）: ${captured.url}`)
    return captured.url
  }
}
