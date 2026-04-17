#!/usr/bin/env node
/**
 * 紧急提取 — 直接连接 Chrome 提取录制数据并分析
 */
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeBehavior, extractConfigParams } from './analyzer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.resolve(__dirname, '..', 'data', 'behavior-profile.json')

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  })
  console.log('已连接 Chrome')

  const pages = await browser.pages()
  let allEvents = []

  for (const page of pages) {
    try {
      const has = await page.evaluate('!!window.__zenoBR').catch(() => false)
      if (!has) continue
      const count = await page.evaluate('window.__zenoBR.count()')
      const dur = await page.evaluate('(window.__zenoBR.duration() / 60000).toFixed(1)')
      const title = await page.title().catch(() => '?')
      console.log(`  📦 ${title.slice(0, 40)} — ${count} 事件, ${dur} 分钟`)

      // 分块提取
      for (let start = 0; start < count; start += 5000) {
        const chunk = await page.evaluate(`window.__zenoBR.getChunk(${start}, 5000)`)
        allEvents.push(...chunk)
      }
    } catch (e) {
      console.log(`  ⚠️ 跳过: ${e.message}`)
    }
  }

  if (allEvents.length === 0) {
    console.log('❌ 未采集到事件')
    browser.disconnect()
    process.exit(1)
  }

  allEvents.sort((a, b) => a.t - b.t)
  console.log(`\n共 ${allEvents.length} 个事件`)

  const profile = analyzeBehavior(allEvents)
  const configParams = extractConfigParams(profile)

  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  fs.writeFileSync(outputPath, JSON.stringify({ profile, configParams, rawEventCount: allEvents.length }, null, 2))
  console.log(`\n💾 已保存: ${outputPath}`)

  // 打印摘要
  if (profile.typing) {
    console.log(`\n⌨️  打字: ${profile.typing.charInterval.mean}ms ± ${profile.typing.charInterval.std}ms, 总击键 ${profile.typing.totalKeystrokes}`)
  }
  if (profile.mouse) {
    console.log(`🖱️  鼠标速度: ${profile.mouse.speed.mean} px/s ± ${profile.mouse.speed.std}`)
  }
  if (profile.click) {
    console.log(`👆 点击按住: ${profile.click.holdDuration.mean}ms, 总 ${profile.click.totalClicks} 次`)
  }
  if (profile.scroll) {
    console.log(`📜 滚动: ${profile.scroll.amount.mean}px, 总 ${profile.scroll.totalScrolls} 次`)
  }
  if (profile.idle) {
    console.log(`⏸️  微停顿: ${profile.idle.short.mean}ms (${profile.idle.short.count}次), 思考: ${profile.idle.medium.mean}ms (${profile.idle.medium.count}次)`)
  }

  browser.disconnect()
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
