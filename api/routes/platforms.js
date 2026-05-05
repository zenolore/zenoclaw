/**
 * /api/platforms — 平台清单与健康矩阵
 *
 * 提供两个接口：
 *   GET /api/platforms        平台基础列表（兼容原行为）
 *   GET /api/platforms/health 详细健康矩阵：四条链路状态、reader 占位、互动选择器缺口
 *
 * 此路由完全只读，不修改任何文件，对外部程序也可直接调用消费。
 */
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { listPlatforms, loadAdapter, loadReader, loadBrowser, getPlatformMeta } from '../../platforms/loader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const platformsDir = path.resolve(__dirname, '..', '..', 'platforms')

export const platformsRouter = Router()

// ============================================================
// 平台中文标签（与 server.js 对齐）
// ============================================================
const PLATFORM_LABELS = {
  xiaohongshu: '小红书', zhihu: '知乎', weibo: '微博', douyin: '抖音',
  bilibili: 'B站', x: 'X (Twitter)', reddit: 'Reddit', jike: '即刻',
  sspai: '少数派', producthunt: 'Product Hunt',
  douban: '豆瓣', jianshu: '简书',
  toutiao: '今日头条', channels: '视频号',
  baijiahao: '百家号', sohu: '搜狐号', wechat: '微信公众号',
  dayu: '大鱼号', netease: '网易号', qq: '企鹅号',
}

const REQUIRED_INTERACT_KEYS = ['like', 'comment_input', 'comment_submit', 'follow']

// 5 个核心平台是否需要 browse（视频号 / 公众号免）
const BROWSE_OPTIONAL_PLATFORMS = new Set(['channels', 'wechat'])

const OPERATION_PLATFORMS = new Set(['toutiao', 'baijiahao', 'douyin', 'channels', 'zhihu', 'bilibili', 'wechat'])

const COMMENT_REPLIER_FILES = {
  toutiao: 'comment-replier.js',
  baijiahao: 'comment-replier.js',
  bilibili: 'comment-replier.js',
}

const VERIFIED_WEB_E2E = {
  toutiao: { accountStats: true, comments: true, replyDryRun: true, testedAt: '2026-05-02T13:22:00.000Z' },
  baijiahao: { accountStats: true, comments: true, replyDryRun: true, testedAt: '2026-05-02T13:22:00.000Z' },
  douyin: { accountStats: true, testedAt: '2026-05-02T13:22:00.000Z' },
  channels: { accountStats: true, testedAt: '2026-05-02T13:22:00.000Z' },
  zhihu: { accountStats: true, zhihuQuestions: true, zhihuAnswerDryRun: true, testedAt: '2026-05-02T13:22:00.000Z' },
  bilibili: { accountStats: true, comments: true, replyDryRun: true, testedAt: '2026-05-02T13:22:00.000Z' },
  wechat: { accountStats: true, comments: true, testedAt: '2026-05-02T13:22:00.000Z' },
}

// ============================================================
// 工具：提取 publish() 函数体（用于检测 runStep 覆盖）
// ============================================================
function extractPublishBody(source) {
  const match = source.match(/async\s+publish\s*\(\s*post\s*\)\s*\{/)
  if (!match) return ''
  const start = match.index + match[0].length
  let depth = 1
  let i = start
  while (i < source.length && depth > 0) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  return source.slice(start, i - 1)
}

// ============================================================
// 单个平台健康分析
// ============================================================
async function analyzePlatform(name) {
  const dir = path.join(platformsDir, name)
  const publisherFile = path.join(dir, 'publisher.js')
  const readerFile = path.join(dir, 'reader.js')
  const browseFile = path.join(dir, 'browse.js')

  const hasPublisher = fs.existsSync(publisherFile)
  const hasReader = fs.existsSync(readerFile)
  const hasBrowse = fs.existsSync(browseFile)

  // ---- 发布链路：publish() 是否使用 runStep / 是否还有直接 stepX 调用 ----
  let publishStatus = { hasPublish: false, usesRunStep: false, hasDirectStep: false }
  if (hasPublisher) {
    try {
      const src = fs.readFileSync(publisherFile, 'utf8')
      const body = extractPublishBody(src)
      publishStatus = {
        hasPublish: body.length > 0,
        usesRunStep: /this\.runStep\s*\(/.test(body),
        hasDirectStep: /await\s+this\.step[0-9a-zA-Z_]*\s*\(/.test(body),
      }
    } catch { /* ignore parse error */ }
  }

  // ---- 数据采集：reader 是否占位 ----
  let readerStatus = { hasReader, isPlaceholder: false, errorMessage: null }
  if (hasReader) {
    try {
      const ReaderClass = await loadReader(name)
      const instance = new ReaderClass(null)
      readerStatus.isPlaceholder = !!instance.isPlaceholder
    } catch (err) {
      readerStatus.errorMessage = err.message
    }
  }

  // ---- 养号浏览：browse 是否占位选择器 ----
  let browseStatus = {
    hasBrowse,
    isPlaceholderSelectors: false,
    homeUrl: null,
    needBrowse: !BROWSE_OPTIONAL_PLATFORMS.has(name),
    errorMessage: null,
  }
  if (hasBrowse) {
    try {
      const BrowseClass = await loadBrowser(name)
      const instance = new BrowseClass(null)
      browseStatus.isPlaceholderSelectors = !!instance.isPlaceholderSelectors
      const sel = typeof instance.getBrowseSelectors === 'function' ? instance.getBrowseSelectors() : null
      browseStatus.homeUrl = sel?.homeUrl || null
    } catch (err) {
      browseStatus.errorMessage = err.message
    }
  }

  // ---- 互动选择器：每个必要字段是否非空 ----
  let interactStatus = {
    hasSelectors: false,
    fields: {},
    missingFields: [],
    errorMessage: null,
  }
  if (hasPublisher) {
    try {
      const AdapterClass = await loadAdapter(name)
      const instance = new AdapterClass(null)
      const sel = typeof instance.getInteractSelectors === 'function' ? instance.getInteractSelectors() : null
      if (sel && typeof sel === 'object') {
        interactStatus.hasSelectors = true
        for (const key of REQUIRED_INTERACT_KEYS) {
          const arr = Array.isArray(sel[key]) ? sel[key] : []
          interactStatus.fields[key] = {
            count: arr.length,
            filled: arr.length > 0,
          }
          if (arr.length === 0) interactStatus.missingFields.push(key)
        }
      } else {
        interactStatus.missingFields = [...REQUIRED_INTERACT_KEYS]
      }
    } catch (err) {
      interactStatus.errorMessage = err.message
    }
  }

  // ---- 平台元数据 ----
  const meta = await getPlatformMeta(name).catch(() => ({ homeUrl: null, loginUrl: null }))

  // ---- 综合健康度评分（0-100，仅信息参考） ----
  const verified = VERIFIED_WEB_E2E[name] || null
  const score = computeHealthScore({ publishStatus, readerStatus, browseStatus, interactStatus, verified })
  const chainStatus = computeChainStatus(name, { publishStatus, readerStatus, browseStatus, interactStatus, verified })

  return {
    name,
    label: PLATFORM_LABELS[name] || name,
    homeUrl: meta.homeUrl,
    loginUrl: meta.loginUrl,
    capabilities: {
      publish: hasPublisher,
      read: hasReader,
      browse: hasBrowse,
      interact: interactStatus.hasSelectors,
    },
    health: {
      score,
      publish: publishStatus,
      read: readerStatus,
      browse: browseStatus,
      interact: interactStatus,
      verified,
      chainStatus,
    },
  }
}

function computeHealthScore({ publishStatus, readerStatus, browseStatus, interactStatus, verified }) {
  let total = 0
  let weight = 0

  // 发布：30 分（有 publish + 用 runStep + 无直接 step 调用）
  weight += 30
  if (publishStatus.hasPublish) total += 10
  if (publishStatus.usesRunStep) total += 10
  if (!publishStatus.hasDirectStep) total += 10

  // 采集：30 分（有 reader + 非占位）
  weight += 30
  if (verified?.accountStats) total += 30
  else {
    if (readerStatus.hasReader) total += 15
    if (readerStatus.hasReader && !readerStatus.isPlaceholder) total += 15
  }

  // 互动选择器：25 分（按字段比例）
  weight += 25
  if (verified?.replyDryRun || verified?.zhihuAnswerDryRun || verified?.comments) {
    total += 25
  } else if (interactStatus.hasSelectors) {
    const filled = REQUIRED_INTERACT_KEYS.filter(k => interactStatus.fields[k]?.filled).length
    total += Math.round((filled / REQUIRED_INTERACT_KEYS.length) * 25)
  }

  // 养号浏览：15 分（仅当需要养号；不需要的平台跳过这部分）
  if (browseStatus.needBrowse) {
    weight += 15
    if (browseStatus.hasBrowse) total += 7
    if (browseStatus.hasBrowse && !browseStatus.isPlaceholderSelectors) total += 8
  }

  return weight === 0 ? 0 : Math.round((total / weight) * 100)
}

function computeChainStatus(name, { publishStatus, readerStatus, browseStatus, interactStatus, verified }) {
  const publish =
    !publishStatus.hasPublish ? 'missing' :
    publishStatus.hasDirectStep ? 'partial' :
    publishStatus.usesRunStep ? 'good' : 'partial'

  const read =
    verified?.accountStats ? 'good' :
    !readerStatus.hasReader ? 'missing' :
    readerStatus.isPlaceholder ? 'partial' : 'good'

  const browse =
    !browseStatus.needBrowse ? 'na' :
    !browseStatus.hasBrowse ? 'missing' :
    browseStatus.isPlaceholderSelectors ? 'partial' : 'good'

  const interactVerified = verified?.replyDryRun || verified?.zhihuAnswerDryRun || verified?.comments
  const interact =
    interactVerified ? 'good' :
    !interactStatus.hasSelectors ? 'missing' :
    interactStatus.missingFields.length === 0 ? 'good' :
    interactStatus.missingFields.length < REQUIRED_INTERACT_KEYS.length ? 'partial' : 'missing'

  return { publish, read, browse, interact }
}

// ============================================================
// GET /api/platforms — 兼容原行为（简单列表）
// ============================================================
platformsRouter.get('/', async (req, res) => {
  try {
    const platforms = listPlatforms()
    const result = await Promise.all(platforms.map(async (name) => {
      const dir = path.join(platformsDir, name)
      const hasPublisher = fs.existsSync(path.join(dir, 'publisher.js'))
      const hasReader = fs.existsSync(path.join(dir, 'reader.js'))
      const hasBrowse = fs.existsSync(path.join(dir, 'browse.js'))
      const hasInteractFile = fs.existsSync(path.join(dir, 'interact.js'))
      const meta = await getPlatformMeta(name).catch(() => ({}))
      const hasInteract = hasInteractFile || !!meta.interactSelectors
      return {
        name,
        label: PLATFORM_LABELS[name] || name,
        capabilities: {
          publish: hasPublisher,
          read: hasReader,
          browse: hasBrowse,
          interact: hasInteract,
        },
        homeUrl: meta.homeUrl,
        loginUrl: meta.loginUrl,
      }
    }))
    res.json({ platforms: result })
  } catch (err) {
    res.status(500).json({ error: 'InternalError', message: err.message })
  }
})

// ============================================================
// GET /api/platforms/health — 详细健康矩阵
// ============================================================
platformsRouter.get('/health', async (req, res) => {
  try {
    const platforms = listPlatforms()
    const rows = await Promise.all(platforms.map(p => analyzePlatform(p)))

    // 总体统计
    const total = rows.length
    const publishOk = rows.filter(r => r.health.publish.usesRunStep && !r.health.publish.hasDirectStep).length
    const realReaders = rows.filter(r => r.health.verified?.accountStats || (r.health.read.hasReader && !r.health.read.isPlaceholder)).length
    const interactComplete = rows.filter(r =>
      r.health.verified?.replyDryRun ||
      r.health.verified?.zhihuAnswerDryRun ||
      r.health.verified?.comments ||
      r.health.interact.missingFields.length === 0
    ).length
    const browseReady = rows.filter(r => !r.health.browse.needBrowse || (r.health.browse.hasBrowse && !r.health.browse.isPlaceholderSelectors)).length

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalPlatforms: total,
        publishUsingRunStep: publishOk,
        realReaders,
        placeholderReaders: total - realReaders,
        interactSelectorsComplete: interactComplete,
        browseReady,
      },
      requiredInteractKeys: REQUIRED_INTERACT_KEYS,
      platforms: rows,
    })
  } catch (err) {
    res.status(500).json({ error: 'InternalError', message: err.message, stack: err.stack })
  }
})



// ============================================================
// 操作型 API：真实连接 Chrome 9222，调用已验证的 reader / replier / answerer
// ============================================================
async function connectChrome() {
  const port = Number(process.env.CHROME_DEBUG_PORT || 9222)
  let endpoint
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`)
    const info = await r.json()
    endpoint = info.webSocketDebuggerUrl
  } catch (err) {
    throw new Error(`无法连接 Chrome 调试端口 ${port}：${err.message}`)
  }
  return puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null })
}

async function createPage() {
  const browser = await connectChrome()
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 }).catch(() => {})
  return { browser, page }
}

async function createReader(platform, page) {
  const ReaderClass = await loadReader(platform)
  const reader = new ReaderClass(page)
  if (typeof reader.init === 'function') await reader.init()
  return reader
}

async function loadOperationClass(platform, fileName, exportName = null) {
  const modulePath = path.join(platformsDir, platform, fileName)
  if (!fs.existsSync(modulePath)) {
    throw new Error(`平台 ${platform} 不支持 ${fileName}`)
  }
  const mod = await import(pathToFileURL(modulePath).href)
  return (exportName && mod[exportName]) || mod.default || Object.values(mod).find(v => typeof v === 'function')
}

function ensureOperationPlatform(platform) {
  if (!OPERATION_PLATFORMS.has(platform)) {
    throw new Error(`当前只开放 7 个已验证平台：${[...OPERATION_PLATFORMS].join(', ')}`)
  }
}

function closeBrowser(browser) {
  try { browser?.disconnect?.() } catch {}
}

platformsRouter.get('/operations/capabilities', async (req, res) => {
  res.json({
    platforms: [...OPERATION_PLATFORMS].map(name => ({
      name,
      label: PLATFORM_LABELS[name] || name,
      canReadAccount: true,
      canReadComments: ['toutiao', 'baijiahao', 'bilibili', 'wechat'].includes(name),
      canReplyDryRun: ['toutiao', 'baijiahao', 'bilibili'].includes(name),
      canZhihuAnswer: name === 'zhihu',
    })),
  })
})

platformsRouter.get('/operations/video-publish-surfaces', async (req, res) => {
  try {
    const file = path.resolve(process.cwd(), 'data/video-publish-surfaces.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    res.json(data)
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

platformsRouter.get('/operations/video-publish-real-options', async (req, res) => {
  try {
    const file = path.resolve(process.cwd(), 'data/video-publish-real-options.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    res.json(data)
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

platformsRouter.post('/operations/account-stats', async (req, res) => {
  const platform = req.body?.platform
  let browser
  try {
    ensureOperationPlatform(platform)
    const ctx = await createPage()
    browser = ctx.browser
    const reader = await createReader(platform, ctx.page)
    if (typeof reader.readAccountStats !== 'function') {
      throw new Error(`${platform} reader 尚未实现 readAccountStats()`)
    }
    const data = await reader.readAccountStats()
    await ctx.page.close().catch(() => {})
    res.json({ ok: true, platform, label: PLATFORM_LABELS[platform] || platform, data })
  } catch (err) {
    res.status(500).json({ ok: false, platform, message: err.message })
  } finally {
    closeBrowser(browser)
  }
})

platformsRouter.post('/operations/comments', async (req, res) => {
  const platform = req.body?.platform
  const limit = Number(req.body?.limit || 10)
  let browser
  try {
    ensureOperationPlatform(platform)
    const ctx = await createPage()
    browser = ctx.browser
    const reader = await createReader(platform, ctx.page)
    if (typeof reader.readMyArticleComments !== 'function') {
      throw new Error(`${platform} reader 尚未实现 readMyArticleComments()`)
    }
    const comments = await reader.readMyArticleComments({ limit })
    await ctx.page.close().catch(() => {})
    res.json({ ok: true, platform, label: PLATFORM_LABELS[platform] || platform, comments })
  } catch (err) {
    res.status(500).json({ ok: false, platform, message: err.message })
  } finally {
    closeBrowser(browser)
  }
})

platformsRouter.post('/operations/reply-dryrun', async (req, res) => {
  const platform = req.body?.platform
  const matcher = req.body?.matcher || {}
  const replyText = req.body?.replyText || '感谢留言，已阅'
  let browser
  try {
    ensureOperationPlatform(platform)
    const fileName = COMMENT_REPLIER_FILES[platform]
    if (!fileName) throw new Error(`${platform} 暂未接入回评 dryRun`)
    const ctx = await createPage()
    browser = ctx.browser
    const ReplierClass = await loadOperationClass(platform, fileName)
    const replier = new ReplierClass(ctx.page)
    if (typeof replier.init === 'function') await replier.init()
    const result = await replier.replyToComment(matcher, replyText, { dryRun: true })
    await ctx.page.close().catch(() => {})
    res.json({ ok: result?.ok === true, platform, result })
  } catch (err) {
    res.status(500).json({ ok: false, platform, message: err.message })
  } finally {
    closeBrowser(browser)
  }
})

platformsRouter.post('/operations/zhihu-questions', async (req, res) => {
  const limit = Number(req.body?.limit || 10)
  let browser
  try {
    const ctx = await createPage()
    browser = ctx.browser
    const AnswererClass = await loadOperationClass('zhihu', 'answerer.js', 'ZhihuQuestionAnswerer')
    const answerer = new AnswererClass(ctx.page)
    if (typeof answerer.init === 'function') await answerer.init()
    const questions = await answerer.listFeaturedQuestions({ limit })
    await ctx.page.close().catch(() => {})
    res.json({ ok: true, platform: 'zhihu', questions })
  } catch (err) {
    res.status(500).json({ ok: false, platform: 'zhihu', message: err.message })
  } finally {
    closeBrowser(browser)
  }
})

platformsRouter.post('/operations/zhihu-answer-dryrun', async (req, res) => {
  const questionUrl = req.body?.questionUrl
  const answerText = req.body?.answerText || '这是一条 dryRun 测试回答，不会真正发布。'
  let browser
  try {
    const ctx = await createPage()
    browser = ctx.browser
    const AnswererClass = await loadOperationClass('zhihu', 'answerer.js', 'ZhihuQuestionAnswerer')
    const answerer = new AnswererClass(ctx.page)
    if (typeof answerer.init === 'function') await answerer.init()
    const detail = questionUrl ? await answerer.getQuestionDetail(questionUrl) : null
    const result = await answerer.submitAnswer(questionUrl, answerText, { dryRun: true })
    await ctx.page.close().catch(() => {})
    res.json({ ok: result?.ok === true, platform: 'zhihu', detail, result })
  } catch (err) {
    res.status(500).json({ ok: false, platform: 'zhihu', message: err.message })
  } finally {
    closeBrowser(browser)
  }
})

export default platformsRouter
