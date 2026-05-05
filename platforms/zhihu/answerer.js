import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'

/**
 * 知乎"回答问题"执行器
 *
 * 选择器来源：2026-05-02 实测，使用用户已登录的 Chrome 9222
 *
 * 完整工作流（实测验证）：
 *   1. 进 /creator/featured-question/invited → listFeaturedQuestions()
 *   2. 选某个问题 → getQuestionDetail(questionUrl) 提取标题+描述（交给 AI）
 *   3. AI 生成回答内容（外部完成，传 answerText 进来）
 *   4. submitAnswer(questionUrl, answerText, { dryRun }) → 走完整链路：
 *      - 直接打开 questionUrl#write（编辑器模式）
 *      - 在 .public-DraftEditor-content (Draft.js) 输入文字
 *      - 点击 .Button--primary "发布回答"
 *
 * 安全策略：
 *   submitAnswer 默认 dryRun=true，只输入文字+检测发布按钮可用，不真正发出。
 *   真发模式必须显式 { dryRun: false }。
 *
 * Draft.js 输入注意：
 *   Draft.js 的 contenteditable 不是普通 div，必须用 InputEvent + clipboard 模拟
 *   或者 document.execCommand('insertText')。本实现使用键盘 type（最稳）。
 */
export class ZhihuQuestionAnswerer extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'zhihu'
  }

  /**
   * 列出"邀请你回答"的问题
   *
   * @param {object} [options]
   * @param {number} [options.limit=20]
   * @returns {Promise<Array<{questionUrl, title, answerCount, followCount, inviter, inviteTime}>>}
   */
  async listFeaturedQuestions(options = {}) {
    const limit = Math.max(1, Math.min(options.limit || 20, 100))
    const url = 'https://www.zhihu.com/creator/featured-question/invited'
    this.log.info(`[知乎Answerer] 列出邀请回答问题 (limit=${limit})`)

    try {
      await this.navigateTo(url)
      await randomDelay(4000, 6000)

      return await this.page.evaluate((max) => {
        // 锚点：每个问题项末尾都有"写回答"。从"写回答"反向找到包含完整问题信息的最小容器。
        const out = []
        const seen = new Set()
        document.querySelectorAll('a, button, span, div').forEach(btnEl => {
          const text = (btnEl.innerText || '').replace(/[\s\u200B\u3000]+/g, '').trim()
          if (text !== '写回答') return
          // 向上找含 "N 回答 · N 关注" 的最小容器
          let item = btnEl.parentElement
          for (let i = 0; i < 6 && item; i++) {
            const t = (item.innerText || '').trim()
            if (/\d+\s*回答\s*[·•]\s*\d+\s*关注/.test(t)) break
            item = item.parentElement
          }
          if (!item) return
          const fullText = (item.innerText || '').replace(/\r/g, '')
          // 第一行是问题标题
          const lines = fullText.split('\n').map(s => s.trim()).filter(Boolean)
          const title = lines[0] || ''
          if (!title || seen.has(title)) return
          seen.add(title)

          const answerMatch = fullText.match(/(\d+)\s*回答/)
          const followMatch = fullText.match(/(\d+)\s*关注/)
          // 邀请人 + 时间："碧芷怡 邀请你回答 · 3 分钟前"
          const inviteMatch = fullText.match(/(\S+?)\s*邀请你回答\s*[·•]\s*([^\n]+?)前/)
          // 找问题 URL：item 内或 btnEl 附近
          let questionUrl = null
          const aHref = item.querySelector('a[href*="/question/"]')
          if (aHref) questionUrl = aHref.href
          if (!questionUrl) {
            const a = btnEl.closest('a[href*="/question/"]') || btnEl.querySelector?.('a[href*="/question/"]')
            if (a) questionUrl = a.href
          }
          out.push({
            title,
            questionUrl,
            answerCount: answerMatch ? parseInt(answerMatch[1], 10) : null,
            followCount: followMatch ? parseInt(followMatch[1], 10) : null,
            inviter: inviteMatch?.[1] || null,
            inviteTime: inviteMatch ? inviteMatch[2] + '前' : null,
          })
          if (out.length >= max) return
        })
        return out
      }, limit)
    } catch (err) {
      this.log.warn(`[知乎Answerer] 列表读取失败：${err.message}`)
      return []
    }
  }

  /**
   * 进入某个问题详情，提取问题标题 + 描述（用于交给 AI 生成答案）
   *
   * @param {string} questionUrl  例：https://www.zhihu.com/question/2018392701712741217
   * @returns {Promise<{title, description, answerCount, followCount, viewCount, url}|null>}
   */
  async getQuestionDetail(questionUrl) {
    if (!questionUrl) return null
    this.log.info(`[知乎Answerer] 读取问题详情：${questionUrl}`)
    try {
      await this.navigateTo(questionUrl)
      await randomDelay(3500, 5500)

      return await this.page.evaluate(() => {
        const title = document.querySelector('.QuestionHeader-title, h1[class*="QuestionHeader"]')?.innerText?.trim() ||
                      document.querySelector('h1')?.innerText?.trim() || ''
        const description = document.querySelector('.QuestionHeader-detail, .QuestionRichText, [class*="QuestionRichText"]')?.innerText?.trim() || ''

        // bodyText 抓 "N 个回答 · N 个关注 · N 被浏览"
        const bodyText = document.body.innerText || ''
        const answerMatch = bodyText.match(/(\d+(?:[万w]+)?)\s*个?\s*回答/)
        const followMatch = bodyText.match(/关注者\s*(\d+(?:[万w]+)?)/) || bodyText.match(/(\d+(?:[万w]+)?)\s*关注/)
        const viewMatch = bodyText.match(/被浏览\s*(\d+(?:[万w]+)?)/) || bodyText.match(/(\d+(?:[万w]+)?)\s*被浏览/)

        return {
          url: location.href,
          title,
          description,
          answerCountText: answerMatch?.[1] || null,
          followCountText: followMatch?.[1] || null,
          viewCountText: viewMatch?.[1] || null,
        }
      })
    } catch (err) {
      this.log.warn(`[知乎Answerer] 问题详情读取失败：${err.message}`)
      return null
    }
  }

  /**
   * 写并提交回答（dryRun 默认 true）
   *
   * @param {string} questionUrl  问题 URL（必须是 /question/{id} 格式）
   * @param {string} answerText   回答文本（纯文本即可，Draft.js 会自动入文）
   * @param {object} [options]
   * @param {boolean} [options.dryRun=true]
   * @returns {Promise<{ok, dryRun, error?, valueLen?, publishButtonReady?}>}
   */
  async submitAnswer(questionUrl, answerText, options = {}) {
    const dryRun = options.dryRun !== false
    if (!questionUrl || !/\/question\/\d+/.test(questionUrl)) {
      return { ok: false, dryRun, error: '无效 questionUrl（需含 /question/{id}）' }
    }
    if (!answerText || !answerText.trim()) {
      return { ok: false, dryRun, error: '回答内容为空' }
    }

    // 直接进入 #write 模式（点击列表"写回答"等价于这个 URL）
    const writeUrl = questionUrl.split('#')[0] + '#write'
    this.log.info(`[知乎Answerer] 提交回答 (dryRun=${dryRun}) → ${writeUrl}`)

    try {
      await this.navigateTo(writeUrl)
      await randomDelay(4000, 6000)

      const editorSelector = '.public-DraftEditor-content[contenteditable="true"], [contenteditable="true"].public-DraftEditor-content, [contenteditable="true"]'
      let editorReady = await this.page.waitForSelector(editorSelector, { timeout: 8000 }).catch(() => null)
      if (!editorReady) {
        await this.page.evaluate(() => {
          const norm = (s) => (s || '').replace(/[\s\u200B\u3000]+/g, '').trim()
          const btn = [...document.querySelectorAll('button, [role="button"], a')]
            .find(el => /^(写回答|开始回答|回答问题|添加回答)$/.test(norm(el.innerText)))
          btn?.click()
        }).catch(() => {})
        await randomDelay(2000, 3000)
        editorReady = await this.page.waitForSelector(editorSelector, { timeout: 8000 }).catch(() => null)
      }
      if (!editorReady) {
        return { ok: false, dryRun, error: '编辑器未出现（.public-DraftEditor-content）' }
      }

      await this.page.evaluate((sel) => {
        const editors = [...document.querySelectorAll(sel)]
        const target = editors.find(el => String(el.className).includes('public-DraftEditor-content')) || editors[0]
        target?.scrollIntoView({ block: 'center' })
        target?.focus()
      }, editorSelector)
      await randomDelay(300, 600)

      await this.page.keyboard.type(answerText, { delay: 20 })
      await randomDelay(800, 1500)

      let inputValueLen = await this.page.evaluate((sel) => {
        const editors = [...document.querySelectorAll(sel)]
        const el = editors.find(el => String(el.className).includes('public-DraftEditor-content')) || editors[0]
        return (el?.innerText || '').replace(/\s+/g, '').length
      }, editorSelector)

      if (inputValueLen === 0) {
        inputValueLen = await this.page.evaluate((sel, text) => {
          const editors = [...document.querySelectorAll(sel)]
          const el = editors.find(el => String(el.className).includes('public-DraftEditor-content')) || editors[0]
          if (!el) return 0
          el.focus()
          document.execCommand('selectAll', false)
          document.execCommand('delete', false)
          document.execCommand('insertText', false, text)
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
          return (el.innerText || '').replace(/\s+/g, '').length
        }, editorSelector, answerText)
      }

      if (inputValueLen === 0) {
        return { ok: false, dryRun, error: '输入失败：editor.innerText 仍为空' }
      }

      // 检查发布按钮
      const btnState = await this.page.evaluate(() => {
        // 找文本含"发布回答"的按钮
        for (const btn of document.querySelectorAll('button')) {
          const text = (btn.innerText || '').trim()
          if (text === '发布回答' || text === '发布' || text === '发表回答') {
            return {
              found: true,
              text,
              disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
              cls: btn.className.toString().slice(0, 200),
            }
          }
        }
        return { found: false }
      })

      if (!btnState.found) {
        return { ok: false, dryRun, error: '未找到"发布回答"按钮', valueLen: inputValueLen }
      }
      if (btnState.disabled) {
        return { ok: false, dryRun, error: '"发布回答"按钮 disabled', valueLen: inputValueLen }
      }

      this.log.info(`[知乎Answerer] 文字已输入(${inputValueLen}字)，发布按钮可用 (dryRun=${dryRun})`)

      if (dryRun) {
        // dryRun：清空编辑器
        await this.page.evaluate((sel) => {
          const editors = [...document.querySelectorAll(sel)]
          const el = editors.find(el => String(el.className).includes('public-DraftEditor-content')) || editors[0]
          if (el) {
            el.focus()
            // 全选 + 删除
            document.execCommand('selectAll', false)
            document.execCommand('delete', false)
          }
        }, editorSelector)
        return {
          ok: true,
          dryRun: true,
          questionUrl: writeUrl,
          valueLen: inputValueLen,
          publishButtonReady: true,
          message: 'dryRun 模式：未真正发布，已清空编辑器',
        }
      }

      // 真发模式：点击发布
      await this.page.evaluate(() => {
        for (const btn of document.querySelectorAll('button')) {
          const text = (btn.innerText || '').trim()
          if (text === '发布回答' || text === '发布' || text === '发表回答') {
            btn.click()
            return true
          }
        }
        return false
      })
      await randomDelay(3000, 5000)

      return {
        ok: true,
        dryRun: false,
        questionUrl: writeUrl,
        valueLen: inputValueLen,
      }
    } catch (err) {
      this.log.error(`[知乎Answerer] 提交回答失败：${err.message}`)
      return { ok: false, dryRun, error: err.message }
    }
  }
}

export default ZhihuQuestionAnswerer
