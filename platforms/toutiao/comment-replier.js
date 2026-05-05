import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { COMMENT_REPLY_SELECTORS as S } from './selectors.js'

/**
 * 头条号-评论管理-回评执行器
 *
 * 工作流（基于 2026-05-02 实测）：
 *   1. 打开 mp.toutiao.com/profile_v4/manage/comment/all
 *   2. 找到目标评论（按作者/文章/内容匹配）
 *   3. 点击该评论的 "回复" 按钮 → 右侧出现回复面板（.comment-item-reply-box-showed）
 *   4. 在 textarea.byte-textarea 输入回复文字
 *   5. 等"发布"按钮变成可用（disabled=false）
 *   6. dryRun=true（默认）：到此停止，避免误发
 *      dryRun=false：点击"发布"，等待新评论出现在"全部 N 条回复"列表
 *
 * 安全策略：
 *   默认 dryRun=true。真发模式必须显式传 dryRun: false。
 */
export class ToutiaoCommentReplier extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'toutiao'
  }

  /**
   * 回复一条评论
   *
   * @param {object} matcher              定位评论用：任一字段匹配则视为目标
   * @param {string} [matcher.author]     评论作者名（精确）
   * @param {string} [matcher.articleTitle] 被评论的文章标题（包含匹配）
   * @param {string} [matcher.content]    评论内容（包含匹配）
   * @param {string} replyText            要发的回复文字
   * @param {object} [options]
   * @param {boolean} [options.dryRun=true]  默认 true：仅输入文字+检测发布按钮，不真点击
   * @returns {Promise<{ok: boolean, dryRun: boolean, matchedComment: object?, error?: string}>}
   */
  async replyToComment(matcher, replyText, options = {}) {
    const dryRun = options.dryRun !== false  // 默认 true

    if (!replyText || !replyText.trim()) {
      return { ok: false, dryRun, error: '回复内容为空' }
    }
    if (!matcher || (!matcher.author && !matcher.articleTitle && !matcher.content)) {
      return { ok: false, dryRun, error: '必须提供 matcher.author/articleTitle/content 中至少一项' }
    }

    this.log.info(`[头条Replier] 开始回评 (dryRun=${dryRun}) matcher=${JSON.stringify(matcher)}`)

    try {
      await this.navigateTo(S.pageUrl)
      await randomDelay(3000, 5000)

      // 1. 找到目标评论的 .comment-item，记录其在页面上的索引
      const targetIndex = await this.page.evaluate((m) => {
        const items = document.querySelectorAll('.comment-item')
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const author = item.querySelector('.comment-item-title')?.innerText?.trim() || ''
          const articleTitle = item.querySelector('.comment-item-header-extra .extra-title')?.innerText?.trim()?.replace(/^《|》$/g, '') || ''
          const content = item.querySelector('.comment-item-content-wrap')?.innerText?.trim() || ''
          const matched =
            (m.author && author === m.author) ||
            (m.articleTitle && articleTitle.includes(m.articleTitle)) ||
            (m.content && content.includes(m.content))
          if (matched) {
            return { idx: i, author, articleTitle, content }
          }
        }
        return null
      }, matcher)

      if (!targetIndex) {
        return { ok: false, dryRun, error: '未找到匹配的评论' }
      }

      this.log.info(`[头条Replier] 已匹配 #${targetIndex.idx}: ${targetIndex.author} 评论 《${targetIndex.articleTitle}》`)

      // 2. 点击该评论里的"回复"按钮（用 ElementHandle 精确点击）
      const items = await this.page.$$(S.commentItem)
      const targetItem = items[targetIndex.idx]
      if (!targetItem) {
        return { ok: false, dryRun, error: 'index 失效，可能页面已重新渲染' }
      }
      const actions = await targetItem.$$(S.commentActionItem)
      let clicked = false
      for (const a of actions) {
        const text = await a.evaluate(el => (el.innerText || '').trim())
        if (text === '回复') {
          await a.click({ delay: 80 })
          clicked = true
          break
        }
      }
      if (!clicked) {
        return { ok: false, dryRun, error: '该评论无"回复"按钮（可能已是回复状态或已隐藏）' }
      }

      // 3. 等待回复面板出现
      await this.page.waitForSelector(S.replyBoxShowed, { timeout: 5000 }).catch(() => null)
      await randomDelay(800, 1500)

      // 4. 找到 textarea 并输入文字
      //
      // ⚠️ 关键：头条评论面板是 React 实现，必须用 React 原生 setter 才能触发 onChange，
      //    否则 textarea.value 即使设置了 React 也监听不到，发布按钮不会启用。
      //    实测（2026-05-02）：puppeteer keyboard.type 失效；直接 .value= 失效；
      //    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set 才有效。
      const inputResult = await this.page.evaluate((sel, text) => {
        const ta = document.querySelector(sel)
        if (!ta) return { found: false }
        ta.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, text)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return { found: true, valueLen: ta.value.length }
      }, S.replyTextarea, replyText)

      if (!inputResult.found) {
        return { ok: false, dryRun, error: '回复面板出现但未找到 textarea' }
      }
      await randomDelay(500, 1000)

      // 5. 检查发布按钮可用性
      const submitState = await this.page.evaluate((sel) => {
        const btn = document.querySelector(sel)
        if (!btn) return { found: false }
        return {
          found: true,
          disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
          text: btn.innerText?.trim(),
        }
      }, S.replySubmitButton)

      if (!submitState.found) {
        return { ok: false, dryRun, error: '未找到"发布"按钮' }
      }
      if (submitState.disabled) {
        return { ok: false, dryRun, error: `输入完成但"发布"按钮仍 disabled（可能内容长度不达标或被风控）` }
      }

      this.log.info(`[头条Replier] 文字已输入，"发布"按钮可用 (dryRun=${dryRun})`)

      if (dryRun) {
        // dryRun 模式：清空已输入的文字，避免污染面板（同样要走 React setter）
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
          matchedComment: targetIndex,
          submitButtonReady: true,
          inputValueLen: inputResult.valueLen,
          message: 'dryRun 模式：未真正发布，已清空输入框',
        }
      }

      // 6. 真发模式：点击"发布"
      await this.page.click(S.replySubmitButton)
      await randomDelay(2000, 4000)

      // 验证：检查"全部 N 条回复"或回复列表是否更新
      const afterCount = await this.page.evaluate(() => {
        const m = document.body.innerText.match(/全部\s*(\d+)\s*条回复/)
        return m ? parseInt(m[1], 10) : null
      }).catch(() => null)

      return {
        ok: true,
        dryRun: false,
        matchedComment: targetIndex,
        afterReplyCount: afterCount,
      }
    } catch (err) {
      this.log.error(`[头条Replier] 回评失败：${err.message}`)
      return { ok: false, dryRun, error: err.message }
    }
  }
}

export default ToutiaoCommentReplier
