/**
 * Midscene.js 实战测试脚本
 *
 * 连接真实浏览器，在 Reddit 发帖页面上测试 Midscene 的 AI 视觉能力：
 *   1. aiQuery — 页面状态识别（看到了什么）
 *   2. aiAssert — 页面断言（页面是否符合预期）
 *   3. aiAct — AI 操作页面（点击、输入）
 *   4. smartClick — 选择器 + AI 降级
 *
 * 运行：node scripts/test-midscene-live.mjs
 * 前提：Chrome 在 9222 端口运行且已登录 Reddit
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import yaml from 'js-yaml'
import { initConfig, cfg } from '../core/config.js'
import { createMidsceneAgent, safeMidsceneCall } from '../core/midscene-agent.js'

// ============================================================
// 初始化
// ============================================================

// 加载配置
const configPath = 'zenoclaw.config.yaml'
const config = yaml.load(fs.readFileSync(configPath, 'utf8'))
initConfig(config)

console.log('='.repeat(60))
console.log('🧪 Midscene.js 实战测试')
console.log('='.repeat(60))
console.log(`  模型: ${cfg('midscene.model_name', 'glm-4v-flash')}`)
console.log(`  启用: ${cfg('midscene.enabled', false)}`)
console.log()

// 连接 Chrome
const debugPort = cfg('browser.debug_port', 9222)
let browser, page

try {
  const res = await fetch(`http://localhost:${debugPort}/json/version`)
  const info = await res.json()
  browser = await puppeteer.connect({ browserWSEndpoint: info.webSocketDebuggerUrl })
  console.log(`✅ 已连接 Chrome: ${info.Browser}`)
} catch (e) {
  console.error(`❌ 无法连接 Chrome (端口 ${debugPort}): ${e.message}`)
  process.exit(1)
}

// 获取或创建标签页
const pages = await browser.pages()
page = pages[0]

// ============================================================
// 测试流程
// ============================================================

const results = []
const startTime = Date.now()

async function runTest(name, fn) {
  const t0 = Date.now()
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`🔹 ${name}`)
  try {
    const result = await fn()
    const ms = Date.now() - t0
    console.log(`   ✅ 通过 (${ms}ms)`)
    if (result) console.log(`   📋 结果:`, typeof result === 'object' ? JSON.stringify(result, null, 2) : result)
    results.push({ name, status: 'pass', ms, result })
    return result
  } catch (err) {
    const ms = Date.now() - t0
    console.log(`   ❌ 失败 (${ms}ms): ${err.message}`)
    results.push({ name, status: 'fail', ms, error: err.message })
    return null
  }
}

// ============================================================
// Phase 1: 导航到 Reddit 发帖页
// ============================================================
console.log('\n📌 Phase 1: 导航到 Reddit 发帖页')

await runTest('导航到 Reddit /submit', async () => {
  await page.goto('https://www.reddit.com/submit', { waitUntil: 'networkidle2', timeout: 30000 })
  const url = page.url()
  if (!url.includes('reddit.com')) throw new Error(`URL 不对: ${url}`)
  return url
})

// 等待页面完全加载
await new Promise(r => setTimeout(r, 3000))

// ============================================================
// Phase 2: 创建 Midscene Agent
// ============================================================
console.log('\n📌 Phase 2: 创建 Midscene Agent')

let agent = null
await runTest('创建 Midscene PuppeteerAgent', async () => {
  agent = await createMidsceneAgent(page)
  if (!agent) throw new Error('agent 为 null，检查配置')
  return 'agent 创建成功'
})

if (!agent) {
  console.error('\n❌ Agent 创建失败，无法继续测试')
  process.exit(1)
}

// ============================================================
// Phase 3: AI 页面理解（aiQuery）
// ============================================================
console.log('\n📌 Phase 3: AI 页面理解 (aiQuery)')

await runTest('aiQuery: 识别页面类型和主要元素', async () => {
  const r = await safeMidsceneCall(agent, 'aiQuery',
    '{pageType: string, hasTitle: boolean, hasTitleInput: boolean, hasContentEditor: boolean, hasSubmitButton: boolean, language: string}, 描述这个页面的类型、是否有标题输入框、正文编辑区和提交按钮，以及页面语言')
  if (!r.success) throw new Error(r.error)
  return r.result
})

await runTest('aiQuery: 识别可交互元素', async () => {
  const r = await safeMidsceneCall(agent, 'aiQuery',
    '{elements: string[]}, 列出页面上所有可以交互的主要按钮和输入框（最多10个）')
  if (!r.success) throw new Error(r.error)
  return r.result
})

// ============================================================
// Phase 4: AI 页面断言（aiAssert）
// ============================================================
console.log('\n📌 Phase 4: AI 页面断言 (aiAssert)')

await runTest('aiAssert: 当前是 Reddit 发帖页面', async () => {
  const r = await safeMidsceneCall(agent, 'aiAssert',
    '当前页面是 Reddit 的发帖/创建帖子页面')
  if (!r.success) throw new Error(r.error)
  return 'assertion passed'
})

await runTest('aiAssert: 页面有标题输入区域', async () => {
  const r = await safeMidsceneCall(agent, 'aiAssert',
    '页面上有一个可以输入帖子标题的区域')
  if (!r.success) throw new Error(r.error)
  return 'assertion passed'
})

// ============================================================
// Phase 5: AI 操作（aiAct）— 在标题框输入测试内容
// ============================================================
console.log('\n📌 Phase 5: AI 操作 (aiAct)')

const testTitle = 'Midscene AI Test - Please Ignore'

await runTest('aiAct: AI 找到标题输入框并输入文字', async () => {
  const r = await safeMidsceneCall(agent, 'aiAct',
    `在帖子标题输入框中输入 "${testTitle}"`)
  if (!r.success) throw new Error(r.error)
  return 'AI 已操作'
})

// 等待操作生效
await new Promise(r => setTimeout(r, 2000))

// 验证输入是否成功
await runTest('aiAssert: 验证标题已输入', async () => {
  const r = await safeMidsceneCall(agent, 'aiAssert',
    `标题输入框中包含文字 "Midscene"`)
  if (!r.success) throw new Error(r.error)
  return 'assertion passed'
})

// ============================================================
// Phase 6: AI 操作 — 在正文编辑器输入内容
// ============================================================
console.log('\n📌 Phase 6: AI 操作 — 正文编辑器')

const testContent = 'This is a test post generated by Midscene AI visual automation.'

await runTest('aiAct: AI 找到正文编辑器并输入内容', async () => {
  const r = await safeMidsceneCall(agent, 'aiAct',
    `在帖子正文/内容编辑区域中输入 "${testContent}"`)
  if (!r.success) throw new Error(r.error)
  return 'AI 已操作'
})

await new Promise(r => setTimeout(r, 2000))

// ============================================================
// Phase 7: AI 发布按钮识别（不点击）
// ============================================================
console.log('\n📌 Phase 7: AI 发布按钮识别')

await runTest('aiQuery: 找到发布/提交按钮', async () => {
  const r = await safeMidsceneCall(agent, 'aiQuery',
    '{hasPostButton: boolean, buttonText: string}, 页面上是否有发布/提交/Post 按钮，按钮文字是什么')
  if (!r.success) throw new Error(r.error)
  return r.result
})

// ============================================================
// Phase 8: 综合截图验证
// ============================================================
console.log('\n📌 Phase 8: 最终截图')

await runTest('截图保存', async () => {
  const screenshotDir = cfg('screenshot.save_dir', './logs/screenshots')
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = `${screenshotDir}/midscene_reddit_test_${timestamp}.png`
  await page.screenshot({ path: filePath, fullPage: false })
  return `截图已保存: ${filePath}`
})

// ============================================================
// 汇总报告
// ============================================================
const totalMs = Date.now() - startTime
const passed = results.filter(r => r.status === 'pass').length
const failed = results.filter(r => r.status === 'fail').length

console.log(`\n${'='.repeat(60)}`)
console.log('📊 Midscene 实战测试报告')
console.log(`${'='.repeat(60)}`)
console.log(`  总耗时: ${(totalMs / 1000).toFixed(1)}s`)
console.log(`  通过: ${passed}/${results.length}`)
console.log(`  失败: ${failed}/${results.length}`)
console.log()

for (const r of results) {
  const icon = r.status === 'pass' ? '✅' : '❌'
  console.log(`  ${icon} ${r.name} (${r.ms}ms)`)
  if (r.error) console.log(`      └─ ${r.error}`)
}

console.log(`\n${'='.repeat(60)}`)
if (failed === 0) {
  console.log('🎉 全部通过！Midscene AI 视觉状态机工作正常！')
} else {
  console.log(`⚠️ ${failed} 项失败，需要排查`)
}
console.log()

// 不关闭浏览器（用户还要用）
process.exit(failed > 0 ? 1 : 0)
