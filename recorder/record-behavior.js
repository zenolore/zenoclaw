#!/usr/bin/env node
/**
 * 行为录制器 CLI
 *
 * 用法:
 *   node recorder/record-behavior.js [--port 9222] [--output data/behavior-profile.json]
 *
 * 流程:
 *   1. 连接到 Chrome 调试端口
 *   2. 注入录制脚本到所有标签页
 *   3. 你正常操作浏览器（养号、发帖、提取数据等）
 *   4. 按 Enter 停止录制
 *   5. 自动提取数据 → 分析 → 保存行为特征文件
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { INJECT_SCRIPT } from './inject.js'
import { analyzeBehavior, extractConfigParams } from './analyzer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 参数解析 ──

function parseArgs() {
  const args = process.argv.slice(2)
  const result = { port: 9222, output: null }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port': result.port = parseInt(args[++i]); break
      case '--output': case '-o': result.output = args[++i]; break
    }
  }
  if (!result.output) {
    result.output = path.resolve(__dirname, '..', 'data', 'behavior-profile.json')
  }
  return result
}

// ── 注入录制器到单个页面 ──

async function injectToPage(page, pageIndex) {
  try {
    // 检查是否已注入
    const hasRecorder = await page.evaluate('!!window.__zenoBR').catch(() => false)
    if (hasRecorder) return false

    await page.evaluate(INJECT_SCRIPT)
    const title = await page.title().catch(() => '(unknown)')
    console.log(`  ✅ 已注入标签页 #${pageIndex}: ${title.slice(0, 40)}`)
    return true
  } catch (err) {
    // 某些页面（如 chrome://）无法注入，忽略
    return false
  }
}

// ── 从单个页面提取事件 ──

async function extractEvents(page) {
  try {
    const hasRecorder = await page.evaluate('!!window.__zenoBR').catch(() => false)
    if (!hasRecorder) return []

    // 分块提取，避免超大数据阻塞
    const totalCount = await page.evaluate('window.__zenoBR.count()')
    const chunkSize = 5000
    const allEvents = []

    for (let start = 0; start < totalCount; start += chunkSize) {
      const chunk = await page.evaluate(
        `window.__zenoBR.getChunk(${start}, ${chunkSize})`
      )
      allEvents.push(...chunk)
    }

    const title = await page.title().catch(() => '(unknown)')
    console.log(`  📦 提取 ${allEvents.length} 个事件 — ${title.slice(0, 40)}`)
    return allEvents
  } catch {
    return []
  }
}

// ── 状态显示 ──

async function showStatus(pages) {
  let totalEvents = 0
  let totalDuration = 0

  for (const page of pages) {
    try {
      const hasRecorder = await page.evaluate('!!window.__zenoBR').catch(() => false)
      if (!hasRecorder) continue
      const count = await page.evaluate('window.__zenoBR.count()').catch(() => 0)
      const dur = await page.evaluate('window.__zenoBR.duration()').catch(() => 0)
      totalEvents += count
      totalDuration = Math.max(totalDuration, dur)
    } catch { /* skip closed pages */ }
  }

  const durMin = (totalDuration / 60000).toFixed(1)
  process.stdout.write(
    `\r  🔴 录制中 | 事件: ${totalEvents} | 时长: ${durMin} 分钟 | 按 Enter 停止录制    `
  )
}

// ── 主流程 ──

async function main() {
  const args = parseArgs()
  console.log('╔═══════════════════════════════════════════╗')
  console.log('║        Zeno 行为录制器 v1.0               ║')
  console.log('╚═══════════════════════════════════════════╝')
  console.log()
  console.log(`  端口: ${args.port}`)
  console.log(`  输出: ${args.output}`)
  console.log()

  // 1. 连接 Chrome
  console.log('🔗 连接 Chrome...')
  let browser
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${args.port}`,
      defaultViewport: null
    })
  } catch (err) {
    console.error(`❌ 无法连接到 Chrome 端口 ${args.port}`)
    console.error(`   请确保 Chrome 已用 --remote-debugging-port=${args.port} 启动`)
    process.exit(1)
  }
  console.log('  ✅ 已连接')
  console.log()

  // 2. 注入到所有现有标签页
  console.log('💉 注入录制脚本...')
  const pages = await browser.pages()
  let injectedCount = 0
  for (let i = 0; i < pages.length; i++) {
    const injected = await injectToPage(pages[i], i + 1)
    if (injected) injectedCount++
  }
  console.log(`  共 ${pages.length} 个标签页，注入成功 ${injectedCount} 个`)
  console.log()

  // 3. 监听新标签页并自动注入
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try {
        const newPage = await target.page()
        if (newPage) {
          // 等页面加载完再注入
          await newPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
          await injectToPage(newPage, '新')
        }
      } catch { /* ignore */ }
    }
  })

  // 4. 定时显示状态
  const statusInterval = setInterval(async () => {
    try {
      const currentPages = await browser.pages()
      await showStatus(currentPages)
    } catch { /* browser might disconnect */ }
  }, 2000)

  console.log('🎬 开始录制！请正常操作浏览器...')
  console.log('   建议操作: 浏览页面、打字、点击、滚动（10-15 分钟最佳）')
  console.log()

  // 5. 等待用户按 Enter 停止
  await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.on('line', () => { rl.close(); resolve() })
  })

  clearInterval(statusInterval)
  console.log()
  console.log()
  console.log('⏹️  停止录制，正在提取数据...')

  // 6. 从所有标签页提取事件
  const allPages = await browser.pages()
  let allEvents = []
  for (const page of allPages) {
    const events = await extractEvents(page)
    allEvents.push(...events)
  }

  if (allEvents.length === 0) {
    console.log('❌ 未采集到任何事件。请确保在浏览器中有操作。')
    browser.disconnect()
    process.exit(1)
  }

  // 按时间排序（多标签页事件合并）
  allEvents.sort((a, b) => a.t - b.t)

  console.log(`\n  📊 共采集 ${allEvents.length} 个事件`)

  // 7. 分析
  console.log('\n🔬 分析行为特征...')
  const profile = analyzeBehavior(allEvents)
  const configParams = extractConfigParams(profile)

  // 8. 保存
  const outputDir = path.dirname(args.output)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const result = {
    profile,
    configParams,
    rawEventCount: allEvents.length
  }

  fs.writeFileSync(args.output, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`\n💾 已保存到: ${args.output}`)

  // 同时保存原始事件（可选，用于后续深度分析）
  const rawPath = args.output.replace('.json', '-raw.json')
  fs.writeFileSync(rawPath, JSON.stringify(allEvents), 'utf-8')
  console.log(`📦 原始事件: ${rawPath} (${(Buffer.byteLength(JSON.stringify(allEvents)) / 1024 / 1024).toFixed(1)} MB)`)

  // 9. 打印摘要
  console.log('\n' + '═'.repeat(50))
  console.log('  📋 行为特征摘要')
  console.log('═'.repeat(50))
  console.log(`  ⏱️  录制时长: ${profile.meta.durationMin} 分钟`)
  console.log(`  📝 总事件数: ${profile.meta.totalEvents}`)

  if (profile.typing) {
    console.log(`\n  ⌨️  打字:`)
    console.log(`     字间间隔: ${profile.typing.charInterval.mean}ms ± ${profile.typing.charInterval.std}ms`)
    console.log(`     长停顿概率: ${(profile.typing.longPauseProb * 100).toFixed(1)}%`)
    console.log(`     退格率: ${(profile.typing.backspaceRate * 100).toFixed(1)}%`)
    console.log(`     总击键: ${profile.typing.totalKeystrokes}`)
  }

  if (profile.mouse) {
    console.log(`\n  🖱️  鼠标:`)
    console.log(`     移动速度: ${profile.mouse.speed.mean} px/s ± ${profile.mouse.speed.std}`)
  }

  if (profile.trajectory) {
    console.log(`     轨迹弯曲度: ${(profile.trajectory.curvature.mean / 100).toFixed(2)}x (1.0=直线)`)
    console.log(`     移动时长: ${profile.trajectory.duration.mean}ms ± ${profile.trajectory.duration.std}ms`)
  }

  if (profile.click) {
    console.log(`\n  👆 点击:`)
    console.log(`     按住时长: ${profile.click.holdDuration.mean}ms ± ${profile.click.holdDuration.std}ms`)
    console.log(`     总点击: ${profile.click.totalClicks}`)
  }

  if (profile.scroll) {
    console.log(`\n  📜 滚动:`)
    console.log(`     滚动量: ${profile.scroll.amount.mean}px ± ${profile.scroll.amount.std}`)
    console.log(`     总滚动: ${profile.scroll.totalScrolls}`)
  }

  if (profile.idle) {
    console.log(`\n  ⏸️  停顿:`)
    console.log(`     微停顿(0.5-3s): ${profile.idle.short.mean}ms (${profile.idle.short.count}次)`)
    console.log(`     思考(3-10s): ${profile.idle.medium.mean}ms (${profile.idle.medium.count}次)`)
    console.log(`     长停(>10s): ${profile.idle.long.mean}ms (${profile.idle.long.count}次)`)
  }

  console.log('\n' + '═'.repeat(50))
  console.log('  ✅ 录制完成！配置参数已保存到 configParams 字段')
  console.log('═'.repeat(50))

  // 断开（不关闭浏览器）
  browser.disconnect()
  process.exit(0)
}

main().catch(err => {
  console.error('❌ 录制器异常:', err.message)
  process.exit(1)
})
