/**
 * 通用平台 dry-run 测试脚本
 *
 * 测试流程: 连接 Chrome → warmupBrowse → 打开发布页 → 填写内容 → 不点发布
 *
 * 用法:
 *   node scripts/test-platform-dryrun.mjs xiaohongshu
 *   node scripts/test-platform-dryrun.mjs jike
 *   node scripts/test-platform-dryrun.mjs reddit
 *   node scripts/test-platform-dryrun.mjs bilibili
 *   ...支持所有 19 个平台
 *
 * 前提:
 *   Chrome 需开启远程调试端口: chrome.exe --remote-debugging-port=9222
 *   且已登录目标平台
 */
console.log('[DEBUG] script start', new Date().toISOString())
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// 解析平台参数
const platform = process.argv[2]
if (!platform) {
  console.error('用法: node scripts/test-platform-dryrun.mjs <平台名>')
  console.error('支持: x, zhihu, xiaohongshu, jike, reddit, bilibili, weibo, douyin,')
  console.error('       v2ex, sspai, producthunt, wechat, qq, sohu, toutiao, baijiahao,')
  console.error('       netease, dayu, channels')
  process.exit(1)
}

// 加载配置
const configPath = path.join(projectRoot, 'zenoclaw.config.yaml')
const configText = fs.readFileSync(configPath, 'utf8')
const config = yaml.load(configText)

// 测试模式配置：缩短所有等待时间
config.timing = config.timing || {}
config.timing.warmup_browse_enabled = true
config.timing.warmup_browse_min = 10
config.timing.warmup_browse_max = 20
config.timing.total_duration_min = 60
config.timing.total_duration_max = 120

config.steps = config.steps || {}
for (const step of ['open_page', 'upload_images', 'input_title', 'input_content', 'add_tags']) {
  config.steps[step] = config.steps[step] || {}
  config.steps[step].browse_min = 3
  config.steps[step].browse_max = 6
}
config.steps.publish = config.steps.publish || {}
config.steps.publish.review_delay_min = 1000
config.steps.publish.review_delay_max = 2000

config.tab = config.tab || {}
config.tab.post_publish_browse_min = 5
config.tab.post_publish_browse_max = 10
config.tab.close_after_operation = false

config.stealth = config.stealth || {}
config.stealth.random_viewport = false

config.screenshot = config.screenshot || {}
config.screenshot.on_each_step = true
config.screenshot.on_before_publish = true
config.screenshot.on_error = true
config.screenshot.save_dir = './logs/screenshots'

// AI 视觉验证（API Key 从环境变量读取，不硬编码）
config.vision = {
  enabled: !!process.env.VISION_API_KEY,
  api_key: process.env.VISION_API_KEY || '',
  base_url: process.env.VISION_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  model: process.env.VISION_MODEL || 'glm-4v-flash',
  timeout: 30000
}

// 初始化
const { initConfig } = await import(pathToFileURL(path.join(projectRoot, 'core/config.js')).href)
initConfig(config)

const { getLogger, initLogger } = await import(pathToFileURL(path.join(projectRoot, 'core/logger.js')).href)
initLogger(config)
const log = getLogger()

const { getBrowser, disconnectBrowser, closePage } = await import(pathToFileURL(path.join(projectRoot, 'core/browser.js')).href)
const { loadAdapter } = await import(pathToFileURL(path.join(projectRoot, 'platforms/loader.js')).href)

// 通用测试内容（各平台适配器会取需要的字段）
const testPost = {
  title: 'Dry-Run 测试标题 — AI 工具如何改变工作流',
  content: '这是一段 dry-run 测试正文。AI 工具正在改变我们的工作方式，从文本生成到图像创作，从代码补全到数据分析。本文探讨几种主流 AI 工具的使用场景和最佳实践。\n\n第一，选择合适的工具。不同任务需要不同的 AI 模型，文字创作推荐 Claude，代码推荐 Copilot。\n\n第二，建立工作流。将 AI 工具融入日常工作流程，而非孤立使用。',
  tags: ['AI工具', '效率提升', '工作流'],
  images: [],
  dryRun: true,  // ← 关键：不点击发布
}

// 检查是否有真实图片可用（可选）
const zhihuImg = 'C:\\Zeno-Growth-System\\content\\outputs\\zhihu\\20260409-001\\poster-01.png'
if (fs.existsSync(zhihuImg)) {
  testPost.images = [zhihuImg]
}

log.info('====================================================')
log.info(`平台 dry-run 测试: ${platform}`)
log.info(`标题: ${testPost.title}`)
log.info(`正文: ${testPost.content.slice(0, 50)}...`)
log.info(`标签: ${testPost.tags.join(', ')}`)
log.info(`图片: ${testPost.images.length} 张`)
log.info(`模式: DRY RUN（不点发布）`)
log.info('====================================================')

let browser = null
let page = null

try {
  log.info('[1/2] 连接 Chrome 浏览器...')
  const result = await getBrowser()
  browser = result.browser
  page = result.page
  log.info(`[1/2] Chrome 连接成功 (新启动: ${result.isNewLaunch})`)

  log.info(`[2/2] 加载 ${platform} 适配器...`)
  const AdapterClass = await loadAdapter(platform)
  const adapter = new AdapterClass(page)
  await adapter.init()
  log.info(`[2/2] ${platform} 适配器初始化完成`)

  const startTime = Date.now()
  const publishResult = await adapter.publish(testPost)
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  log.info('====================================================')
  if (publishResult.success) {
    log.info(`✅ ${platform} dry-run 完成 (${elapsed}s)`)
  } else {
    log.error(`❌ ${platform} dry-run 失败: ${publishResult.message} (${elapsed}s)`)
  }
  log.info('====================================================')

} catch (err) {
  log.error(`测试异常: ${err.message}`)
  log.error(err.stack)
} finally {
  if (page) {
    await closePage(page)
  }
  if (browser) {
    await disconnectBrowser(browser)
  }
}
