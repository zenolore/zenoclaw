/**
 * 即刻真实发布测试脚本
 *
 * 用法: node scripts/test-jike-publish.mjs [--dry-run]
 *
 * 素材目录: C:\Zeno-Growth-System\content\outputs\jike\20260410-001
 * 流程: 连接 Chrome → 加载素材 → 初始化适配器 → 全流程发布
 */
import puppeteer from 'puppeteer-core'
import { loadAdapter } from '../platforms/loader.js'
import { initConfig } from '../core/config.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = 'C:\\Zeno-Growth-System\\content\\outputs\\jike\\20260410-001'
const PORT = 9222
const LOG_FILE = path.join(__dirname, '..', 'logs', 'test-jike-publish.log')

// 同时写 console 和日志文件
function log(...args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`)
}
// 初始化日志
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
fs.writeFileSync(LOG_FILE, `=== test-jike-publish started at ${new Date().toISOString()} ===\n`)

// ── 解析 content.md ──
function parseContentMd(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const result = { title: '', body: '', tags: [], assets: [], cta: '', subtitle: '' }
  let currentSection = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      currentSection = trimmed.slice(2).trim().toLowerCase()
      continue
    }
    switch (currentSection) {
      case 'title':    result.title    += trimmed + '\n'; break
      case 'subtitle': result.subtitle += trimmed + '\n'; break
      case 'cta':      result.cta      += trimmed + '\n'; break
      case 'body':     result.body     += line + '\n';    break
      case 'tags':
        if (trimmed.startsWith('- ')) result.tags.push(trimmed.slice(2).replace(/^#/, '').trim())
        break
      case 'assets':
        if (trimmed.startsWith('- ')) result.assets.push(trimmed.slice(2).trim())
        break
    }
  }
  result.title    = result.title.trim()
  result.subtitle = result.subtitle.trim()
  result.cta      = result.cta.trim()
  result.body     = result.body.trim()
  return result
}

// ── 连接 Chrome ──
async function connectChrome() {
  const resp = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  if (!resp.ok) throw new Error(`Chrome 调试端口 ${PORT} 不可用，请先启动 Chrome --remote-debugging-port=${PORT}`)
  const data = await resp.json()
  if (!data.webSocketDebuggerUrl) throw new Error('未找到 webSocketDebuggerUrl')
  log(`✅ Chrome 已连接: ${data.Browser}`)
  return puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl, defaultViewport: null })
}

// ── 主流程 ──
async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  // 1. 解析素材
  const contentPath = path.join(CONTENT_DIR, 'content.md')
  if (!fs.existsSync(contentPath)) {
    log(`❌ 素材不存在: ${contentPath}`)
    process.exit(1)
  }
  const content = parseContentMd(contentPath)
  const images = content.assets.map(a => path.join(CONTENT_DIR, a)).filter(p => fs.existsSync(p))

  log('── 素材概览 ──')
  log(`  标题:   ${content.title}`)
  log(`  正文:   ${content.body.slice(0, 60)}...`)
  log(`  图片:   ${images.length} 张`)
  log(`  标签:   ${content.tags.join(', ')}`)
  log(`  模式:   ${isDryRun ? 'dryRun (不点发送)' : '🔴 真实发布'}`)
  log('')

  // 2. 初始化配置（正常模式，保留全部人类化行为）
  initConfig({
    timing: {
      warmup_browse_enabled: false,      // 跳过预热浏览（测试场景加速）
      total_duration_min: 0,
      total_duration_max: 0,
    },
    tab: {
      post_publish_browse_min: 0,
      post_publish_browse_max: 0,
    },
    steps: {
      open_page:     { browse_min: 0, browse_max: 0 },
      upload_images: { browse_min: 0, browse_max: 0 },
      input_content: { browse_min: 0, browse_max: 0 },
      publish:       { browse_min: 0, browse_max: 0, review_delay_min: 2000, review_delay_max: 4000 },
    },
    screenshot: {
      on_each_step: true,
      on_error: true,
      on_before_publish: true,
      on_after_publish: true,
    },
  })

  // 3. 连接 Chrome
  let browser, page
  try {
    browser = await connectChrome()
    page = await browser.newPage()
    log('✅ 新标签页已创建')
  } catch (err) {
    log(`❌ Chrome 连接失败: ${err.message}`)
    process.exit(1)
  }

  // 4. 初始化适配器
  const AdapterClass = await loadAdapter('jike')
  const adapter = new AdapterClass(page)
  await adapter.init()
  log('✅ JikeAdapter 初始化完成 (ghost-cursor 已创建)')
  log('')

  // 5. 构造 post 对象
  // 即刻无标题字段，正文 = body（含 CTA）
  const bodyWithCta = content.body + (content.cta ? `\n\n${content.cta}` : '')
  const post = {
    title:   content.title,
    content: bodyWithCta,
    images:  images,
    tags:    content.tags,
    dryRun:  isDryRun,
  }

  log('🚀 开始发布...')
  log('─'.repeat(60))

  // 6. 执行发布
  const t0 = Date.now()
  const result = await adapter.publish(post)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  log('─'.repeat(60))
  log('')
  log(`⏱  总耗时: ${elapsed}s`)
  log(`📊 结果: ${result.success ? '✅ 成功' : '❌ 失败'} — ${result.message}`)

  if (result.step_report) {
    log('')
    log('── Step Report ──')
    for (const step of result.step_report) {
      const icon = step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : '⏳'
      const evidStr = Array.isArray(step.evidence) && step.evidence.length > 0
        ? '| ' + step.evidence.map(e => `${e.key}=${JSON.stringify(e.value)}`).join(', ')
        : ''
      log(`  ${icon} ${(step.stepName || '?').padEnd(16)} ${step.durationMs}ms ${step.error ? '| ERR: ' + step.error : ''} ${evidStr}`)
    }
  }

  // 7. 清理
  if (!isDryRun) {
    await page.close().catch(() => {})
  } else {
    log('\n💡 dryRun 模式: 标签页已保留，请在浏览器中手动检查后关闭')
  }
  browser.disconnect()

  process.exitCode = result.success ? 0 : 1
}

main().catch(err => {
  log(`\n💥 未捕获异常: ${err.message}`)
  log(err.stack)
  process.exit(1)
})
