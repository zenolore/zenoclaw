/**
 * ZenoClaw 数据读取 + 养号浏览 测试
 * node scripts/test-read-browse.mjs
 */
import puppeteer from 'puppeteer-core'
import { loadReader, loadBrowser, loadAdapter } from '../platforms/loader.js'
import { initConfig } from '../core/config.js'

const PORT = 9222

// 快速模式配置
initConfig({
  timing: { action_delay_min: 300, action_delay_max: 800, warmup_browse_enabled: false },
  browser: { navigation_timeout: 30000, element_timeout: 15000 },
})

const READER_PLATFORMS = ['xiaohongshu', 'jike', 'zhihu', 'sspai', 'x', 'reddit', 'weibo', 'bilibili']
const BROWSE_PLATFORMS = ['xiaohongshu', 'zhihu', 'x']

// 用标题搜索测试（无 post_url）
const TEST_POSTS = {
  xiaohongshu: { title: '分享一个我在用的AI助手' },
  jike:        { title: 'Zeno' },
  zhihu:       { title: '聊聊最近在用的一个 AI 助手 App' },
  sspai:       { title: '一个集成多模型聊天和深度研究的 AI 助手' },
  x:           { title: 'Zeno AI' },
  reddit:      { title: 'Found a solid all-in-one AI assistant app' },
  weibo:       { title: 'Zeno' },
  bilibili:    { title: '分享一个AI助手app' },
}

const results = { read: [], browse: [] }

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] ${msg}`)
}

async function connectChrome() {
  const resp = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  const data = await resp.json()
  return puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl, defaultViewport: null })
}

// ── Read Tests ──
async function testRead(platform) {
  log(`📊 [read] ${platform}: 开始...`)
  const start = Date.now()
  let browser, page
  try {
    browser = await connectChrome()
    page = await browser.newPage()
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(30000)

    const ReaderClass = await loadReader(platform)
    const reader = new ReaderClass(page)
    await reader.init()

    const post = TEST_POSTS[platform]
    const stats = await reader.readPostStats(post)
    const dur = ((Date.now() - start) / 1000).toFixed(1)

    if (stats) {
      log(`✅ [read] ${platform}: ${JSON.stringify(stats)} (${dur}s)`)
      results.read.push({ platform, success: true, stats, durationS: dur })
    } else {
      log(`⚠️  [read] ${platform}: 返回 null (${dur}s)`)
      results.read.push({ platform, success: false, message: 'null result', durationS: dur })
    }
  } catch (err) {
    const dur = ((Date.now() - start) / 1000).toFixed(1)
    log(`❌ [read] ${platform}: ${err.message} (${dur}s)`)
    results.read.push({ platform, success: false, message: err.message, durationS: dur })
  } finally {
    if (page) await page.close().catch(() => {})
    if (browser) browser.disconnect()
  }
}

// ── Browse Tests ──
async function testBrowse(platform) {
  log(`🌐 [browse] ${platform}: 开始 (30s)...`)
  const start = Date.now()
  let browser, page
  try {
    browser = await connectChrome()
    page = await browser.newPage()
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(30000)

    let runner
    try {
      const BrowseClass = await loadBrowser(platform)
      runner = new BrowseClass(page)
    } catch {
      const AdapterClass = await loadAdapter(platform)
      runner = new AdapterClass(page)
    }
    await runner.init()

    if (typeof runner.browse === 'function') {
      await Promise.race([
        runner.browse({ durationMs: 30000 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('browse 超时 60s')), 60000))
      ])
    } else if (runner.getHomeUrl) {
      const url = runner.getHomeUrl()
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
      const end = Date.now() + 15000
      while (Date.now() < end) {
        await page.evaluate(() => window.scrollBy(0, Math.random() * 500 + 200))
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
      }
    } else {
      throw new Error('无 browse() 方法也无 getHomeUrl()')
    }

    const dur = ((Date.now() - start) / 1000).toFixed(1)
    log(`✅ [browse] ${platform}: 完成 (${dur}s)`)
    results.browse.push({ platform, success: true, durationS: dur })
  } catch (err) {
    const dur = ((Date.now() - start) / 1000).toFixed(1)
    log(`❌ [browse] ${platform}: ${err.message} (${dur}s)`)
    results.browse.push({ platform, success: false, message: err.message, durationS: dur })
  } finally {
    if (page) await page.close().catch(() => {})
    if (browser) browser.disconnect()
  }
}

// ── Main ──
async function main() {
  log('━━━ Phase 2: 数据读取测试 ━━━')
  for (const p of READER_PLATFORMS) {
    await testRead(p)
    await new Promise(r => setTimeout(r, 3000))
  }

  log('\n━━━ Phase 3: 养号浏览测试 ━━━')
  for (const p of BROWSE_PLATFORMS) {
    await testBrowse(p)
    await new Promise(r => setTimeout(r, 3000))
  }

  // Summary
  log('\n━━━ 测试汇总 ━━━')
  const readPass = results.read.filter(r => r.success).length
  const readFail = results.read.length - readPass
  const browsePass = results.browse.filter(r => r.success).length
  const browseFail = results.browse.length - browsePass
  log(`📊 Read:   ${readPass} pass / ${readFail} fail`)
  log(`🌐 Browse: ${browsePass} pass / ${browseFail} fail`)

  for (const r of [...results.read, ...results.browse]) {
    if (!r.success) log(`  ❌ ${r.platform}: ${r.message}`)
  }

  // Output full results as JSON
  console.log('\n' + JSON.stringify(results, null, 2))
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
