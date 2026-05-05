import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { COMMENT_REPLY_SELECTORS as S } from './selectors.js'

/**
 * 百家号-评论管理-回评执行器
 *
 * 选择器来源：2026-05-02 在用户已登录的 Chrome 9222 里实测过
 *
 * 工作流（与头条不同 — 百家号是内嵌输入框，无需点击展开）：
 *   1. 打开 mp.baidu.com/builder/rc/commentmanage/comment/all
 *   2. 找到目标评论（按作者/文章/内容匹配）
 *   3. 在该评论项内的 textarea.cheetah-input 用 React 原生 setter 输入文字
 *   4. 等"回复"按钮（button.cheetah-btn-primary）变可用
 *   5. dryRun=true：到此停止
 *      dryRun=false：点击"回复"，等回复列表更新
 *
 * 注意：与头条相同的 React 输入坑——必须用 Object.getOwnPropertyDescriptor + setter，
 *       否则 React onChange 不触发，按钮一直 disabled。
 */
export class BaijiahaoCommentReplier extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'baijiahao'
  }

  /**
   * @param {object} matcher
   * @param {string} [matcher.author]
   * @param {string} [matcher.articleTitle]
   * @param {string} [matcher.content]
   * @param {string} replyText
   * @param {object} [options]
   * @param {boolean} [options.dryRun=true]
   */
  async replyToComment(matcher, replyText, options = {}) {
    const dryRun = options.dryRun !== false

    if (!replyText || !replyText.trim()) {
      return { ok: false, dryRun, error: '回复内容为空' }
    }
    if (!matcher || (!matcher.author && !matcher.articleTitle && !matcher.content)) {
      return { ok: false, dryRun, error: '必须提供 matcher 字段中至少一项' }
    }
    if (replyText.length > S.maxReplyChars) {
      return { ok: false, dryRun, error: `回复超过 ${S.maxReplyChars} 字符限制` }
    }

    this.log.info(`[百家号Replier] 开始回评 (dryRun=${dryRun}) matcher=${JSON.stringify(matcher)}`)
    try {
      await this.navigateTo(S.pageUrl)
      await randomDelay(4000, 6000)

      // 1. 找匹配评论的 idx（用 span.connect 作为锚点）
      const matchResult = await this.page.evaluate((m) => {
        const anchors = document.querySelectorAll('span.connect')
        const debug = []
        for (let i = 0; i < anchors.length; i++) {
          let item = anchors[i].parentElement
          for (let d = 0; d < 5; d++) {
            if (!item) break
            const t = (item.innerText || '')
            if (t.includes('评论了你的') && /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}\s+\d{2}:\d{2}/.test(t)) break
            item = item.parentElement
          }
          if (!item) { debug.push({ i, err: '无 item' }); continue }
          const lines = (item.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)
          const author = lines[0] || ''
          const articleTitle = (item.innerText.match(/《(.+?)》/)?.[1]) || ''
          const content = lines.find((l, idx) => idx > 1 && !/^\d{4}-\d{2}-\d{2}|^\d{2}-\d{2}\s/.test(l) && !/^回复\s*\d*$/.test(l) && !/^点赞\s*\d*$/.test(l) && l.length >= 2) || ''
          debug.push({ i, author, articleTitle, content: content.slice(0, 30) })
          const matched =
            (m.author && author === m.author) ||
            (m.articleTitle && articleTitle.includes(m.articleTitle)) ||
            (m.content && content.includes(m.content))
          if (matched) return { found: true, target: { idx: i, author, articleTitle, content }, debug }
        }
        return { found: false, debug, anchorCount: anchors.length }
      }, matcher)

      if (!matchResult.found) {
        this.log.warn(`[百家号Replier] 未找到匹配。anchorCount=${matchResult.anchorCount}, 看到的评论：${JSON.stringify(matchResult.debug)}`)
        return { ok: false, dryRun, error: '未找到匹配的评论', debug: matchResult.debug }
      }
      const target = matchResult.target
      this.log.info(`[百家号Replier] 已匹配 #${target.idx}: ${target.author} / 《${target.articleTitle}》`)

      // 2. 激活目标评论：点击它的 anchor 让 reply 输入区移到该评论
      await this.page.evaluate((idx) => {
        const anchors = document.querySelectorAll('span.connect')
        const a = anchors[idx]
        if (a) {
          a.scrollIntoView({ block: 'center' })
          // 点击作者/connect 区激活该评论
          const userInfo = a.closest('.userInfo-wrapper') || a.parentElement
          userInfo?.click()
        }
      }, target.idx)
      await randomDelay(1200, 2000)

      // 3. 等 textarea 出现（可能需要激活后才显示）
      await this.page.waitForSelector(S.replyTextarea, { timeout: 5000 }).catch(() => null)

      // 4. 用 React setter 输入文字（页面只有一个 textarea，对应当前激活评论）
      const inputResult = await this.page.evaluate((sel, text) => {
        const ta = document.querySelector(sel)
        if (!ta) return { ok: false, reason: '未找到回复 textarea（评论可能未激活）' }
        ta.scrollIntoView({ block: 'center' })
        ta.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, text)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return { ok: true, valueLen: ta.value.length }
      }, S.replyTextarea, replyText)

      if (!inputResult.ok) {
        return { ok: false, dryRun, error: inputResult.reason }
      }
      await randomDelay(800, 1500)

      // 5. 检查回复按钮可用性
      const btnState = await this.page.evaluate((sel) => {
        const btn = document.querySelector(sel)
        if (!btn) return { found: false }
        return {
          found: true,
          disabled: btn.disabled,
          ariaDisabled: btn.getAttribute('aria-disabled'),
          text: btn.innerText?.trim(),
        }
      }, S.replySubmitButton)

      if (!btnState.found) {
        return { ok: false, dryRun, error: '未找到回复按钮 button.cheetah-btn-primary' }
      }
      if (btnState.disabled) {
        return { ok: false, dryRun, error: `输入完成但回复按钮仍 disabled` }
      }
      this.log.info(`[百家号Replier] 文字已输入(${inputResult.valueLen}字)，回复按钮可用 (dryRun=${dryRun})`)

      if (dryRun) {
        // 清空输入避免污染。页面只有一个激活评论的 textarea，直接全局选择。
        await this.page.evaluate((sel) => {
          const ta = document.querySelector(sel)
          if (!ta) return
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          setter.call(ta, '')
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        }, S.replyTextarea)
        return {
          ok: true,
          dryRun: true,
          matchedComment: target,
          submitButtonReady: true,
          inputValueLen: inputResult.valueLen,
          message: 'dryRun 模式：未真正发布，已清空输入框',
        }
      }

      // 6. 真发模式：点全局唯一的发送按钮
      await this.page.evaluate((sel) => {
        document.querySelector(sel)?.click()
      }, S.replySubmitButton)
      await randomDelay(2000, 4000)

      return { ok: true, dryRun: false, matchedComment: target }
    } catch (err) {
      this.log.error(`[百家号Replier] 回评失败：${err.message}`)
      return { ok: false, dryRun, error: err.message }
    }
  }
}

export default BaijiahaoCommentReplier
