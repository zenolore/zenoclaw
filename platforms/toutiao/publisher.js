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

  /**
   * 多入口策略：每次进文章发布页换一种方式（按 persona 偏好 + 历史去重）
   *
   * ⚠️ 头条 selectors.CREATOR_ENTRY_SELECTORS.isPlaceholder=true：
   *    具体发布入口在侧栏「创作」分组的二级菜单里，需要 hover/click 后展开才能拿到。
   *    当前 dashboard 模式仅做"先到 profile_v4/index 后台 + hover 创作分组"，模拟人浏览侧栏，
   *    再通过 directUrl 切到发布页，仍能给真人化加分；二级菜单具体 selector 待后续 probe 校准。
   *
   * 候选：
   *   - dashboard:  goto profile_v4/index 后台 → hover 侧栏「创作」分组 → goto publish url
   *   - directUrl:  直接 goto profile_v4/graphic/publish（兜底）
   */
  getCreatorEntryStrategies() {
    const ENTRY = CREATOR_ENTRY_SELECTORS
    const editUrl = this.publishUrl
    const dashboardUrl = ENTRY.creatorHomeUrl

    return [
      {
        key: 'dashboard',
        label: 'profile 后台 → hover 侧栏「创作」 → 发布页',
        weight: 2,
        run: async (adapter) => {
          await adapter.navigateTo(dashboardUrl)
          await randomDelay(2500, 4000)
          // 仅 hover 一下「创作」分组，模拟人浏览侧栏（不依赖能展开二级菜单）
          let hovered = false
          for (const sel of ENTRY.sideMenuCreatorGroup) {
            try {
              const el = await adapter.page.$(sel)
              if (el) {
                await el.hover()
                hovered = true
                break
              }
            } catch { /* next */ }
          }
          if (hovered) {
            await randomDelay(900, 2200)
          } else {
            adapter.log?.warn?.('[entry/dashboard] 头条侧栏「创作」分组 hover 未命中，跳过 hover 步骤')
          }
          // 直接 goto 发布页（保留 SPA 路由真实性）
          await adapter.navigateTo(editUrl)
          await randomDelay(1500, 3000)
        }
      },
      {
        key: 'directUrl',
        label: '直接 URL 进入发布页',
        weight: 2,
        run: async (adapter) => {
          await adapter.navigateTo(editUrl)
          await randomDelay(800, 1800)
        }
      }
    ]
  }

  async publish(post) {
    this.log.info('========== 头条发布开始 ==========')

    if (isVideoPublishPost(post)) {
      try {
        return await runVideoPublishDryRun(this, this.platformName, post)
      } catch (err) {
        this.log.error(`头条视频 dryRun 失败: ${err.message}`)
        return { ...this.buildResult(false, err), contentType: 'video', dryRun: true }
      }
    }

    try {
      const normalizedPost = this.normalizePostForPublish(post)
      this.log.info(`标题: ${normalizedPost.title}`)
      this._dryRun = !!normalizedPost.dryRun
      if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击发布按钮')
      // 设置任务标签和步骤
      this._overlayTaskLabel = '头条号 · 文章发布任务执行中'
      const hasCover = normalizedPost.coverType || (normalizedPost.images && normalizedPost.images.length > 0)
      const steps = ['预热浏览', '打开发布页面', '输入标题']
      if (hasCover) steps.push('上传封面图')
      steps.push('输入正文', '配置发布选项', '模拟人工通读检查', '发布文章')
      const T = steps.length
      let S = 0

      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开发布页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在通过多入口策略打开发布页面', { next: '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())

      S++
      await this.showStatus('正在模拟人工输入标题', { next: hasCover ? '上传封面图' : '输入正文', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step2_inputTitle(normalizedPost.title))

      // 2026-04-17: 头条会自动把正文首图作为单图封面，这会污染三图模式
      // 所以先上传封面（step4），再插入正文（step3）
      if (hasCover) {
        S++
        await this.showStatus('正在上传并配置封面图', { next: '输入正文', step: S, total: T }).catch(() => {})
        await this.runStep('configCover', () => this.step4_configCover(normalizedPost))
      }

      S++
      await this.showStatus('正在模拟人工输入正文内容', { next: '配置发布选项', step: S, total: T }).catch(() => {})
      if (normalizedPost.contentBlocks?.length) {
        await this.runStep('inputContent', () => this.step3_inputContentBlocks(normalizedPost.contentBlocks))
      } else {
        await this.runStep('inputContent', () => this.step3_inputContent(normalizedPost.content))
      }

      S++
      await this.showStatus('正在配置发布选项参数', { next: '通读检查', step: S, total: T }).catch(() => {})
      await this.runStep('configOptions', () => this.step5_configOptions(normalizedPost))

      // 发布前全选项验证：回读页面实际状态
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

      // 2026-04-15 安全加固：仅在“未出现显式失败”时才继续走发布后浏览。
      // 原因：头条原逻辑点击后只等待 2-5 秒，若页面出现违规/失败提示，旧逻辑仍会继续伪装成功链路。
      // 当前策略：step6_publish 内已经接入 conservativeVerifyPublishResult()；若命中显式失败会直接抛错进入 catch。
      // 回退方式：删除 step6_publish() 里的 conservativeVerifyPublishResult() 调用，即可恢复旧行为。
      await this.fillRemainingTime()

      // 2026-04-26 新增：发布成功后、跳首页之前，抓真实文章页 URL
      //   step6 验证完成后 page 已落在「作品管理列表」（manage/content 或 content/graphic）
      //   从列表 DOM 拿到刚发布文章的真实 URL，写入 this._capturedPublishedUrl
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

      this.log.info('========== 头条发布完成 ==========')
      return this.buildResult(true, '头条发布成功')
    } catch (err) {
      this.log.error(`头条发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  // ─── Step 1: 打开发布页 ───────────────────────────────────────────────
  async step1_openPublishPage() {
    this.log.info('[Step 1] 打开头条文章发布页（多入口策略）')
    // 不再直接 goto；按 persona 偏好 + 历史去重选一种入口；全部失败时兜底 goto
    await this.navigateToPublishViaEntry()
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

    // 2026-04-18：强制聚焦编辑器，避免前面 step4 的弹窗导致 activeElement 漂移
    await el.click()
    await this.page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                     document.querySelector('.ProseMirror')
      if (editor) editor.focus()
    })
    await randomDelay(300, 700)

    // 2026-04-18 bugfix：Selection API 助手——把光标折叠到编辑器末尾
    // 修复前：el.click() 把光标点到编辑器中心（即某段已有文字内），
    //        下一次 paste File 会把选中/命中文字替换为图片，导致正文段落丢失。
    // 修复后：每个块粘贴前都显式 collapse 到末尾，保证 append 语义。
    const moveCaretToEnd = async () => {
      await this.page.evaluate(() => {
        const editor = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                       document.querySelector('.ProseMirror')
        if (!editor) return
        editor.focus()
        const range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false) // collapse-to-end
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      })
    }

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]

      if (block.type === 'text' && block.value) {
        // 粘贴前先把光标移到文档末尾，避免覆盖前面块
        await moveCaretToEnd()
        const blockHtml = this._textToRichHtml(block.value)
        const blockPlain = this._stripMarkers(block.value)

        // 记录粘贴前长度
        const lenBefore = await this.page.evaluate(() => {
          const editor = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                         document.querySelector('.ProseMirror')
          return (editor?.innerText || '').length
        })

        // 2026-04-20: 改用真实系统剪贴板 + Ctrl+V 粘贴，确保 ProseMirror 读取 text/html
        await this._pasteRichContent(blockHtml, blockPlain)
        await randomDelay(400, 800)

        // 验证文字真的进去了
        const lenAfter = await this.page.evaluate(() => {
          const editor = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                         document.querySelector('.ProseMirror')
          return (editor?.innerText || '').length
        })
        const expectAdd = Math.min(blockPlain.length, 20) // 至少应加入 20 字以上
        if (lenAfter - lenBefore < expectAdd) {
          // 降级：用键盘逐字输入（使用清理后的纯文本）
          this.log.warn(`  文字块 ${i + 1}: paste 未生效（长度 ${lenBefore} → ${lenAfter}），降级为逐字输入`)
          await this.humanTypeInElement(el, blockPlain)
          await randomDelay(300, 600)
        } else {
          this.log.info(`  文字块 ${i + 1}: ${blockPlain.slice(0, 30)}... (+${lenAfter - lenBefore}字)`)
        }

      } else if (block.type === 'image' && block.src) {
        if (!fs.existsSync(block.src)) {
          this.log.warn(`  图片不存在，跳过: ${block.src}`)
          continue
        }
        const fileName = path.basename(block.src)

        // 2026-04-18 精简方案：直接用 ClipboardEvent 粘贴 File 到编辑器
        // - 优点：可靠地把 <img> 插入到 ProseMirror 节点树（已验证）
        // - 局限：src 是 blob: URL（内存引用），头条会在保存/预览时自动上传到 CDN 并替换 src
        // - 设计：用户点"预览并发布"时，头条前端会处理 blob → CDN 的转换
        //         若头条不自动转换，则发布前验证会检测到非 CDN URL 并阻止假成功

        const buf = fs.readFileSync(block.src)
        const base64 = buf.toString('base64')
        const ext = path.extname(block.src).toLowerCase()
        const mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png'

        const imgCountBefore = await this.page.evaluate(
          () => document.querySelectorAll('div.ProseMirror img').length
        )

        // 2026-04-18 bugfix：不再用 el.click()（Puppeteer 会点击元素中心，
        //                    可能命中已输入段落并选中，导致 paste File 替换那段文字）
        //                    改用 Selection API 把光标折叠到编辑器末尾
        await moveCaretToEnd()
        await randomDelay(150, 300)

        // 派发 paste 事件（File 载荷）— selection 已在末尾，图片会 append
        await this.page.evaluate(async (b64, mime, name) => {
          const editor = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                         document.querySelector('.ProseMirror')
          if (!editor) throw new Error('无 ProseMirror 编辑器')
          editor.focus()
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
          const blob = new Blob([bytes], { type: mime })
          const file = new File([blob], name, { type: mime })
          const dt = new DataTransfer()
          dt.items.add(file)
          const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
          editor.dispatchEvent(ev)
        }, base64, mimeType, fileName)

        // 等待编辑器把 img 插入节点树
        const maxWaitMs = 10000
        const deadline = Date.now() + maxWaitMs
        let lastStatus = null
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 500))
          lastStatus = await this.page.evaluate((before) => {
            const imgs = document.querySelectorAll('div.ProseMirror img')
            if (imgs.length <= before) return { count: imgs.length, src: '' }
            const last = imgs[imgs.length - 1]
            return {
              count: imgs.length,
              src: (last.src || '').slice(0, 80),
              webUri: last.getAttribute('web_uri') || '',
              blob: (last.src || '').startsWith('blob:'),
            }
          }, imgCountBefore)
          if (lastStatus.count > imgCountBefore) break
        }

        if (!lastStatus || lastStatus.count <= imgCountBefore) {
          throw new Error(`图片粘贴失败: ${fileName} 未出现在编辑器节点树中 (img 数量 ${imgCountBefore} → ${lastStatus?.count || 0})`)
        }
        this.log.info(`  ✅ 图片块 ${i + 1} 已插入: ${fileName} | src=${lastStatus.src.slice(0, 50)} | web_uri=${lastStatus.webUri || '(暂空，发布时头条会转换)'}`)

        // 再等 2 秒让头条异步处理（可能后台 upload 把 blob 转 CDN）
        await new Promise(r => setTimeout(r, 2000))

        // 2026-04-18 bugfix：不再用 ArrowDown/End/Enter 移动光标——
        //                    下一个块开头会调 moveCaretToEnd 显式把光标折叠到末尾，
        //                    文档末尾新段落由 ProseMirror 自动维护。
        await randomDelay(300, 600)
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

    // 2026-04-20: 改用真实系统剪贴板 + Ctrl+V 粘贴
    // 原因：合成 ClipboardEvent 的 clipboardData 可能不被 ProseMirror 原生 paste handler 读取，
    //       导致降级到 text/plain（①②③/【】）而非 text/html（h2/ol/ul/blockquote/strong）
    const html = this._textToRichHtml(content)
    const plainText = this._stripMarkers(content)
    await this._pasteRichContent(html, plainText)

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
      await this.humanTypeInElement(el, plainText)
    }

    await randomDelay(800, 1500)
  }

  /** 把 formatContentForRichEditor 格式化后的文本转成富 HTML（供 ProseMirror text/html 粘贴）
   *  标记协议：<<<bq>>>引用 / <<<ul>>>列表项 / <<<ol>>>有序列表项 / <<<hr>>>水平线 / 【标题】/ 【加粗】
   */
  _textToRichHtml(text) {
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

  /** 通过真实系统剪贴板 + Ctrl+V 粘贴 HTML 到 ProseMirror
   *  比合成 ClipboardEvent 更可靠——ProseMirror 原生 paste handler 会正确读取 text/html，
   *  渲染 h2/strong/ol/ul/blockquote 等富文本格式。
   *  降级路径：若 execCommand('copy') 不可用，回退到合成 ClipboardEvent。
   */
  async _pasteRichContent(html, plain) {
    // Phase 1: 拦截 copy 事件，把自定义 HTML 写入真实系统剪贴板
    const clipOk = await this.page.evaluate((h, p) => {
      try {
        // 创建临时选区以满足 execCommand('copy') 的前置条件
        const temp = document.createElement('span')
        temp.textContent = '\u200b'
        temp.style.cssText = 'position:fixed;left:-9999px;opacity:0'
        document.body.appendChild(temp)
        const range = document.createRange()
        range.selectNode(temp)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)

        // 一次性拦截 copy 事件，写入 text/html + text/plain
        let fired = false
        const handler = (e) => {
          e.clipboardData.setData('text/html', h)
          e.clipboardData.setData('text/plain', p)
          e.preventDefault()
          fired = true
        }
        document.addEventListener('copy', handler, { once: true })
        document.execCommand('copy')
        document.removeEventListener('copy', handler) // 保险：若 once 未触发也清理
        document.body.removeChild(temp)

        // 恢复编辑器焦点 + 光标到末尾
        const editor = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                       document.querySelector('.ProseMirror')
        if (editor) {
          editor.focus()
          const r = document.createRange()
          r.selectNodeContents(editor)
          r.collapse(false) // collapse-to-end
          const s = window.getSelection()
          s.removeAllRanges()
          s.addRange(r)
        }
        return fired
      } catch (_) { return false }
    }, html, plain)

    if (clipOk) {
      // Phase 2: Ctrl+V 触发真实 paste — ProseMirror 会从系统剪贴板读取 text/html
      await this.page.keyboard.down('Control')
      await this.page.keyboard.press('v')
      await this.page.keyboard.up('Control')
    } else {
      // Phase 2 降级: 合成 ClipboardEvent（不如真实剪贴板可靠，但作为后备）
      this.log.warn('[_pasteRichContent] execCommand("copy") 未触发，降级为合成 ClipboardEvent')
      await this.page.evaluate((h, p) => {
        const editor = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                       document.querySelector('.ProseMirror')
        if (!editor) return
        editor.focus()
        const dt = new DataTransfer()
        dt.setData('text/html', h)
        dt.setData('text/plain', p)
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      }, html, plain)
    }
  }

  /** 把 <<<ol>>>/<<<ul>>>/<<<bq>>>/<<<hr>>> 标记转成纯文本可读格式
   *  用于 text/plain 回退 和 键盘逐字输入降级，避免标记原样显示
   */
  _stripMarkers(text) {
    const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
    let olIndex = 0
    return (text || '').split('\n').map(line => {
      const trimmed = line.trim()
      if (!trimmed) { olIndex = 0; return '' }
      if (trimmed === '<<<hr>>>') { olIndex = 0; return '———' }
      if (trimmed.startsWith('<<<bq>>>')) { olIndex = 0; return '「' + trimmed.slice(8) + '」' }
      if (trimmed.startsWith('<<<ol>>>')) {
        olIndex++
        const prefix = olIndex <= 20 ? circled[olIndex - 1] : `${olIndex}.`
        return prefix + ' ' + trimmed.slice(8)
      }
      if (trimmed.startsWith('<<<ul>>>')) { olIndex = 0; return '· ' + trimmed.slice(8) }
      olIndex = 0
      return trimmed
    }).join('\n')
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
    // 头条作品声明是单选（React 组件强制只允许 1 项），取最后一个值
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

    // 2026-04-18：正文过短属于硬性失败（防止假成功）
    // 期望的最小字数：有 content/contentBlocks 时应该 >= 200 字，否则一定是粘贴失败
    const expectedMinLen = 200
    if ((post.content && post.content.length > expectedMinLen) ||
        (post.contentBlocks && post.contentBlocks.some(b => b.type === 'text' && (b.value || '').length > expectedMinLen))) {
      if (state.contentLength < expectedMinLen) {
        throw new Error(`发布前验证失败：编辑器正文仅 ${state.contentLength} 字，远低于期望的 ${expectedMinLen} 字（粘贴/输入被吞）`)
      }
    }

    // 2026-04-18：若 contentBlocks 声明了图片数量，ProseMirror 里实际图片应至少等于此数
    const expectedImages = (post.contentBlocks || []).filter(b => b.type === 'image').length
    if (expectedImages > 0) {
      const imgInfo = await this.page.evaluate(() => {
        const imgs = document.querySelectorAll('div.ProseMirror img')
        return {
          count: imgs.length,
          urls: Array.from(imgs).map(i => ({
            blob: (i.src || '').startsWith('blob:'),
            hasWebUri: !!i.getAttribute('web_uri'),
          })),
        }
      })
      this.log.info(`[验证] 内嵌图片: ${imgInfo.count} 张 (期望 ${expectedImages} 张)`)
      for (let idx = 0; idx < imgInfo.urls.length; idx++) {
        const u = imgInfo.urls[idx]
        this.log.info(`  图片 #${idx + 1}: blob=${u.blob} web_uri=${u.hasWebUri}`)
      }
      if (imgInfo.count < expectedImages) {
        throw new Error(`发布前验证失败：编辑器内嵌图片 ${imgInfo.count} 张，期望 ${expectedImages} 张`)
      }
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

    // 2026-04-21 重构：头条发布按钮交互流程（实测确认）
    //
    // 头条编辑页底部按钮初始状态:  「预览发布」（或「预览并发布」）
    //   Step 6a: 第一次点击 → 按钮文本变为 「确认发布」（或进入预览视图）
    //   Step 6b: 等待 1 秒后再次点击同一位置 → 真正提交发布
    //
    // 兼容两种 UI 版本：
    //   v1（旧版）: "预览并发布" → 预览面板 + "确认发布" 按钮
    //   v2（新版）: "预览发布" → 按钮变为 "确认发布"，同一位置再点击

    // Step 6a: 找到并点击发布按钮（匹配多种文本变体）
    this.log.info('[Step 6a] 点击发布按钮（第一次点击）')
    const firstClickInfo = await this.page.evaluate((sel) => {
      const publishTexts = ['预览发布', '预览并发布', '确认发布', '发布文章', '发布']
      const btns = Array.from(document.querySelectorAll(sel))
      for (const text of publishTexts) {
        const btn = btns.find(b => (b.textContent || '').trim() === text)
        if (btn) {
          btn.scrollIntoView({ block: 'center', inline: 'center' })
          const rect = btn.getBoundingClientRect()
          return { clicked: true, text, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        }
      }
      // 兜底：点击第一个 primary publish-btn
      const primary = document.querySelector('button.byte-btn-primary.publish-btn')
      if (primary) {
        primary.scrollIntoView({ block: 'center', inline: 'center' })
        const rect = primary.getBoundingClientRect()
        return { clicked: true, text: (primary.textContent || '').trim(), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }
      return { clicked: false }
    }, S.publishBtnAlt)
    if (!firstClickInfo.clicked) throw new Error('未找到发布按钮（预览发布/预览并发布/发布文章）')
    // 用 mouse.click 产生 isTrusted 事件（头条校验 isTrusted，evaluate 内的 click 会被忽略）
    await this.page.mouse.click(firstClickInfo.x, firstClickInfo.y)
    this.log.info(`[Step 6a] ✅ 第一次点击完成，按钮文本="${firstClickInfo.text}"，坐标(${Math.round(firstClickInfo.x)},${Math.round(firstClickInfo.y)})`)

    // 等待 1.5~2.5 秒，让按钮文本切换或预览视图出现
    await randomDelay(1500, 2500)

    // Step 6b-0: 第一次点击后立即检查是否已经跳转到成功页（某些 UI 版本一次点击即发布）
    const earlyJump = await this.page.evaluate(() => {
      const url = location.href
      if (/\/profile_v4\/(manage\/content|content\/(graphic|all))|publish_list|\/success/.test(url)) {
        return { jumped: true, hit: 'url:' + url.slice(0, 80) }
      }
      const bodyText = document.body.innerText || ''
      const okTexts = ['发布成功', '发表成功', '提交成功']
      for (const t of okTexts) if (bodyText.includes(t)) return { jumped: true, hit: t }
      return { jumped: false }
    })
    if (earlyJump.jumped) {
      this.log.info(`[Step 6b] ✅ 第一次点击后已直接发布成功 (${earlyJump.hit})`)
      return
    }

    // Step 6b: 检测当前状态，再次点击确认
    this.log.info('[Step 6b] 检测并点击确认发布（第二次点击）')

    // 广泛搜索「确认发布」按钮 — 不限 class，覆盖预览弹窗/模态框/新版 UI 所有场景
    const confirmInfo = await this.page.evaluate(() => {
      const confirmTexts = ['确认发布', '发布文章', '发布']
      const allBtns = Array.from(document.querySelectorAll('button'))
      for (const text of confirmTexts) {
        const btn = allBtns.find(b => {
          const t = (b.textContent || '').trim()
          return t === text && !b.disabled && b.offsetParent !== null
        })
        if (btn) {
          btn.scrollIntoView({ block: 'center', inline: 'center' })
          const rect = btn.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            return { found: true, text, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
                     cls: btn.className.slice(0, 60) }
          }
        }
      }
      return { found: false }
    })

    if (confirmInfo.found) {
      this.log.info(`[Step 6b] 找到「${confirmInfo.text}」按钮 (class=${confirmInfo.cls})，坐标(${Math.round(confirmInfo.x)},${Math.round(confirmInfo.y)})`)
      await this.page.mouse.click(confirmInfo.x, confirmInfo.y)
      this.log.info('[Step 6b] ✅ 用 mouse.click 点击确认按钮')
    } else if (firstClickInfo.x && firstClickInfo.y) {
      // 兜底：在第一次点击的同一坐标位置再次点击
      this.log.info(`[Step 6b] 未找到确认按钮，在原坐标 (${Math.round(firstClickInfo.x)}, ${Math.round(firstClickInfo.y)}) 再次点击`)
      await this.page.mouse.click(firstClickInfo.x, firstClickInfo.y)
    } else {
      throw new Error('确认发布失败：未检测到可点击的确认按钮')
    }
    await randomDelay(2000, 4000)

    // 检查是否已直接发布成功（某些版本第二次点击后直接跳转）
    const earlySuccess = await this.page.evaluate(() => {
      const bodyText = document.body.innerText || ''
      const okTexts = ['发布成功', '发表成功', '提交成功']
      for (const t of okTexts) if (bodyText.includes(t)) return { kind: 'ok', hit: t }
      const url = location.href
      if (/\/profile_v4\/(manage\/content|content\/(graphic|all))|\/publish_list|\/success/.test(url)) {
        return { kind: 'ok', hit: `url:${url.slice(0, 80)}` }
      }
      return null
    })
    if (earlySuccess?.kind === 'ok') {
      this.log.info(`[Step 6b] ✅ 发布成功 (${earlySuccess.hit})`)
      return
    }

    // 2026-04-18：严格判断发布结果
    // 成功信号（任一命中）：
    //   1) toast "发布成功" / "发表成功" / "提交成功"
    //   2) URL 跳转到作品管理 / 用户主页 / "发布成功" 页
    //   3) .preview-article-wrap 消失 + "确认发布" 按钮消失（回不到预览态）
    // 失败信号：显式错误文本
    // unknown：抛错（不再乐观判定为成功）
    this.log.info('[Step 6b] 等待发布结果确认信号...')
    const verdict = await this.page.waitForFunction(() => {
      const bodyText = document.body.innerText || ''
      const errTexts = ['发布失败', '发表失败', '提交失败', '请重试', '内容违规', '审核不通过', '操作频繁', '发布过于频繁', '未通过审核']
      for (const t of errTexts) if (bodyText.includes(t)) return { kind: 'fail', hit: t }

      const okTexts = ['发布成功', '发表成功', '提交成功']
      for (const t of okTexts) if (bodyText.includes(t)) return { kind: 'ok', hit: t }

      const url = location.href
      if (/\/profile_v4\/(manage\/content|content\/(graphic|all))|\/publish_list|\/success/.test(url)) {
        return { kind: 'ok', hit: `url:${url.slice(0, 80)}` }
      }

      const wrapGone = !document.querySelector('.preview-article-wrap')
      const btns = Array.from(document.querySelectorAll('button'))
      const confirmGone = !btns.find(b => (b.textContent || '').trim() === '确认发布')
      if (wrapGone && confirmGone) return { kind: 'ok', hit: 'preview-closed' }

      return null
    }, { timeout: 30000, polling: 500 }).then(h => h.jsonValue()).catch(() => null)

    if (!verdict) {
      // 30s 超时 — 截图存档后尝试多种降级手段
      this.log.warn('[Step 6b] 30s 未检测到成功/失败信号')
      await this.conditionalScreenshot('step6b_timeout', 'error').catch(() => {})

      // 降级 1: 视觉模型（如果已配置）
      const visionResult = await this.visionCheckPublishResult({ platformName: '今日头条' })
      if (visionResult.status === 'success') {
        this.log.info(`[Step 6b] ✅ 视觉模型确认发布成功: ${visionResult.details}`)
        return
      }
      if (visionResult.status === 'need_confirm' && visionResult.popupHandled) {
        this.log.info(`[Step 6b] ✅ 视觉模型检测到确认弹窗并已点击，等待后续信号...`)
        const secondVerdict = await this.page.waitForFunction(() => {
          const bodyText = document.body.innerText || ''
          const okTexts = ['发布成功', '发表成功', '提交成功']
          for (const t of okTexts) if (bodyText.includes(t)) return { kind: 'ok', hit: t }
          const url = location.href
          if (/\/profile_v4\/(manage\/content|content\/(graphic|all))|\/publish_list|\/success/.test(url)) {
            return { kind: 'ok', hit: `url:${url.slice(0, 80)}` }
          }
          return null
        }, { timeout: 10000, polling: 500 }).then(h => h.jsonValue()).catch(() => null)
        if (secondVerdict?.kind === 'ok') {
          this.log.info(`[Step 6b] ✅ 视觉二次点击后确认成功 (${secondVerdict.hit})`)
          return
        }
      }

      // 降级 2: 视觉不可用或返回 unknown — 用 Puppeteer element.click() 强力重试
      if (visionResult.status === 'unknown' || visionResult.status === 'still_editing') {
        this.log.warn('[Step 6b] 视觉不可用或仍在编辑状态，尝试 Puppeteer element.click() 强力重试...')
        const retryClicked = await this.page.evaluate(() => {
          const confirmTexts = ['确认发布', '发布文章', '发布']
          const allBtns = Array.from(document.querySelectorAll('button'))
          for (const text of confirmTexts) {
            const btn = allBtns.find(b => {
              const t = (b.textContent || '').trim()
              return t === text && !b.disabled && b.offsetParent !== null
            })
            if (btn) {
              // 直接用 DOM click（部分场景下有效）
              btn.click()
              const rect = btn.getBoundingClientRect()
              return { clicked: true, text, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            }
          }
          return { clicked: false }
        })
        if (retryClicked.clicked) {
          this.log.info(`[Step 6b] 降级2: DOM click「${retryClicked.text}」完成，再用 mouse.click 补一次`)
          await randomDelay(300, 600)
          await this.page.mouse.click(retryClicked.x, retryClicked.y)
          await randomDelay(3000, 5000)

          // 再检查一次成功信号
          const retryResult = await this.page.evaluate(() => {
            const bodyText = document.body.innerText || ''
            const okTexts = ['发布成功', '发表成功', '提交成功']
            for (const t of okTexts) if (bodyText.includes(t)) return { kind: 'ok', hit: t }
            const url = location.href
            if (/\/profile_v4\/(manage\/content|content\/(graphic|all))|\/publish_list|\/success/.test(url)) {
              return { kind: 'ok', hit: `url:${url.slice(0, 80)}` }
            }
            // 检查按钮是否消失（发布被接受）
            const btns = Array.from(document.querySelectorAll('button'))
            const stillHasConfirm = btns.find(b => (b.textContent || '').trim() === '确认发布')
            if (!stillHasConfirm) return { kind: 'ok', hit: 'confirm-btn-gone' }
            return null
          })
          if (retryResult?.kind === 'ok') {
            this.log.info(`[Step 6b] ✅ 降级重试后确认成功 (${retryResult.hit})`)
            return
          }
        }
      }

      await this.conditionalScreenshot('step6b_final_fail', 'error').catch(() => {})
      throw new Error(`发布结果确认超时（30s+视觉兜底均未检测到成功信号，视觉状态=${visionResult.status}）。可能仍在草稿状态，请人工复核。`)
    }
    if (verdict.kind === 'fail') {
      throw new Error(`头条发布失败: ${verdict.hit}`)
    }
    this.log.info(`[Step 6b] ✅ 发布确认成功 (${verdict.hit})`)
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

  // ─── 发布后：抓真实文章 URL ───────────────────────────────────────────
  /**
   * 2026-04-26 新增：发布成功后从「作品管理」列表抓刚发布文章的真实 URL
   *
   * 头条作品列表入口（按优先级降序）:
   *   1) https://mp.toutiao.com/profile_v4/content/all     - 全部内容
   *   2) https://mp.toutiao.com/profile_v4/content/graphic - 图文专项
   *   3) https://mp.toutiao.com/profile_v4/manage/content  - 旧版管理页
   *
   * step6_publish 成功后 page 通常已在 /profile_v4/manage/content 或 /profile_v4/content/all。
   * 实测时如未跳转，则手动 navigateTo 到 /profile_v4/content/all。
   *
   * 列表项里的真实文章页链接 selector（按优先级）:
   *   a[href*="//www.toutiao.com/article/"]   - 标准文章页
   *   a[href*="//www.toutiao.com/group/"]     - 旧版聚合页（也能用于阅读）
   *   a[href*="//www.toutiao.com/w/"]         - 微头条 (publishWeiToutiao 场景)
   *
   * 匹配策略:
   *   1) 优先按 post.title 文本严格匹配同行内的链接
   *   2) 找不到时取列表第 1 项（最近发布）
   */
  async captureRealPostUrl(post) {
    const title = (post && post.title) || ''
    this.log.info(`[captureRealPostUrl] 开始抓取真实文章 URL（标题: ${title.slice(0, 24)}...）`)

    // Step 1: 确保 page 在作品管理列表
    const LIST_URLS = [
      'https://mp.toutiao.com/profile_v4/content/all',
      'https://mp.toutiao.com/profile_v4/content/graphic',
      'https://mp.toutiao.com/profile_v4/manage/content',
    ]
    let curUrl = ''
    try { curUrl = this.page.url() } catch { /* page closed */ }
    const onListPage = /\/profile_v4\/(manage\/content|content\/(graphic|all))/.test(curUrl)
    if (!onListPage) {
      this.log.info(`[captureRealPostUrl] 当前不在列表页 (${curUrl.slice(0, 60)})，跳转到 ${LIST_URLS[0]}`)
      try {
        await this.navigateTo(LIST_URLS[0])
        await randomDelay(2000, 4000)
      } catch (e) {
        this.log.warn(`[captureRealPostUrl] 跳转作品列表失败: ${e.message}`)
        return null
      }
    } else {
      // 等待列表渲染
      await randomDelay(1500, 3000)
    }

    // Step 2: 在 DOM 里捞链接
    const captured = await this.page.evaluate((wantTitle) => {
      const HREF_PATTERNS = [
        /\/\/www\.toutiao\.com\/article\//,
        /\/\/www\.toutiao\.com\/group\//,
        /\/\/www\.toutiao\.com\/w\//,
      ]
      const allLinks = Array.from(document.querySelectorAll('a[href]'))
      const candidates = allLinks.filter(a => {
        const h = a.href || ''
        return HREF_PATTERNS.some(re => re.test(h))
      })
      if (candidates.length === 0) return { ok: false, reason: 'no-article-links' }

      // 策略 A: 标题严格匹配
      if (wantTitle) {
        const titleNorm = wantTitle.replace(/\s+/g, '').slice(0, 18)
        for (const a of candidates) {
          // 在祖先 5 层内找包含标题的文本
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

      // 策略 B: 取第一条
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
