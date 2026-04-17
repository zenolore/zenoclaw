/**
 * X 平台真实发布全流程测试
 *
 * 流程: 连接 Chrome → 预热浏览首页 → 打开发帖页 → 填写内容 → 上传图片
 *       → AI 视觉验证 → 点击发布 → 发布后浏览 → 关闭标签页
 *
 * 用法:
 *   node scripts/test-x-publish.mjs              # 真实发布
 *   node scripts/test-x-publish.mjs --dry-run    # 仅填写不点发布
 *
 * 前提:
 *   Chrome 需开启远程调试端口: chrome.exe --remote-debugging-port=9222
 *   且已登录 X (twitter)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// 加载配置
const configPath = path.join(projectRoot, 'zenoclaw.config.yaml')
const configText = fs.readFileSync(configPath, 'utf8')
const config = yaml.load(configText)

// 测试模式：缩短浏览时间，加速验证
config.timing = config.timing || {}
config.timing.warmup_browse_enabled = true
config.timing.warmup_browse_min = 15        // 预热 15-30 秒（测试用）
config.timing.warmup_browse_max = 30
config.timing.total_duration_min = 120      // 总时长 2-4 分钟（测试用）
config.timing.total_duration_max = 240

config.steps = config.steps || {}
for (const step of ['open_page', 'upload_images', 'input_title', 'input_content', 'add_tags']) {
  config.steps[step] = config.steps[step] || {}
  config.steps[step].browse_min = 5         // 每步浏览 5-10 秒（测试用）
  config.steps[step].browse_max = 10
}
config.steps.publish = config.steps.publish || {}
config.steps.publish.review_delay_min = 2000
config.steps.publish.review_delay_max = 4000
config.steps.publish.wait_after_min = 3000
config.steps.publish.wait_after_max = 6000

config.tab = config.tab || {}
config.tab.post_publish_browse_min = 10     // 发布后浏览 10-20 秒
config.tab.post_publish_browse_max = 20
config.tab.close_after_operation = false    // 测试时不自动关闭，方便观察

// 不限制浏览器视口大小，使用窗口原生尺寸
config.stealth = config.stealth || {}
config.stealth.random_viewport = false

config.screenshot = config.screenshot || {}
config.screenshot.on_each_step = true       // 测试时每步截图
config.screenshot.on_before_publish = true
config.screenshot.on_after_publish = true
config.screenshot.on_error = true
config.screenshot.save_dir = './logs/screenshots'

// 启用 AI 视觉验证（API Key 从环境变量读取，不硬编码）
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

const { getBrowser, closePage, disconnectBrowser } = await import(pathToFileURL(path.join(projectRoot, 'core/browser.js')).href)
const { loadAdapter } = await import(pathToFileURL(path.join(projectRoot, 'platforms/loader.js')).href)

// 解析命令行参数
const isDryRun = process.argv.includes('--dry-run')

// 准备发布内容（从 content.md 解析）
const contentDir = 'C:\\Zeno-Growth-System\\content\\outputs\\x\\20260414-001'
const contentMd = fs.readFileSync(path.join(contentDir, 'content.md'), 'utf8')

// 解析 content.md 各字段
function parseSections(md) {
  const sections = {}
  let currentKey = null
  for (const line of md.split('\n')) {
    const heading = line.match(/^#\s+(.+)/)
    if (heading) {
      currentKey = heading[1].trim().toLowerCase()
      sections[currentKey] = ''
    } else if (currentKey) {
      sections[currentKey] += line + '\n'
    }
  }
  // trim each section
  for (const k of Object.keys(sections)) {
    sections[k] = sections[k].trim()
  }
  return sections
}

const sections = parseSections(contentMd)
const body = sections.body || ''

// 从 Assets 字段提取图片
const assetLines = (sections.assets || '').split('\n').filter(l => l.startsWith('- '))
const images = assetLines.map(l => path.join(contentDir, l.replace(/^-\s*/, '').trim()))

// 加时间戳避免 X 拒绝重复推文
const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
const uniqueBody = body + `\n\n${timestamp}`

const post = {
  content: uniqueBody,
  images,
  dryRun: isDryRun,
}

// 验证图片存在
for (const img of post.images) {
  if (!fs.existsSync(img)) {
    log.error(`图片不存在: ${img}`)
    process.exit(1)
  }
}

log.info('====================================================')
log.info('X 平台发布测试')
log.info(`模式: ${isDryRun ? 'DRY RUN（不点发布）' : '⚠️  真实发布'}`)
log.info(`内容: ${post.content.slice(0, 80)}...`)
log.info(`图片: ${post.images.length} 张`)
log.info(`预热浏览: ${config.timing.warmup_browse_min}-${config.timing.warmup_browse_max}s`)
log.info(`截图目录: ${config.screenshot.save_dir}`)
log.info('====================================================')

if (!isDryRun) {
  log.info('⚠️  3 秒后开始真实发布，Ctrl+C 可取消...')
  await new Promise(r => setTimeout(r, 3000))
}

let browser = null
let page = null

try {
  // 连接 Chrome
  log.info('[1/2] 连接 Chrome 浏览器...')
  const result = await getBrowser()
  browser = result.browser
  page = result.page
  log.info(`[1/2] Chrome 连接成功 (新启动: ${result.isNewLaunch})`)

  // 加载 X 适配器
  log.info('[2/2] 加载 X 平台适配器...')
  const XAdapter = await loadAdapter('x')
  const adapter = new XAdapter(page)
  await adapter.init()
  log.info('[2/2] X 适配器初始化完成')

  // 执行发布
  const startTime = Date.now()
  const publishResult = await adapter.publish(post)
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  log.info('====================================================')
  if (publishResult.success) {
    log.info(`✅ 发布结果: 成功 (耗时 ${elapsed}s)`)
  } else {
    log.error(`❌ 发布结果: 失败 - ${publishResult.message} (耗时 ${elapsed}s)`)
  }
  log.info('====================================================')

  // 不关闭标签页，方便人工检查
  log.info('标签页保持打开，请手动检查发布结果')

} catch (err) {
  log.error(`测试异常: ${err.message}`)
  log.error(err.stack)
} finally {
  if (browser) {
    await disconnectBrowser(browser)
  }
}
