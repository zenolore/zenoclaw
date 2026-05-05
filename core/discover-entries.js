/**
 * 开放式入口发现 (DOM Discovery)
 *
 * 给定关键字（"发布""上传""创作中心""投稿""写文章"...），在真实页面上
 * 扫描所有可能的可点击元素，返回候选列表。用于在没有预先 selectors 的
 * 平台上"逐一测试"实际 DOM 结构，再人工/自动写回 selectors.js。
 *
 * 不点击、不修改页面，只在 page.evaluate 内做只读扫描。
 *
 * 用法（驱动脚本）：
 *   import { discoverEntries } from '../core/discover-entries.js'
 *   const report = await discoverEntries(page, {
 *     keywords: ['发布', '上传', '创作中心', '写文章'],
 *     scope: 'visible',  // 'visible' | 'all'
 *     maxResults: 50
 *   })
 */

const DISCOVER_SCRIPT = `((opts) => {
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return ''
    const parts = []
    let n = el
    while (n && n.nodeType === 1 && parts.length < 6) {
      let p = n.tagName.toLowerCase()
      if (n.id) { p += '#' + n.id; parts.unshift(p); break }
      const c = (n.className || '').toString().split(/\\s+/).filter(s => s && !/^[0-9]/.test(s)).slice(0, 2)
      if (c.length) p += '.' + c.join('.')
      parts.unshift(p)
      n = n.parentElement
    }
    return parts.join(' > ')
  }
  const isVisible = (el) => {
    try {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) return false
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
      return true
    } catch { return false }
  }
  const isClickable = (el) => {
    if (!el || el.nodeType !== 1) return false
    if (['A','BUTTON'].includes(el.tagName)) return true
    const role = el.getAttribute && el.getAttribute('role')
    if (role === 'button' || role === 'link' || role === 'menuitem') return true
    if (el.onclick) return true
    try {
      const cs = getComputedStyle(el)
      if (cs.cursor === 'pointer') return true
    } catch {}
    const cls = (el.className || '').toString()
    if (/(?:^|[\\s-_])(btn|button|menu-item|tab|link|clickable|nav-item|trigger|entry)([\\s-_]|$)/i.test(cls)) return true
    return false
  }
  const meta = (el, matched) => {
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 200),
      id: el.id || null,
      text: ((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()).slice(0, 120),
      href: el.href || null,
      role: el.getAttribute && el.getAttribute('role') || null,
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      visible: isVisible(el),
      clickable: isClickable(el),
      cssPath: cssPath(el),
      matchedKeywords: matched
    }
  }

  const keywords = (opts.keywords || []).filter(Boolean)
  const scope = opts.scope || 'visible'
  const maxResults = Number(opts.maxResults || 80)
  const tagPriority = ['button', 'a', '[role="button"]', '[role="link"]', '[role="menuitem"]', 'span', 'div']

  // 收集所有可能的可点击元素
  const seen = new Set()
  const candidates = []
  for (const tag of tagPriority) {
    const els = Array.from(document.querySelectorAll(tag))
    for (const el of els) {
      if (seen.has(el)) continue
      seen.add(el)
      const text = ((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim())
      if (!text) continue
      // 关键字命中（任一即可）
      const matched = keywords.filter(kw => text.includes(kw))
      if (matched.length === 0) continue
      // 过滤太长的容器（>200 字大概率是大段落，不是入口）
      if (text.length > 200) continue
      // 必须是可见或 clickable
      if (scope === 'visible' && !isVisible(el)) continue
      if (!isClickable(el)) {
        // 不可点击但文本短小、可见的也保留（可能是 wrapper span）
        if (text.length > 50) continue
      }
      candidates.push(meta(el, matched))
      if (candidates.length >= maxResults * 2) break
    }
    if (candidates.length >= maxResults * 2) break
  }

  // 去重：按 cssPath + text
  const dedupMap = new Map()
  for (const c of candidates) {
    const key = c.cssPath + '|' + c.text
    if (!dedupMap.has(key)) dedupMap.set(key, c)
  }
  const unique = Array.from(dedupMap.values())
  // 按"短文本 + visible + clickable"排序：入口按钮通常文本简洁
  unique.sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1
    if (a.clickable !== b.clickable) return a.clickable ? -1 : 1
    if (a.text.length !== b.text.length) return a.text.length - b.text.length
    return 0
  })

  return {
    url: location.href,
    title: document.title,
    keywords,
    scope,
    candidates: unique.slice(0, maxResults),
    totalFound: unique.length
  }
})`

/**
 * 在真实页面上做开放式入口发现
 * @param {Page} page - puppeteer page
 * @param {object} options
 * @param {string[]} [options.keywords] - 命中文本关键字（任一即算命中）
 * @param {string} [options.scope] - 'visible' 默认 / 'all'
 * @param {number} [options.maxResults] - 最大返回数
 */
export async function discoverEntries(page, options = {}) {
  if (!page) throw new Error('discoverEntries: page is required')
  const opts = {
    keywords: options.keywords || ['发布', '上传', '创作', '投稿', '写文章', '写笔记', '发表'],
    scope: options.scope || 'visible',
    maxResults: options.maxResults || 60
  }
  const wrapped = `(${DISCOVER_SCRIPT})(${JSON.stringify(opts)})`
  return page.evaluate(wrapped)
}

/**
 * 给定一组发现报告，按 keyword 维度归类候选
 */
export function groupCandidatesByKeyword(report) {
  const out = {}
  for (const c of report?.candidates || []) {
    for (const kw of c.matchedKeywords || []) {
      if (!out[kw]) out[kw] = []
      out[kw].push(c)
    }
  }
  return out
}
