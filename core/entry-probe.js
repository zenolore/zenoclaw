/**
 * 入口候选 DOM 探测器
 *
 * 给定一个平台的 entry/publish selector 矩阵（如 selectors.js 里的 CREATOR_ENTRY_SELECTORS），
 * 在真实页面上检查每个候选 selector / 文本是否命中可见元素，返回详细元数据。
 *
 * 不点击、不修改页面，只在 page.evaluate 内做只读探测。
 *
 * 用法（在驱动脚本里）：
 *   import { probeSelectorMatrix } from '../core/entry-probe.js'
 *   const report = await probeSelectorMatrix(page, CREATOR_ENTRY_SELECTORS, { tagsForText: ['button','a','span','div'] })
 */

const PROBE_SCRIPT = `((matrix, tagsForText) => {
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
  const meta = (el) => {
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
      cssPath: cssPath(el)
    }
  }

  const probeSelectors = (selectorArr) => {
    return (Array.isArray(selectorArr) ? selectorArr : [selectorArr]).map(sel => {
      if (!sel || typeof sel !== 'string') return { selector: String(sel), hit: false, count: 0, samples: [] }
      // 跳过 puppeteer 不支持的 :has-text() 伪类（DOM querySelectorAll 报错）
      if (/:has-text\\(/i.test(sel)) {
        return { selector: sel, hit: false, count: 0, samples: [], error: 'unsupported_pseudo' }
      }
      let nodes = []
      try { nodes = Array.from(document.querySelectorAll(sel)) }
      catch (e) { return { selector: sel, hit: false, count: 0, samples: [], error: e.message } }
      const visibleNodes = nodes.filter(isVisible)
      const useNodes = visibleNodes.length > 0 ? visibleNodes : nodes
      return {
        selector: sel,
        hit: visibleNodes.length > 0,
        count: visibleNodes.length,
        countTotal: nodes.length,
        samples: useNodes.slice(0, 3).map(meta)
      }
    })
  }

  const probeTexts = (texts, tags) => {
    const tagList = Array.isArray(tags) && tags.length ? tags : ['button', 'a', 'span', 'div', 'li']
    const candidates = Array.isArray(texts) ? texts : [texts]
    const results = []
    for (const t of candidates) {
      if (!t || typeof t !== 'string') {
        results.push({ text: String(t), hit: false, samples: [] })
        continue
      }
      let firstHit = null
      const samples = []
      for (const tag of tagList) {
        const els = Array.from(document.querySelectorAll(tag))
        for (const el of els) {
          const inner = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
          if (!inner) continue
          if (inner.includes(t)) {
            const m = meta(el)
            if (!firstHit && m.visible) firstHit = m
            samples.push(Object.assign({ matchedTag: tag }, m))
            if (samples.length >= 5) break
          }
        }
        if (samples.length >= 5) break
      }
      results.push({ text: t, hit: !!firstHit, samples: samples.slice(0, 5) })
    }
    return results
  }

  matrix = matrix || {}
  const out = { url: location.href, title: document.title, selectorHits: {}, textHits: {} }

  for (const [key, value] of Object.entries(matrix)) {
    if (value == null) continue
    if (key === 'isPlaceholder') { out.isPlaceholder = !!value; continue }
    // selector key 约定：以 Url 结尾视作 URL；以 Text 结尾视作文本候选；其余视作 selector 数组
    if (/Url$/.test(key)) { out[key] = value; continue }
    if (/Text$/.test(key)) {
      out.textHits[key] = probeTexts(value, tagsForText)
      continue
    }
    if (Array.isArray(value) || typeof value === 'string') {
      out.selectorHits[key] = probeSelectors(value)
    }
  }

  // 汇总
  let selOk = 0, selTotal = 0
  for (const arr of Object.values(out.selectorHits)) {
    for (const r of arr) { selTotal += 1; if (r.hit) selOk += 1 }
  }
  let txtOk = 0, txtTotal = 0
  for (const arr of Object.values(out.textHits)) {
    for (const r of arr) { txtTotal += 1; if (r.hit) txtOk += 1 }
  }
  out.summary = { selectorTotal: selTotal, selectorHit: selOk, textTotal: txtTotal, textHit: txtOk }
  return out
})`



/**
 * 在当前页面上探测一个 selector 矩阵
 * @param {Page} page - puppeteer page
 * @param {object} matrix - selectors.js 形状（每个字段是 selector 数组或文本数组）
 * @param {object} [options]
 * @param {string[]} [options.tagsForText] - 限定文本探测的 tag 列表
 * @returns {Promise<object>} 详细命中报告
 */
export async function probeSelectorMatrix(page, matrix = {}, options = {}) {
  if (!page) throw new Error('probeSelectorMatrix: page is required')
  const tagsForText = options.tagsForText || null
  // 注意：把 PROBE_SCRIPT 字符串里的 arguments[0] 转成 evaluate 实参
  const wrapped = `(${PROBE_SCRIPT}).call(null, ${JSON.stringify(matrix)}, ${JSON.stringify(tagsForText)})`
  return page.evaluate(wrapped)
}

/**
 * 计算命中率，便于驱动脚本输出摘要
 */
export function computeProbeScore(report) {
  const s = report?.summary || {}
  const selRate = s.selectorTotal > 0 ? s.selectorHit / s.selectorTotal : 0
  const txtRate = s.textTotal > 0 ? s.textHit / s.textTotal : 0
  return {
    selectorHitRate: Number(selRate.toFixed(2)),
    textHitRate: Number(txtRate.toFixed(2)),
    selectorOk: s.selectorHit,
    selectorTotal: s.selectorTotal,
    textOk: s.textHit,
    textTotal: s.textTotal
  }
}

/**
 * 从报告里挑出"高置信度命中"的 selector，可作为 selector 校准建议
 */
export function pickConfidentSelectors(report, options = {}) {
  const result = {}
  const minVisible = Number(options.minVisible ?? 1)
  for (const [key, arr] of Object.entries(report?.selectorHits || {})) {
    const winners = arr.filter(r => r.hit && r.count >= minVisible)
    if (winners.length > 0) result[key] = winners.map(r => r.selector)
  }
  return result
}
