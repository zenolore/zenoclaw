import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { COMMENT_REPLY_SELECTORS as S } from './selectors.js'

/**
 * B 站-评论管理-回评执行器
 *
 * 选择器来源：2026-05-02 实测
 *
 * 工作流：
 *   1. 打开 /platform/comment/article
 *   2. 找匹配评论项 .comment-list-item（按作者/视频标题/内容匹配）
 *   3. 点击该项内的 span.reply.action（"回复"）
 *   4. 等待 textarea 出现（placeholder 形如 "回复 @{author} :"）
 *   5. 输入文字
 *   6. dryRun=true：到此停止
 *      dryRun=false：找发送按钮（输入后才显示，文本"发送"或"回复"）点击
 */
export class BilibiliCommentReplier extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'bilibili'
  }

  /**
   * @param {object} matcher
   * @param {string} [matcher.author]
   * @param {string} [matcher.videoTitle]
   * @param {string} [matcher.content]
   * @param {string} replyText
   * @param {object} [options]
   * @param {boolean} [options.dryRun=true]
   */
  async replyToComment(matcher, replyText, options = {}) {
    const dryRun = options.dryRun !== false
    if (!replyText || !replyText.trim()) return { ok: false, dryRun, error: '回复内容为空' }
    if (!matcher || (!matcher.author && !matcher.videoTitle && !matcher.content)) {
      return { ok: false, dryRun, error: '需提供 matcher.author/videoTitle/content 中至少一项' }
    }

    this.log.info(`[B站Replier] 回评 (dryRun=${dryRun}) matcher=${JSON.stringify(matcher)}`)
    try {
      await this.navigateTo(S.pageUrl)
      await randomDelay(5000, 7000)

      // 1. 找匹配评论的 idx
      const target = await this.page.evaluate((m) => {
        const items = document.querySelectorAll('.comment-list-item')
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const author = item.querySelector('.ci-title')?.innerText?.trim() || ''
          const fullText = (item.innerText || '').replace(/\r/g, '')
          const lines = fullText.split('\n').map(s => s.trim()).filter(Boolean)
          const videoTitle = lines[0] || ''
          const authorIdx = lines.findIndex(l => l === author)
          const content = (authorIdx >= 0 ? lines[authorIdx + 1] : lines[2]) || ''
          const matched =
            (m.author && author === m.author) ||
            (m.videoTitle && videoTitle.includes(m.videoTitle)) ||
            (m.content && content.includes(m.content))
          if (matched) return { idx: i, author, videoTitle, content }
        }
        return null
      }, matcher)

      if (!target) return { ok: false, dryRun, error: '未找到匹配的评论' }
      this.log.info(`[B站Replier] 已匹配 #${target.idx}: ${target.author} / ${target.videoTitle.slice(0, 40)}`)

      // 2. 点击该项的 span.reply.action（用 ElementHandle.click 确保事件派发）
      const replyHandles = await this.page.$$('.comment-list-item span.reply.action')
      if (target.idx >= replyHandles.length) {
        return { ok: false, dryRun, error: `回复按钮 idx 越界 (${target.idx}/${replyHandles.length})` }
      }
      await replyHandles[target.idx].scrollIntoView()
      await replyHandles[target.idx].click({ delay: 100 })
      await randomDelay(1500, 2500)

      // 3. 找 textarea (placeholder 形如 "回复 @{author} :")
      const taSelector = `textarea[placeholder*="${target.author}"]`
      const taHandle = await this.page.waitForSelector(taSelector, { timeout: 5000 }).catch(() => null)
      if (!taHandle) {
        // 兜底：找任意 placeholder 含 "回复" 的 textarea
        return { ok: false, dryRun, error: '回复输入框未出现（textarea 含 placeholder "回复 @{author}"）' }
      }

      // 4. 输入文字（B 站 textarea 用 React setter 更稳）
      const inputResult = await this.page.evaluate((sel, text) => {
        const ta = document.querySelector(sel)
        if (!ta) return { ok: false, reason: '未找到 textarea' }
        ta.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, text)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return { ok: true, valueLen: ta.value.length }
      }, taSelector, replyText)
      if (!inputResult.ok) return { ok: false, dryRun, error: inputResult.reason }
      await randomDelay(800, 1500)

      // 5. 找发送按钮：输入后应该出现一个"发送"或"回复"按钮（在 textarea 附近）
      const submitBtn = await this.page.evaluate(() => {
        // 找所有可见的 button/role=button，文本符合"发送/回复/发布"
        const candidates = []
        document.querySelectorAll('button, [role="button"]').forEach(el => {
          const text = (el.innerText || '').replace(/[\s\u200B\u3000]+/g, '').trim()
          if (!/^(发送|发布|回复|提交|发表回复|发表|确定回复)$/.test(text)) return
          const r = el.getBoundingClientRect()
          if (r.width < 2 || r.height < 2) return
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') return
          candidates.push({
            tag: el.tagName, text, cls: el.className.toString().slice(0, 200),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            x: Math.round(r.left), y: Math.round(r.top),
          })
        })
        return candidates
      })
      this.log.info(`[B站Replier] 发送按钮候选 ${submitBtn.length} 个: ${submitBtn.map(b => b.text).join(',')}`)

      const ready = submitBtn.find(b => !b.disabled)
      if (!ready) {
        return { ok: false, dryRun, error: '未找到可用的发送/回复按钮', candidates: submitBtn }
      }

      this.log.info(`[B站Replier] 已输入 ${inputResult.valueLen} 字，按钮"${ready.text}"可用 (dryRun=${dryRun})`)

      if (dryRun) {
        // 清空 textarea
        await this.page.evaluate((sel) => {
          const ta = document.querySelector(sel)
          if (!ta) return
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          setter.call(ta, '')
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        }, taSelector)
        return {
          ok: true, dryRun: true,
          matchedComment: target,
          submitButtonReady: true,
          submitButtonText: ready.text,
          inputValueLen: inputResult.valueLen,
          message: 'dryRun 模式：未真正发布，已清空输入框',
        }
      }

      // 真发模式：点击第一个可用按钮
      await this.page.evaluate((targetText) => {
        for (const el of document.querySelectorAll('button, [role="button"]')) {
          const text = (el.innerText || '').replace(/[\s\u200B\u3000]+/g, '').trim()
          if (text !== targetText) continue
          const r = el.getBoundingClientRect()
          if (r.width < 2) continue
          if (el.disabled) continue
          el.click()
          return true
        }
        return false
      }, ready.text)
      await randomDelay(2000, 4000)

      return { ok: true, dryRun: false, matchedComment: target }
    } catch (err) {
      this.log.error(`[B站Replier] 回评失败：${err.message}`)
      return { ok: false, dryRun, error: err.message }
    }
  }
}

export default BilibiliCommentReplier
