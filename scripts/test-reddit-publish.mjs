/**
 * Reddit 发帖测试（dryRun 模式：填写内容但不点发布）
 *
 * 用法: node scripts/test-reddit-publish.mjs
 *
 * 前提: Chrome 已在调试模式运行（--remote-debugging-port=9222）且已登录 Reddit
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import puppeteer from 'puppeteer-core'
import { initConfig, cfg } from '../core/config.js'
import { RedditAdapter } from '../platforms/reddit/publisher.js'

// ============================================================
// 加载配置
// ============================================================
const configPath = new URL('../zenoclaw.config.yaml', import.meta.url)
const configText = fs.readFileSync(configPath, 'utf8')
initConfig(yaml.load(configText))

// ============================================================
// 测试素材
// ============================================================
const contentDir = 'C:\\Zeno-Growth-System\\content\\outputs\\reddit\\20260413-001'
const contentMd = fs.readFileSync(path.join(contentDir, 'content.md'), 'utf8')

// 解析 content.md
function parseContentMd(md) {
  const sections = {}
  let currentKey = null
  for (const line of md.split('\n')) {
    if (line.startsWith('# ')) {
      currentKey = line.replace('# ', '').trim().toLowerCase()
      sections[currentKey] = ''
    } else if (currentKey) {
      sections[currentKey] += line + '\n'
    }
  }
  // 清理
  for (const k of Object.keys(sections)) {
    sections[k] = sections[k].trim()
  }
  return sections
}

const parsed = parseContentMd(contentMd)
const post = {
  title: parsed.title || 'Test Post',
  content: parsed.body || '',
  images: [],
  dryRun: true,          // 不实际点发布
  skipWarmup: true,      // 跳过预热浏览（Reddit 加载慢时用）
  skipImage: true        // 暂时跳过图片上传（选择器需更新）
}

// 图片
if (!post.skipImage) {
  const posterPath = path.join(contentDir, 'poster-01.png')
  if (fs.existsSync(posterPath)) {
    post.images.push(posterPath)
  }
}

console.log('\n========================================')
console.log('  Reddit 发帖测试 (dryRun)')
console.log('========================================\n')
console.log(`标题: ${post.title}`)
console.log(`正文: ${post.content.substring(0, 100)}...`)
console.log(`图片: ${post.images.length} 张`)
console.log(`vision.enabled: ${cfg('vision.enabled', false)}`)
console.log()

// ============================================================
// 连接浏览器
// ============================================================
const debugPort = cfg('browser.debug_port', 9222)
console.log(`连接浏览器 (port ${debugPort})...`)

let browser, page
try {
  browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${debugPort}`,
    defaultViewport: null
  })
  // 打开新标签页
  page = await browser.newPage()
  console.log('✅ 已连接浏览器，新标签页已打开\n')
} catch (err) {
  console.error(`❌ 连接浏览器失败: ${err.message}`)
  console.error('请先以调试模式启动 Chrome:')
  console.error('  关闭所有 Chrome 窗口')
  console.error('  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222')
  process.exit(1)
}

// ============================================================
// 执行测试
// ============================================================
const adapter = new RedditAdapter(page)
await adapter.init()

// 跳过预热浏览，直接测试发帖核心流程
if (post.skipWarmup) {
  adapter.warmupBrowse = async () => { console.log('[测试] 跳过预热浏览') }
  adapter.browseForStep = async () => { /* 跳过浏览模拟 */ }
  adapter.fillRemainingTime = async () => { /* 跳过补时 */ }
  adapter.postPublishBrowse = async () => { /* 跳过发布后浏览 */ }
}

const startTime = Date.now()
const result = await adapter.publish(post)
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

console.log('\n========================================')
console.log(`  测试结果: ${result.success ? '✅ 成功' : '❌ 失败'}`)
console.log(`  耗时: ${elapsed}s`)
console.log(`  消息: ${result.message}`)
console.log('========================================\n')

// 打印步骤报告
const steps = result.step_report || []
console.log('步骤报告:')
for (const step of steps) {
  const icon = step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : '⏳'
  console.log(`  ${icon} ${step.stepName} (${step.durationMs}ms)`)
  if (step.evidence && step.evidence.length > 0) {
    for (const ev of step.evidence) {
      if (ev.key.startsWith('vision_')) {
        console.log(`     🔍 ${ev.key}: ${JSON.stringify(ev.value).substring(0, 120)}`)
      }
    }
  }
}

console.log('\n(dryRun 模式: 内容已填写，未点击发布按钮)')
console.log('请在浏览器中检查填写结果是否正确\n')

browser.disconnect()
