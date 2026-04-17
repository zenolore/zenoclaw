/**
 * ZenoClaw 全平台真实测试脚本
 * 
 * 测试范围: 发布(publish) + 数据读取(read) + 养号浏览(browse)
 * 9 个平台: 小红书 / 即刻 / 知乎 / 少数派 / X / Reddit / Product Hunt / 微博 / 哔哩哔哩
 * 
 * 使用方式: node scripts/full-platform-test.mjs [--phase publish|read|browse|all] [--platform name]
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const SDK_CLI = path.join(PROJECT_ROOT, 'sdk', 'publish-post.js')

const CHROME_PORT = 9222
const IMAGES_DIR = 'C:\\Zeno-Growth-System\\content\\outputs\\jike\\20260327-001'
const IMAGES = [
  path.join(IMAGES_DIR, 'poster-01.png'),
  path.join(IMAGES_DIR, 'poster-02.png'),
  path.join(IMAGES_DIR, 'poster-03.png'),
].join(',')

// ============================================================
// 各平台发布内容
// ============================================================
const PLATFORMS = [
  {
    name: 'xiaohongshu',
    title: '分享一个我在用的AI助手',
    content: '最近在用一个叫 Zeno 的 AI app，比较打动我的是三个点：可以在对话里直接切换不同的AI模型，不用来回跳app；有个深度研究功能，丢个问题进去它会自动搜索整理成报告；还有语音对话，像打电话一样聊，开车的时候特别方便。App Store 搜 Zeno AI 就能找到，免费的。',
    tags: 'AI助手,效率工具,AI应用推荐',
    images: IMAGES,
    hasReader: true,
    hasBrowse: true,
  },
  {
    name: 'jike',
    title: '',
    content: '最近换了个 AI 助手 app 叫 Zeno，聊天可以切模型，有个深度研究功能挺实用，语音对话体验也不错。感兴趣的可以试试，App Store 搜 Zeno AI。',
    tags: 'AI,效率工具',
    images: IMAGES,
    hasReader: true,
    hasBrowse: false,
  },
  {
    name: 'zhihu',
    title: '聊聊最近在用的一个 AI 助手 App',
    content: '最近一直在用一个叫 Zeno 的 AI app，简单说几个我觉得比较实用的点：一是支持多个AI模型，对话里可以直接切换；二是有深度研究功能，能自动拆解问题、搜索资料、输出结构化报告；三是语音对话，实时识别加TTS朗读，通勤路上用着挺方便。App Store 搜 Zeno AI 可以免费下载。',
    tags: 'AI,人工智能,效率工具',
    images: IMAGES,
    hasReader: true,
    hasBrowse: true,
  },
  {
    name: 'sspai',
    title: '一个集成多模型聊天和深度研究的 AI 助手',
    content: '最近在用一个叫 Zeno 的 AI 助手 app，主要用到三个功能：多模型聊天，支持主流AI服务商，对话内切换模型；深度研究，输入问题后自动拆解、并发搜索、生成结构化报告；以及语音对话，实时语音识别和TTS朗读。整体体验比较流畅，适合需要经常和AI打交道的人。App Store 搜 Zeno AI。',
    tags: 'AI,效率工具,App推荐',
    images: IMAGES,
    hasReader: true,
    hasBrowse: false,
  },
  {
    name: 'x',
    title: '',
    content: 'Been using an AI app called Zeno — multi-model chat, deep research that auto-generates reports, and voice conversations. All in one app. Pretty handy. Search "Zeno AI" on App Store.',
    tags: 'AI,productivity',
    images: IMAGES,
    hasReader: true,
    hasBrowse: true,
  },
  {
    name: 'reddit',
    title: 'Found a solid all-in-one AI assistant app',
    content: 'Been using Zeno for a while now. Main features I use: switch between AI models mid-conversation, a deep research tool that breaks down questions and generates structured reports, and voice chat with real-time speech recognition. Free on the App Store — search "Zeno AI".',
    tags: '',
    images: IMAGES,
    hasReader: true,
    hasBrowse: false,
  },
  {
    name: 'producthunt',
    title: 'Zeno AI — Multi-model chat, deep research, and voice conversations',
    content: 'Zeno is an AI assistant app that lets you chat with multiple AI models in one interface, run deep research that auto-generates structured reports, and have voice conversations with real-time recognition. Available free on the App Store.',
    tags: '',
    images: IMAGES,
    hasReader: false,
    hasBrowse: false,
  },
  {
    name: 'weibo',
    title: '',
    content: '分享个最近在用的AI app — Zeno，多模型聊天+深度研究+语音对话，一个app搞定。特别是那个深度研究，丢个问题进去就能出报告，挺省事的。App Store 搜 Zeno AI',
    tags: 'AI助手,效率工具',
    images: IMAGES,
    hasReader: true,
    hasBrowse: false,
  },
  {
    name: 'bilibili',
    title: '分享一个AI助手app',
    content: '最近发现一个AI助手app叫Zeno，能切换多个AI模型聊天，还有深度研究和语音对话功能。深度研究会自动搜索整理出报告，语音对话可以像打电话一样和AI聊，挺有意思的。App Store 搜 Zeno AI 可以体验。',
    tags: 'AI,科技,效率',
    images: IMAGES,
    hasReader: true,
    hasBrowse: false,
  },
]

// ============================================================
// 日志 & 报告
// ============================================================
const report = {
  startTime: new Date().toISOString(),
  publish: [],
  read: [],
  browse: [],
  summary: { total: 0, pass: 0, fail: 0, skip: 0 },
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] ${msg}`)
}

function logResult(phase, platform, success, message, durationMs, extra = {}) {
  const entry = { platform, success, message, durationMs, timestamp: new Date().toISOString(), ...extra }
  report[phase].push(entry)
  report.summary.total++
  if (success) report.summary.pass++
  else report.summary.fail++
  const icon = success ? '✅' : '❌'
  log(`${icon} [${phase}] ${platform}: ${message} (${(durationMs / 1000).toFixed(1)}s)`)
}

function logSkip(phase, platform, reason) {
  report[phase].push({ platform, success: null, message: reason, skipped: true })
  report.summary.total++
  report.summary.skip++
  log(`⏭️  [${phase}] ${platform}: ${reason}`)
}

// ============================================================
// Phase 1: 发布测试 (使用 SDK CLI)
// ============================================================
async function testPublish(platform) {
  const p = platform
  const args = [SDK_CLI, '--platform', p.name, '--mode', 'publish', '--port', String(CHROME_PORT)]

  if (p.title) { args.push('--title', p.title) }
  // jike and x don't need title
  if (!p.title && !['x', 'jike'].includes(p.name)) {
    args.push('--title', p.title || '分享')
  }
  if (p.content) { args.push('--content', p.content) }
  if (p.images)  { args.push('--images', p.images) }
  if (p.tags)    { args.push('--tags', p.tags) }

  log(`🚀 [publish] ${p.name}: 开始发布...`)
  const start = Date.now()

  try {
    const { stdout, stderr } = await execFileAsync('node', args, {
      cwd: PROJECT_ROOT,
      timeout: 300_000, // 5 min timeout per platform
      maxBuffer: 10 * 1024 * 1024,
    })

    const duration = Date.now() - start
    let result
    try {
      result = JSON.parse(stdout.trim())
    } catch {
      result = { success: false, message: `无法解析输出: ${stdout.slice(0, 500)}` }
    }

    if (stderr && stderr.trim()) {
      log(`⚠️  [publish] ${p.name} stderr: ${stderr.slice(0, 300)}`)
    }

    logResult('publish', p.name, result.success, result.message || JSON.stringify(result).slice(0, 200), duration, {
      taskStatus: result.taskStatus,
      publishedUrl: result.publishedUrl,
      errorCode: result.errorCode,
      errorStep: result.errorStep,
      step_report: result.step_report,
    })

    return result
  } catch (err) {
    const duration = Date.now() - start
    const msg = err.killed ? `超时 (>${(300000/1000)}s)` : err.message
    logResult('publish', p.name, false, msg, duration, {
      stderr: err.stderr?.slice(0, 500),
    })
    return { success: false, message: msg }
  }
}

// ============================================================
// Phase 2: 数据读取测试
// ============================================================
async function testRead(platform) {
  if (!platform.hasReader) {
    logSkip('read', platform.name, '该平台无 reader.js，跳过')
    return
  }

  log(`📊 [read] ${platform.name}: 开始数据读取测试...`)
  const start = Date.now()

  try {
    const puppeteer = (await import('puppeteer-core')).default
    const resp = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`)
    const data = await resp.json()
    const browser = await puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl, defaultViewport: null })
    const page = await browser.newPage()

    try {
      const { loadReader } = await import('../platforms/loader.js')
      const ReaderClass = await loadReader(platform.name)
      const reader = new ReaderClass(page)
      await reader.init()

      // Try reading stats for a mock post (to test navigation and parsing)
      // We'll test if the reader can at least navigate to the platform
      const testPost = { title: 'test', platform: platform.name }
      let stats = null
      try {
        stats = await reader.readPostStats(testPost)
      } catch (readErr) {
        // Some readers need specific post URLs, this is expected
        logResult('read', platform.name, false, `readPostStats 失败: ${readErr.message}`, Date.now() - start)
        return
      }

      const duration = Date.now() - start
      if (stats) {
        logResult('read', platform.name, true, `读取成功: views=${stats.views||'-'} likes=${stats.likes||'-'} comments=${stats.comments||'-'}`, duration, { stats })
      } else {
        logResult('read', platform.name, false, '返回 null', duration)
      }
    } finally {
      await page.close().catch(() => {})
      browser.disconnect()
    }
  } catch (err) {
    logResult('read', platform.name, false, err.message, Date.now() - start)
  }
}

// ============================================================
// Phase 3: 养号浏览测试
// ============================================================
async function testBrowse(platform) {
  log(`🌐 [browse] ${platform.name}: 开始浏览测试（30s）...`)
  const start = Date.now()
  const BROWSE_DURATION_MS = 30_000 // 30 seconds per platform

  try {
    const puppeteer = (await import('puppeteer-core')).default
    const resp = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`)
    const data = await resp.json()
    const browser = await puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl, defaultViewport: null })
    const page = await browser.newPage()
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(30000)

    try {
      // Try loading dedicated browse adapter, fallback to publisher
      let runner
      try {
        const { loadBrowser } = await import('../platforms/loader.js')
        const BrowseClass = await loadBrowser(platform.name)
        runner = new BrowseClass(page)
      } catch {
        const { loadAdapter } = await import('../platforms/loader.js')
        const AdapterClass = await loadAdapter(platform.name)
        runner = new AdapterClass(page)
      }
      await runner.init()

      if (typeof runner.browse === 'function') {
        await runner.browse({ durationMs: BROWSE_DURATION_MS })
      } else {
        // Fallback: navigate to home URL and scroll
        const homeUrl = runner.getHomeUrl ? runner.getHomeUrl() : runner.constructor.HOME_URL || null
        if (homeUrl) {
          await page.goto(homeUrl, { waitUntil: 'networkidle2', timeout: 30000 })
          // Simple scroll simulation for 15 seconds
          const scrollEnd = Date.now() + 15_000
          while (Date.now() < scrollEnd) {
            await page.evaluate(() => window.scrollBy(0, Math.random() * 500 + 200))
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000))
          }
        } else {
          logResult('browse', platform.name, false, '无法获取首页 URL', Date.now() - start)
          return
        }
      }

      logResult('browse', platform.name, true, '浏览完成', Date.now() - start)
    } finally {
      await page.close().catch(() => {})
      browser.disconnect()
    }
  } catch (err) {
    logResult('browse', platform.name, false, err.message, Date.now() - start)
  }
}

// ============================================================
// 解析命令行参数
// ============================================================
function getArgs() {
  const args = process.argv.slice(2)
  let phase = 'all'
  let platformFilter = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phase') phase = args[++i]
    if (args[i] === '--platform') platformFilter = args[++i]
  }
  return { phase, platformFilter }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const { phase, platformFilter } = getArgs()
  const platforms = platformFilter
    ? PLATFORMS.filter(p => p.name === platformFilter)
    : PLATFORMS

  log(`════════════════════════════════════════════════════`)
  log(`  ZenoClaw 全平台测试`)
  log(`  平台: ${platforms.map(p => p.name).join(', ')}`)
  log(`  阶段: ${phase}`)
  log(`  时间: ${new Date().toISOString()}`)
  log(`════════════════════════════════════════════════════`)

  // Phase 1: Publish
  if (phase === 'all' || phase === 'publish') {
    log(`\n━━━ Phase 1: 发布测试 (${platforms.length} 个平台) ━━━\n`)
    for (const p of platforms) {
      await testPublish(p)
      // 发布后等待 10 秒，让浏览器和平台有时间恢复
      log(`⏳ 等待 10s 后继续下一个平台...\n`)
      await new Promise(r => setTimeout(r, 10_000))
    }
  }

  // Phase 2: Read
  if (phase === 'all' || phase === 'read') {
    log(`\n━━━ Phase 2: 数据读取测试 ━━━\n`)
    for (const p of platforms) {
      await testRead(p)
      await new Promise(r => setTimeout(r, 3_000))
    }
  }

  // Phase 3: Browse
  if (phase === 'all' || phase === 'browse') {
    log(`\n━━━ Phase 3: 养号浏览测试 ━━━\n`)
    for (const p of platforms) {
      await testBrowse(p)
      await new Promise(r => setTimeout(r, 3_000))
    }
  }

  // 输出报告
  log(`\n════════════════════════════════════════════════════`)
  log(`  测试完成`)
  log(`  总计: ${report.summary.total} | ✅ ${report.summary.pass} | ❌ ${report.summary.fail} | ⏭️  ${report.summary.skip}`)
  log(`════════════════════════════════════════════════════\n`)

  // 保存报告到文件
  report.endTime = new Date().toISOString()
  const reportPath = path.join(PROJECT_ROOT, 'data', `test-report-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  log(`📄 报告已保存: ${reportPath}`)

  // 打印故障摘要
  const failures = [...report.publish, ...report.read, ...report.browse].filter(r => r.success === false)
  if (failures.length > 0) {
    log(`\n━━━ 故障摘要 ━━━`)
    for (const f of failures) {
      log(`  ❌ ${f.platform}: ${f.message}`)
    }
  }
}

main().catch(err => {
  console.error('测试脚本异常:', err)
  process.exit(1)
})
