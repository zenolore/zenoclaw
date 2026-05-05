import fs from 'node:fs'
import path from 'node:path'
import { randomDelay } from '../core/human.js'

export const VIDEO_PUBLISH_ENTRIES = {
  toutiao: {
    label: '今日头条',
    url: 'https://mp.toutiao.com/profile_v4/xigua/upload-video',
    uploadSelectors: [
      'div.xigua-upload-video input[type="file"]',
      '.xigua-upload-video-trigger input[type="file"]',
      'input[type="file"]',
    ],
    completionHints: [/发布设置|原创|标题|简介|封面|分类|合集|定时发布|发布/],
  },
  baijiahao: {
    label: '百家号',
    url: 'https://baijiahao.baidu.com/builder/rc/edit?type=video',
    uploadSelectors: [
      'div._5eb0d99a7a8a2180-inputWrap input[type="file"]',
      'input[type="file"]',
    ],
    completionHints: [/基础信息|标题|封面|分类|标签|原创|声明|发布|存草稿|合集|活动/],
  },
  zhihu: {
    label: '知乎',
    url: 'https://zhuanlan.zhihu.com/write',
    preUploadText: '视频',
    uploadSelectors: [
      'input.VideoUploadButton-fileInput',
      '.Modal-content input[type="file"]',
      'input[type="file"]',
    ],
    completionHints: [/视频|导入视频|选择已发布的视频|上传|发布设置|发布|封面|标题/],
  },
}

export function isVideoPublishPost(post = {}) {
  return post.contentType === 'video'
    || post.type === 'video'
    || post.kind === 'video'
    || !!post.videoPath
    || !!post.video?.path
    || !!post.video?.filePath
}

export function normalizeVideoPublishPost(post = {}) {
  const videoPath = post.videoPath || post.video?.path || post.video?.filePath || post.video?.absolutePath
  if (!videoPath) throw new Error('视频发布缺少 videoPath')
  const absoluteVideoPath = path.resolve(videoPath)
  if (!fs.existsSync(absoluteVideoPath)) throw new Error(`视频文件不存在: ${absoluteVideoPath}`)
  const coverPath = post.coverPath || post.videoCoverPath || post.cover?.path || post.cover?.filePath || post.cover?.absolutePath || post.images?.[0]
  const coverLandscapePath = post.coverLandscapePath || post.coverPaths?.landscape4x3 || post.cover?.landscape4x3?.absolutePath || post.cover?.landscape4x3
  const coverPortraitPath = post.coverPortraitPath || post.coverPaths?.portrait3x4 || post.cover?.portrait3x4?.absolutePath || post.cover?.portrait3x4
  const absoluteCoverPath = coverPath ? path.resolve(coverPath) : null
  const absoluteCoverLandscapePath = coverLandscapePath ? path.resolve(coverLandscapePath) : null
  const absoluteCoverPortraitPath = coverPortraitPath ? path.resolve(coverPortraitPath) : null
  return {
    ...post,
    contentType: 'video',
    dryRun: !!post.dryRun,
    title: post.title || path.basename(absoluteVideoPath, path.extname(absoluteVideoPath)),
    content: post.content || post.description || '',
    description: post.description || post.content || '',
    videoPath: absoluteVideoPath,
    coverPath: absoluteCoverPath && fs.existsSync(absoluteCoverPath) ? absoluteCoverPath : null,
    coverLandscapePath: absoluteCoverLandscapePath && fs.existsSync(absoluteCoverLandscapePath) ? absoluteCoverLandscapePath : null,
    coverPortraitPath: absoluteCoverPortraitPath && fs.existsSync(absoluteCoverPortraitPath) ? absoluteCoverPortraitPath : null,
    coverPaths: {
      landscape4x3: absoluteCoverLandscapePath && fs.existsSync(absoluteCoverLandscapePath) ? absoluteCoverLandscapePath : null,
      portrait3x4: absoluteCoverPortraitPath && fs.existsSync(absoluteCoverPortraitPath) ? absoluteCoverPortraitPath : null,
    },
  }
}

export function assertVideoDryRunOnly(post) {
  if (!post.dryRun) {
    throw new Error('视频发布当前只允许 dryRun=true：已阻止真实发布点击')
  }
}

export async function clickExactText(page, text) {
  return page.evaluate((targetText) => {
    const norm = s => (s || '').replace(/[\s\u200B\u3000]+/g, '').trim()
    const visible = el => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
    }
    const candidates = [...document.querySelectorAll('button, a, [role="button"], label, div, span')]
      .filter(el => visible(el) && norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '') === targetText)
    const source = candidates[0]
    if (!source) return { ok: false, reason: `not-found:${targetText}` }
    const target = source.closest('button, a, [role="button"], label') || source
    target.scrollIntoView({ block: 'center', inline: 'center' })
    target.click()
    return { ok: true, tag: target.tagName, text: norm(target.innerText || target.textContent || '') }
  }, text)
}

export async function uploadFirstMatchingFileInput(page, selectors, filePath) {
  const tried = []
  for (const selector of selectors) {
    const handles = await page.$$(selector).catch(() => [])
    tried.push({ selector, count: handles.length })
    for (const handle of handles) {
      try {
        await handle.uploadFile(filePath)
        return { ok: true, selector, tried }
      } catch (err) {
        tried.push({ selector, error: err.message })
      }
    }
  }
  return { ok: false, tried }
}

export async function waitForVideoPublishReady(page, options = {}) {
  const {
    maxWaitMs = 480000,
    pollMs = 15000,
    readyPattern = /标题|简介|描述|封面|发布设置|作品声明|创作声明|话题|分类|发布|存草稿|定时发布|上传成功/,
    uploadingPattern = /上传中|上传进度|正在上传|解析中|处理中|转码中/,
  } = options
  const started = Date.now()
  let best = null
  let stableRounds = 0
  while (Date.now() - started < maxWaitMs) {
    await randomDelay(Math.max(300, pollMs - 500), pollMs + 500)
    const state = await collectVideoPublishState(page)
    const score = scoreVideoPublishState(state, readyPattern)
    state.score = score
    if (!best || score > best.score) {
      best = state
      stableRounds = 0
    } else {
      stableRounds += 1
    }
    const ready = readyPattern.test(state.bodyText || '') && (state.counts?.controls || 0) >= 6
    const stillUploading = uploadingPattern.test(state.bodyText || '')
    if (ready && !stillUploading && stableRounds >= 2) return { ready: true, state: best, waitedMs: Date.now() - started }
    if (ready && Date.now() - started > 180000 && stableRounds >= 3) return { ready: true, state: best, waitedMs: Date.now() - started }
  }
  return { ready: false, state: best || await collectVideoPublishState(page), waitedMs: Date.now() - started }
}

function scoreVideoPublishState(state, readyPattern) {
  const textScore = readyPattern.test(state.bodyText || '') ? 50 : 0
  return textScore + (state.counts?.controls || 0) + (state.checkables?.length || 0) * 2 + (state.buttons?.length || 0)
}

export async function collectVideoPublishState(page) {
  await page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const maxY = Math.min(document.body.scrollHeight || 0, 12000)
    for (let y = 0; y <= maxY; y += 900) {
      window.scrollTo(0, y)
      await wait(180)
    }
    window.scrollTo(0, 0)
  }).catch(() => {})

  return page.evaluate(() => {
    const norm = s => (s || '').replace(/[\s\u200B\u3000]+/g, ' ').trim()
    const compact = (s, n = 300) => norm(s).slice(0, n)
    const visible = el => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
    }
    const selectorHint = el => {
      const parts = []
      for (let cur = el, i = 0; cur && cur.nodeType === 1 && i < 6; cur = cur.parentElement, i++) {
        let part = cur.tagName.toLowerCase()
        if (cur.id) part += `#${cur.id}`
        const classes = String(cur.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        if (classes) part += `.${classes}`
        parts.unshift(part)
      }
      return parts.join(' > ')
    }
    const labelFor = el => {
      const id = el.getAttribute('id')
      const direct = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null
      const own = el.closest('label')
      const wrap = el.closest('li, section, form, [class*="item"], [class*="field"], [class*="form"], [class*="setting"], div')
      return compact(direct?.innerText || own?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || wrap?.innerText || '')
    }
    const toItem = el => {
      const item = {
        tag: el.tagName,
        type: el.getAttribute('type') || null,
        role: el.getAttribute('role') || null,
        text: compact(el.innerText || el.textContent || ''),
        label: labelFor(el),
        placeholder: el.getAttribute('placeholder'),
        value: el.value || el.getAttribute('value'),
        checked: typeof el.checked === 'boolean' ? el.checked : el.getAttribute('aria-checked'),
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        visible: visible(el),
        selectorHint: selectorHint(el),
      }
      if (el.tagName === 'SELECT') {
        item.options = [...el.options].map(o => ({ text: compact(o.text, 120), value: o.value, selected: o.selected }))
      }
      return item
    }
    const controls = [...document.querySelectorAll('input, textarea, select, button, label, a, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [aria-checked], [contenteditable="true"]')]
      .filter(el => visible(el) || ['file', 'checkbox', 'radio'].includes(el.getAttribute('type') || ''))
      .map(toItem)
    const bodyText = compact(document.body.innerText || '', 6000)
    const fields = controls.filter(x => ['INPUT', 'TEXTAREA', 'SELECT'].includes(x.tag) || x.role === 'textbox')
    const buttons = controls.filter(x => x.tag === 'BUTTON' || x.role === 'button')
    const checkables = controls.filter(x => ['checkbox', 'radio'].includes(x.type) || ['checkbox', 'radio', 'switch'].includes(x.role) || x.checked !== null)
    const fileInputs = controls.filter(x => x.type === 'file')
    return {
      url: location.href,
      title: document.title,
      bodyText,
      counts: {
        controls: controls.length,
        fields: fields.length,
        buttons: buttons.length,
        checkables: checkables.length,
        fileInputs: fileInputs.length,
      },
      controls,
      fields,
      buttons,
      checkables,
      fileInputs,
      capturedAt: new Date().toISOString(),
    }
  })
}

// ─── 跨平台字段写入层 ───────────────────────────────────────────────
// 统一的视频发布字段 schema：
//   title         标题（头条/知乎有独立标题，百家号无专门标题）
//   description   描述（百家号"作品描述"、知乎正文；头条无独立描述）
//   declareType   作品声明类别：
//                 fromSite | selfShot | aiGenerated | fictional | investment | health | quote
//   coverPath     封面本地绝对路径（三平台可选）

const TOUTIAO_DECLARE_TEXT = {
  fromSite: '取自站外',
  quote: '引用站内',
  selfShot: '自行拍摄',
  aiGenerated: 'AI生成',
  fictional: '虚构演绎，故事经历',
  investment: '投资观点，仅供参考',
  health: '健康医疗分享，仅供参考',
}

async function fillTextLikeFieldByPlaceholder(page, pattern, value) {
  return page.evaluate((p, v) => {
    const re = new RegExp(p)
    const cand = [...document.querySelectorAll('input, textarea')].find(el => {
      const ph = el.getAttribute('placeholder') || ''
      return re.test(ph)
    })
    if (!cand) return { ok: false, reason: 'field-not-found', pattern: p }
    const proto = cand.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    cand.focus()
    setter.call(cand, '')
    cand.dispatchEvent(new Event('input', { bubbles: true }))
    setter.call(cand, v)
    cand.dispatchEvent(new Event('input', { bubbles: true }))
    cand.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, tag: cand.tagName, value: cand.value }
  }, pattern, value)
}

async function fillContentEditableBySize(page, value) {
  return page.evaluate((v) => {
    const cands = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 200 && r.height > 20 && r.top < window.innerHeight * 2
      })
    if (!cands.length) return { ok: false, reason: 'no-contenteditable' }
    cands.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)
    const edit = cands[0]
    edit.scrollIntoView({ block: 'center' })
    edit.focus()
    // 反复全选 + delete 清空（处理 Lexical/Draft 这类自带"output"占位的编辑器）
    for (let i = 0; i < 6; i++) {
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(edit)
      sel.removeAllRanges()
      sel.addRange(range)
      const cur = edit.innerText || ''
      if (!cur.trim()) break
      document.execCommand('delete', false, null)
    }
    document.execCommand('insertText', false, v)
    return { ok: true, text: (edit.innerText || '').slice(0, 200) }
  }, value)
}

async function clickCheckboxLabelByText(page, textOrRegex, wrapperSelector = 'label') {
  return page.evaluate((txt, wrapSel) => {
    const match = (el) => {
      const t = (el.innerText || '').replace(/[\s\u200B\u3000]+/g, '').trim()
      if (txt instanceof Object && txt.source) return new RegExp(txt.source, txt.flags || '').test(t)
      return t === txt
    }
    const labels = [...document.querySelectorAll(wrapSel)].filter(match)
    if (!labels.length) return { ok: false, reason: `label-not-found:${txt}` }
    const label = labels[0]
    label.scrollIntoView({ block: 'center' })
    const clickTarget = label.querySelector('.cheetah-wave-target, .cheetah-checkbox, .byte-checkbox') || label
    clickTarget.click()
    const input = label.querySelector('input[type="checkbox"], input[type="radio"]')
    return { ok: true, checked: !!input?.checked, labelText: label.innerText?.slice(0, 40) }
  }, textOrRegex, wrapperSelector)
}

// 仅返回"看起来是图片输入"的 file input：
//   - accept 不含 video/、不含 *
//   - 自身或父链 className 不含 video / xigua-upload-video / webuploader
//   - 优先 accept 含 image/*，其次无 accept 但父链文字含"封面"
async function probeImageFileInputs(page, sectionTextRegex) {
  return page.evaluate((patternStr) => {
    const re = new RegExp(patternStr)
    const isVideoInput = (el) => {
      const accept = (el.getAttribute('accept') || '').toLowerCase()
      if (accept.includes('video') || accept.includes('.mp4') || accept.includes('.mov')) return true
      // 没有 accept：只有当 class 链含明显视频关键词且不含 cover/image 时才判定
      if (!accept) {
        let cls = ''
        for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
          cls += ' ' + ((cur.className || '') + '').toLowerCase()
        }
        if (/(xigua-upload-video|video-upload|webuploader-element|upload-video-trigger)/.test(cls)
            && !/(cover|image|thumb)/.test(cls)) return true
      }
      return false
    }
    const isImageInput = (el) => {
      const accept = (el.getAttribute('accept') || '').toLowerCase()
      if (accept.includes('image') || accept.includes('jpg') || accept.includes('png')) return true
      // 没 accept 但父链 class 含 cover/image
      if (!accept) {
        let cls = ''
        for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
          cls += ' ' + ((cur.className || '') + '').toLowerCase()
        }
        if (/(cover|image-upload|upload-image|thumb-upload|upload-cover)/.test(cls)) return true
      }
      return false
    }
    const inSection = (el) => {
      for (let cur = el.parentElement, i = 0; cur && i < 20; cur = cur.parentElement, i++) {
        const t = cur.innerText || ''
        if (re.test(t)) return true
      }
      return false
    }
    const allInputs = [...document.querySelectorAll('input[type="file"]')]
    const diagnostic = allInputs.map((el, i) => {
      let cls = ''
      for (let cur = el; cur && cur !== document.body && cls.length < 200; cur = cur.parentElement) {
        cls += ' ' + ((cur.className || '') + '').slice(0, 40)
      }
      return {
        idx: i,
        accept: el.getAttribute('accept') || null,
        classChain: cls.trim().slice(0, 240),
        isVideo: isVideoInput(el),
        isImage: isImageInput(el),
        inSection: inSection(el),
      }
    })
    const candidates = allInputs
      .filter(el => !isVideoInput(el))
      .filter(el => isImageInput(el) || inSection(el))
    const result = candidates.map(el => {
      if (!el.id) el.id = 'zeno-dryrun-cover-' + Math.random().toString(36).slice(2)
      const accept = el.getAttribute('accept') || null
      let cls = ''
      for (let cur = el; cur && cur !== document.body && cls.length < 200; cur = cur.parentElement) {
        cls += ' ' + (cur.className || '').toString().slice(0, 40)
      }
      return { id: el.id, accept, ancestryClass: cls.trim() }
    })
    return { count: result.length, candidates: result, totalFileInputs: allInputs.length, diagnostic }
  }, sectionTextRegex.source)
}

async function uploadCoverInSection(page, sectionTextRegex, filePath, opts = {}) {
  const { triggerTexts = [] } = opts
  const probe = await probeImageFileInputs(page, sectionTextRegex)
  // 1. 直接挑第一个能用的图片 file input
  for (const cand of probe.candidates) {
    const handle = await page.$(`#${cand.id}`)
    if (!handle) continue
    try {
      await handle.uploadFile(filePath)
      return { ok: true, mode: 'direct-input', selector: `#${cand.id}`, accept: cand.accept, ancestryClass: cand.ancestryClass, totalFileInputs: probe.totalFileInputs }
    } catch (err) {
      // 继续下一个
    }
  }
  // 2. 触发模式：参考文章发布封面的实现 —— 用 ElementHandle.click()（trusted）
  //    点完后等 image-accept 的 file input 被动态注入，然后 uploadFile。
  const triggerLog = []
  for (const text of triggerTexts) {
    const triggerSel = await page.evaluate((t) => {
      const norm = s => (s || '').replace(/[\s\u200B\u3000]+/g, '').trim()
      const all = [...document.querySelectorAll('button, a, [role="button"], label, div, span, p, h3, h4')]
      let cand = all.filter(el => norm(el.innerText || '') === t)
      if (!cand.length) {
        cand = all.filter(el => {
          const inner = el.innerText || ''
          return inner.includes(t) && inner.length < 40
        })
      }
      const textEl = cand[0]
      if (!textEl) return null
      // 向上找尺寸够大的可点击祖先（虚线封面框、父按钮等）
      let clickable = textEl
      for (let cur = textEl, i = 0; cur && i < 6; cur = cur.parentElement, i++) {
        const r = cur.getBoundingClientRect()
        if (r.width < 80 || r.height < 60) continue
        const cs = getComputedStyle(cur)
        const looksClickable = ['BUTTON', 'A'].includes(cur.tagName)
          || cur.getAttribute('role') === 'button'
          || cs.cursor === 'pointer'
        if (looksClickable) { clickable = cur; break }
      }
      clickable.scrollIntoView({ block: 'center' })
      if (!clickable.id) clickable.id = 'zeno-dryrun-trigger-' + Math.random().toString(36).slice(2)
      return `#${clickable.id}`
    }, text).catch(() => null)
    if (!triggerSel) { triggerLog.push({ text, found: false }); continue }

    const handle = await page.$(triggerSel)
    if (!handle) { triggerLog.push({ text, found: false, reason: 'handle-lost' }); continue }

    // 2a. 提前挂监听：等任意 image accept 的 file input 注入或现有 input 变 visible
    const waitImageInput = page.waitForFunction(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')]
      return inputs.some(el => {
        const accept = (el.getAttribute('accept') || '').toLowerCase()
        if (!accept) return false
        if (accept.includes('video') || accept.includes('mp4')) return false
        return accept.includes('image') || accept.includes('jpg') || accept.includes('png') || accept.includes('jpeg')
      })
    }, { timeout: 6000 }).catch(() => null)

    let clickErr = null
    try { await handle.click({ delay: 30 }) } catch (err) { clickErr = err.message }
    triggerLog.push({ text, triggerSel, clickErr })

    const found = await waitImageInput
    if (found) {
      const sel = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="file"]')]
        const target = inputs.find(el => {
          const accept = (el.getAttribute('accept') || '').toLowerCase()
          return accept && !accept.includes('video') && !accept.includes('mp4')
            && (accept.includes('image') || accept.includes('jpg') || accept.includes('png'))
        })
        if (!target) return null
        if (!target.id) target.id = 'zeno-dryrun-image-input-' + Math.random().toString(36).slice(2)
        return `#${target.id}`
      })
      if (sel) {
        const inputHandle = await page.$(sel)
        if (inputHandle) {
          try {
            await inputHandle.uploadFile(filePath)
            return { ok: true, mode: 'click-then-image-input', triggerText: text, selector: sel, totalFileInputs: probe.totalFileInputs }
          } catch (err) {
            triggerLog.push({ text, uploadErr: err.message })
          }
        }
      }
    }

    // 2b. 兜底：原生 file chooser（少数站点会真的弹原生对话框）
    try {
      const chooser = await page.waitForFileChooser({ timeout: 1500 })
      await chooser.accept([filePath])
      return { ok: true, mode: 'file-chooser-fallback', triggerText: text, totalFileInputs: probe.totalFileInputs }
    } catch { /* 没原生对话框 */ }
  }
  return { ok: false, reason: 'no-image-input', probe, triggerLog }
}

async function uploadZhihuVideoCover(page, filePath) {
  await page.keyboard.press('Escape').catch(() => {})
  await new Promise(r => setTimeout(r, 800))
  const inputInfo = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')]
    const diagnostics = inputs.map((el, idx) => {
      let textChain = ''
      let classChain = ''
      for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
        textChain += ' ' + (cur.innerText || cur.textContent || '')
        classChain += ' ' + String(cur.className || '')
      }
      return {
        idx,
        accept: el.getAttribute('accept') || '',
        id: el.id || '',
        text: textChain.replace(/\s+/g, ' ').trim().slice(0, 240),
        classChain: classChain.replace(/\s+/g, ' ').trim().slice(0, 240),
      }
    })
    const target = inputs.find(el => {
      const accept = (el.getAttribute('accept') || '').toLowerCase()
      let textChain = ''
      let classChain = ''
      for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
        textChain += ' ' + (cur.innerText || cur.textContent || '')
        classChain += ' ' + String(cur.className || '')
      }
      return accept.includes('image/')
        && /上传视频封面/.test(textChain)
        && !/pdf|doc|xlsx|xls|ppt|csv|epub|mobi|azw3/.test(accept)
        && !/UploadPicture-input/.test(classChain)
    })
    if (!target) return { ok: false, reason: 'zhihu-video-cover-input-not-found', diagnostics }
    const token = `zhihu-video-cover-${Date.now()}-${Math.random().toString(36).slice(2)}`
    target.dataset.zenoZhihuVideoCover = token
    return {
      ok: true,
      selector: `input[data-zeno-zhihu-video-cover="${token}"]`,
      accept: target.getAttribute('accept') || '',
      diagnostics,
    }
  })
  if (!inputInfo.ok) return inputInfo
  const inputHandle = await page.$(inputInfo.selector)
  if (!inputHandle) return { ok: false, reason: 'zhihu-video-cover-input-handle-lost', diagnostics: inputInfo.diagnostics }
  try {
    await inputHandle.uploadFile(filePath)
  } catch (err) {
    return { ok: false, reason: 'zhihu-video-cover-upload-failed', detail: err.message, diagnostics: inputInfo.diagnostics }
  }
  await new Promise(r => setTimeout(r, 5000))
  const applied = await page.evaluate(() => {
    const body = document.body.innerText || ''
    const hasWrongFileDialog = /选择文件/.test(body) && /请选择文件/.test(body)
    const hasVideoCoverText = /上传视频封面|好的标题可以获得更多的推荐及关注者/.test(body)
    return { ok: !hasWrongFileDialog && hasVideoCoverText, hasWrongFileDialog, hasVideoCoverText }
  }).catch(err => ({ ok: false, reason: err.message }))
  return { ok: applied.ok, mode: 'zhihu-video-cover-input', selector: inputInfo.selector, accept: inputInfo.accept, applied, diagnostics: inputInfo.diagnostics }
}

// 头条视频发布专用：点击 .fake-upload-trigger 弹出"上传封面"对话框，
// 对话框里会自动注入 input[type=file][accept*="image"]，直接 uploadFile 即可。
async function uploadToutiaoVideoCover(page, filePath) {
  // 0. 清场：关掉可能遮挡的 "我知道了" 气泡 + 按 Esc 关掉之前残留的 modal
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, span, div')]
      .find(el => (el.innerText || '').trim() === '我知道了')
    btn?.click()
  }).catch(() => {})
  const hasCoverEditor = await page.evaluate(() => {
    return [...document.querySelectorAll('*')].some(el => /封面编辑/.test(el.innerText || el.textContent || ''))
  }).catch(() => false)
  if (!hasCoverEditor) {
    await page.keyboard.press('Escape').catch(() => {})
    await new Promise(r => setTimeout(r, 600))
  }

  const triggerSel = 'div.fake-upload-trigger'

  const applyCoverConfirm = async () => page.evaluate(() => {
    const norm = s => (s || '').replace(/[\s\u200B\u3000]+/g, '').trim()
    const visible = el => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const editorOpen = [...document.querySelectorAll('*')]
      .some(el => visible(el) && norm(el.innerText || el.textContent).includes('封面编辑'))
    if (!editorOpen) return { ok: false, reason: 'cover-editor-not-open' }
    const inCoverEditor = el => {
      for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
        const text = cur.innerText || cur.textContent || ''
        if (/封面编辑|重选封面|添加文字/.test(text)) return true
      }
      return false
    }
    const buttons = [...document.querySelectorAll('button, [role="button"], span, div')]
      .filter(el => visible(el) && norm(el.innerText || el.textContent) === '确定' && !el.hasAttribute('disabled') && inCoverEditor(el))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect()
        const br = b.getBoundingClientRect()
        return (ar.width * ar.height) - (br.width * br.height)
      })
    const btn = buttons[0]
    if (!btn) return { ok: false, reason: 'cover-confirm-button-not-found' }
    btn.click()
    return { ok: true, text: norm(btn.innerText || btn.textContent), tag: btn.tagName }
  }).catch(err => ({ ok: false, reason: 'cover-confirm-click-failed', detail: err.message }))

  const confirmCoverCompletionDialog = async () => {
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('*')]
        .some(el => /完成后无法继续编辑|是否确定完成/.test(el.innerText || el.textContent || ''))
    }, { timeout: 3000 }).catch(() => null)
    const target = await page.evaluate(() => {
      const norm = s => (s || '').replace(/[\s\u200B\u3000]+/g, '').trim()
      const visible = el => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      }
      const boxes = [...document.querySelectorAll('*')]
        .filter(visible)
        .filter(el => {
          const text = el.innerText || el.textContent || ''
          return /完成后无法继续编辑|是否确定完成/.test(text) && /取消/.test(text) && /确定/.test(text)
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect()
          const br = b.getBoundingClientRect()
          return (ar.width * ar.height) - (br.width * br.height)
        })
      const dialog = boxes[0]
      if (!dialog) return { ok: true, skipped: true, reason: 'no-cover-completion-dialog' }
      const buttons = [...dialog.querySelectorAll('button, [role="button"], span, div')]
        .filter(el => visible(el) && norm(el.innerText || el.textContent) === '确定' && !el.hasAttribute('disabled'))
        .sort((a, b) => {
          const ar = a.getBoundingClientRect()
          const br = b.getBoundingClientRect()
          return (ar.width * ar.height) - (br.width * br.height)
        })
      const btn = buttons[0]
      if (!btn) return { ok: false, reason: 'cover-completion-confirm-button-not-found' }
      const token = `completion-${Date.now()}-${Math.random().toString(36).slice(2)}`
      btn.dataset.zenoDryRunCompletionConfirm = token
      return { ok: true, selector: `button[data-zeno-dry-run-completion-confirm="${token}"], [data-zeno-dry-run-completion-confirm="${token}"]`, text: norm(btn.innerText || btn.textContent), tag: btn.tagName }
    }).catch(err => ({ ok: false, reason: 'cover-completion-confirm-click-failed', detail: err.message }))
    if (!target.ok || target.skipped) return target
    const handle = await page.$(target.selector)
    if (!handle) return { ok: false, reason: 'cover-completion-confirm-handle-lost' }
    await handle.click({ delay: 30 }).catch(async () => {
      const box = await handle.boundingBox()
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    })
    const gone = await page.waitForFunction(() => {
      return ![...document.querySelectorAll('*')]
        .some(el => /完成后无法继续编辑|是否确定完成/.test(el.innerText || el.textContent || ''))
    }, { timeout: 5000 }).then(() => true).catch(() => false)
    if (!gone) return { ok: false, reason: 'cover-completion-dialog-still-open', text: target.text, tag: target.tag }
    return { ok: true, text: target.text, tag: target.tag }
  }

  const getCoverInputSelector = async (beforeIds = []) => page.evaluate((ids) => {
    const before = new Set(ids)
    const inputs = [...document.querySelectorAll('input[type="file"]')]
    const info = inputs.map((el, idx) => {
      if (!el.dataset.zenoDryRunInputId) el.dataset.zenoDryRunInputId = `input-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`
      const accept = (el.getAttribute('accept') || '').toLowerCase()
      let classChain = ''
      let textChain = ''
      for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
        classChain += ` ${cur.className || ''}`.toLowerCase()
        textChain += ` ${cur.innerText || ''}`
      }
      const isVideo = accept.includes('video') || accept.includes('.mp4') || accept.includes('.mov')
        || /(xigua-upload-video|video-upload|upload-video-trigger)/.test(classChain)
      const isImage = accept.includes('image') || accept.includes('jpg') || accept.includes('jpeg') || accept.includes('png')
        || /(poster|cover|image|thumb|upload-poster|xigua-upload-poster)/.test(classChain)
        || /封面|图片|本地上传/.test(textChain)
      return { el, id: el.dataset.zenoDryRunInputId, accept, isVideo, isImage, isNew: !before.has(el.dataset.zenoDryRunInputId) }
    })
    const candidates = info
      .filter(item => !item.isVideo && item.isImage)
      .sort((a, b) => Number(b.isNew) - Number(a.isNew))
    const target = candidates[0]?.el
    if (!target) {
      return {
        selector: null,
        diagnostic: info.map(({ id, accept, isVideo, isImage, isNew }) => ({ id, accept, isVideo, isImage, isNew }))
      }
    }
    const token = `cover-${Date.now()}-${Math.random().toString(36).slice(2)}`
    target.dataset.zenoDryRunCoverInput = token
    return {
      selector: `input[type="file"][data-zeno-dry-run-cover-input="${token}"]`,
      diagnostic: info.map(({ id, accept, isVideo, isImage, isNew }) => ({ id, accept, isVideo, isImage, isNew }))
    }
  }, beforeIds)

  async function attempt() {
    const existingConfirm = await applyCoverConfirm()
    if (existingConfirm.ok) {
      const completionConfirm = await confirmCoverCompletionDialog()
      if (!completionConfirm.ok) return { ok: false, reason: completionConfirm.reason, detail: completionConfirm.detail }
      await page.waitForFunction(() => {
        return ![...document.querySelectorAll('*')].some(el => /封面编辑/.test(el.innerText || el.textContent || ''))
      }, { timeout: 8000 }).catch(() => null)
      return { ok: true, mode: 'existing-cover-editor-confirmed', applyCover: existingConfirm, completionConfirm }
    }
    const trigger = await page.$(triggerSel)
    if (!trigger) return { ok: false, reason: 'fake-upload-trigger-not-found' }
    const beforeIds = await page.evaluate(() => {
      return [...document.querySelectorAll('input[type="file"]')].map((el, idx) => {
        if (!el.dataset.zenoDryRunInputId) el.dataset.zenoDryRunInputId = `input-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`
        return el.dataset.zenoDryRunInputId
      })
    }).catch(() => [])
    await page.evaluate((el) => el.scrollIntoView({ block: 'center' }), trigger)
    try { await trigger.click({ delay: 30 }) } catch (err) { return { ok: false, reason: 'trigger-click-failed', detail: err.message } }
    await page.waitForFunction(() => {
      const norm = s => (s || '').replace(/[\s\u200B\u3000]+/g, '')
      return [...document.querySelectorAll('*')]
        .some(el => norm(el.innerText || el.textContent).includes('本地上传'))
    }, { timeout: 5000 }).catch(() => null)
    const localUploadTab = await page.evaluate(() => {
      const norm = s => (s || '').replace(/[\s\u200B\u3000]+/g, '')
      const visible = el => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      }
      const tabs = [...document.querySelectorAll('*')]
        .filter(el => visible(el) && norm(el.innerText || el.textContent).includes('本地上传'))
        .sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length)
      const tab = tabs[0]
      if (!tab) return { ok: false, reason: 'local-upload-tab-not-found' }
      tab.click()
      return { ok: true }
    }).catch(err => ({ ok: false, reason: 'local-upload-tab-click-failed', detail: err.message }))
    if (!localUploadTab.ok) return localUploadTab
    await page.waitForFunction(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')]
      return inputs.some(el => {
        const accept = (el.getAttribute('accept') || '').toLowerCase()
        let classChain = ''
        let textChain = ''
        for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
          classChain += ` ${cur.className || ''}`.toLowerCase()
          textChain += ` ${cur.innerText || ''}`
        }
        const isVideo = accept.includes('video') || accept.includes('.mp4') || accept.includes('.mov')
          || /(xigua-upload-video|video-upload|upload-video-trigger)/.test(classChain)
        const isImage = accept.includes('image') || accept.includes('jpg') || accept.includes('jpeg') || accept.includes('png')
          || /(poster|cover|image|thumb|upload-poster|xigua-upload-poster)/.test(classChain)
          || /封面|图片|本地上传/.test(textChain)
        return !isVideo && isImage
      })
    }, { timeout: 8000 }).catch(() => null)
    const inputInfo = await getCoverInputSelector(beforeIds)
    const inputHandle = inputInfo.selector ? await page.$(inputInfo.selector) : null
    if (!inputHandle) return { ok: false, reason: 'image-input-not-injected' }
    try {
      await inputHandle.uploadFile(filePath)
    } catch (err) {
      return { ok: false, reason: 'upload-file-failed', detail: err.message }
    }
    await new Promise(r => setTimeout(r, 2500))
    const applyCover = await applyCoverConfirm()
    if (!applyCover.ok) return { ok: false, reason: applyCover.reason, detail: applyCover.detail, diagnostic: inputInfo.diagnostic }
    const completionConfirm = await confirmCoverCompletionDialog()
    if (!completionConfirm.ok) return { ok: false, reason: completionConfirm.reason, detail: completionConfirm.detail, diagnostic: inputInfo.diagnostic }
    await page.waitForFunction(() => {
      return ![...document.querySelectorAll('*')].some(el => /封面编辑/.test(el.innerText || el.textContent || ''))
    }, { timeout: 8000 }).catch(() => null)
    return { ok: true, mode: 'fake-trigger-image-input-confirmed', applyCover, completionConfirm, diagnostic: inputInfo.diagnostic }
  }

  // 最多尝试 2 次：第一次失败后 Escape 清场再试
  let res = await attempt()
  if (!res.ok && res.reason === 'image-input-not-injected') {
    await page.keyboard.press('Escape').catch(() => {})
    await new Promise(r => setTimeout(r, 800))
    res = await attempt()
    res.retried = true
  }
  return res
}

async function expandBaijiahaoAdvanced(page) {
  return page.evaluate(() => {
    const hdrs = [...document.querySelectorAll('span, div, button')].filter(el => {
      const t = (el.innerText || '').trim()
      return t === '高级设置' || t === '展开' || t === '展开高级设置'
    })
    if (!hdrs.length) return { ok: false, reason: 'no-advanced-toggle' }
    hdrs[0].scrollIntoView({ block: 'center' })
    hdrs[0].click()
    return { ok: true }
  }).catch(err => ({ ok: false, error: err.message }))
}

export const PLATFORM_FIELD_WRITERS = {
  toutiao: {
    async title(page, value) {
      return fillTextLikeFieldByPlaceholder(page, '请输入.*字符|标题', value.slice(0, 30))
    },
    async description() {
      // 头条视频发布没有独立描述字段
      return { ok: false, skipped: true, reason: 'toutiao-no-description' }
    },
    async declareType(page, value) {
      const text = TOUTIAO_DECLARE_TEXT[value]
      if (!text) return { ok: false, reason: `unknown-declareType:${value}` }
      return clickCheckboxLabelByText(page, text, 'label.byte-checkbox')
    },
    async coverPath(page, value) {
      return uploadToutiaoVideoCover(page, value)
    },
  },
  baijiahao: {
    async title() {
      return { ok: false, skipped: true, reason: 'baijiahao-no-title (uses description)' }
    },
    async description(page, value) {
      return fillContentEditableBySize(page, value)
    },
    async declareType(page, value) {
      // 百家号创作声明目前只有一个开关："采用AI生成内容"
      if (value !== 'aiGenerated') {
        return { ok: false, reason: `baijiahao-declareType-only-supports-aiGenerated:got-${value}` }
      }
      const expanded = await expandBaijiahaoAdvanced(page)
      await new Promise(r => setTimeout(r, 600))
      const clicked = await clickCheckboxLabelByText(page, '采用AI生成内容', 'label.cheetah-checkbox-wrapper')
      return { ok: clicked.ok, expanded, clicked }
    },
    async coverPath(page, value) {
      return uploadCoverInSection(page, /设置封面|智能推荐封面|封面/, value, {
        triggerTexts: ['更换', '上传封面', '本地上传'],
      })
    },
  },
  zhihu: {
    async title(page, value) {
      return fillTextLikeFieldByPlaceholder(page, '标题', value.slice(0, 100))
    },
    async description() {
      // 知乎文章正文另有富文本编辑，视频模式下目前不自动填
      return { ok: false, skipped: true, reason: 'zhihu-description-left-to-richtext' }
    },
    async declareType() {
      return { ok: false, skipped: true, reason: 'zhihu-no-declareType-in-editor' }
    },
    async coverPath(page, value) {
      return uploadZhihuVideoCover(page, value)
    },
  },
}

export async function applyVideoFields(page, platform, fields = {}) {
  const writer = PLATFORM_FIELD_WRITERS[platform]
  if (!writer) throw new Error(`字段写入不支持的平台: ${platform}`)
  const ops = []
  const order = ['title', 'description', 'declareType', 'coverPath']
  for (const key of order) {
    const value = fields[key]
    if (value == null || value === '') continue
    const fn = writer[key]
    if (typeof fn !== 'function') { ops.push({ key, skipped: true, reason: 'no-writer' }); continue }
    try {
      const res = await fn(page, value)
      ops.push({ key, input: summarizeInput(key, value), result: res })
    } catch (err) {
      ops.push({ key, input: summarizeInput(key, value), error: err.message })
    }
    await new Promise(r => setTimeout(r, 800))
  }
  return ops
}

function summarizeInput(key, value) {
  if (key === 'coverPath') return value
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '…' : value
  return value
}

export async function runVideoPublishDryRun(adapter, platform, post) {
  const entry = VIDEO_PUBLISH_ENTRIES[platform]
  if (!entry) throw new Error(`视频发布 dryRun 未配置平台: ${platform}`)
  const normalized = normalizeVideoPublishPost(post)
  assertVideoDryRunOnly(normalized)
  adapter._dryRun = true
  adapter.log.info(`[videoDryRun] 开始 ${platform} 视频 dryRun：${normalized.videoPath}`)

  await adapter.showStatus?.(`${entry.label} 视频 dryRun：打开上传入口...`).catch(() => {})
  await adapter.navigateTo(entry.url)
  await randomDelay(4000, 6000)

  let preAction = null
  if (entry.preUploadText) {
    preAction = await clickExactText(adapter.page, entry.preUploadText).catch(err => ({ ok: false, reason: err.message }))
    adapter.log.info(`[videoDryRun] 入口点击 ${entry.preUploadText}: ${JSON.stringify(preAction)}`)
    await randomDelay(2500, 4000)
  }

  await adapter.showStatus?.(`${entry.label} 视频 dryRun：上传视频...`).catch(() => {})
  const upload = await uploadFirstMatchingFileInput(adapter.page, entry.uploadSelectors, normalized.videoPath)
  if (!upload.ok) {
    throw new Error(`[videoDryRun] 未找到可上传的视频 input: ${JSON.stringify(upload.tried)}`)
  }
  adapter.log.info(`[videoDryRun] 视频已上传到 ${platform}，等待发布选项就绪`)

  await adapter.showStatus?.(`${entry.label} 视频 dryRun：等待发布选项...`).catch(() => {})
  const waitResult = await waitForVideoPublishReady(adapter.page, {
    readyPattern: entry.completionHints?.[0] || /标题|简介|封面|发布设置/,
  })
  if (!waitResult.ready) {
    adapter.log.warn(`[videoDryRun] ${platform} 发布选项未完全就绪，仍返回已采集到的 UI 状态`)
  }

  // 按 schema 自动写入字段
  const fields = {
    title: normalized.title,
    description: normalized.description,
    declareType: normalized.declareType,
    coverPath: normalized.coverPath,
  }
  await adapter.showStatus?.(`${entry.label} 视频 dryRun：写入字段...`).catch(() => {})
  const fieldOps = await applyVideoFields(adapter.page, platform, fields)
  adapter.log.info(`[videoDryRun] ${platform} 字段写入：${JSON.stringify(fieldOps.map(o => ({ key: o.key, ok: o.result?.ok ?? !o.error })))}`)
  // 字段写入后重新采集一次 after 状态，便于上游对比
  const afterState = await collectVideoPublishState(adapter.page)
  await adapter.hideStatus?.().catch(() => {})

  return buildVideoDryRunResult(adapter, platform, normalized, { ...upload, preAction }, waitResult, { fieldOps, afterState })
}

export function buildVideoDryRunResult(adapter, platform, post, upload, waitResult, extras = {}) {
  const state = waitResult.state || {}
  const after = extras.afterState || state
  const videoDryRun = {
    platform,
    didClickFinalPublish: false,
    upload,
    ready: waitResult.ready,
    waitedMs: waitResult.waitedMs,
    finalUrl: after.url || state.url,
    counts: after.counts || state.counts,
    fields: after.fields || state.fields || [],
    checkables: after.checkables || state.checkables || [],
    buttons: after.buttons || state.buttons || [],
    fileInputs: after.fileInputs || state.fileInputs || [],
    bodyEvidence: (after.bodyText || state.bodyText || '').slice(0, 2000),
    fieldOps: extras.fieldOps || [],
  }
  adapter.addStepEvidence('videoDryRun', {
    platform,
    videoPath: post.videoPath,
    upload,
    ready: waitResult.ready,
    counts: state.counts,
    didClickFinalPublish: false,
  })
  const base = adapter.buildResult(true, `${platform} 视频 dryRun 完成：已上传并采集发布选项，未点击发布`, {
    publishedUrl: null,
  })
  return { ...base, contentType: 'video', dryRun: true, videoDryRun }
}
