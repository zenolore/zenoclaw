import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(projectRoot, '..')
const articlePath = process.argv[2] || 'C:\\Zeno-Growth-System\\data\\articles\\a_mnxxy7ds_9khq.json'
const scenario = process.argv[3] || 'basic'

const configPath = path.join(projectRoot, 'zenoclaw.config.yaml')
const configText = fs.readFileSync(configPath, 'utf8')
const config = yaml.load(configText)
config.timing = config.timing || {}
config.timing.warmup_browse_enabled = true
config.timing.warmup_browse_min = 8
config.timing.warmup_browse_max = 12
config.timing.total_duration_min = 45
config.timing.total_duration_max = 90
config.steps = config.steps || {}
for (const step of ['open_page', 'upload_images', 'input_title', 'input_content', 'add_tags']) {
  config.steps[step] = config.steps[step] || {}
  config.steps[step].browse_min = 2
  config.steps[step].browse_max = 5
}
config.steps.publish = config.steps.publish || {}
config.steps.publish.review_delay_min = 1000
config.steps.publish.review_delay_max = 2500
config.tab = config.tab || {}
config.tab.post_publish_browse_min = 5
config.tab.post_publish_browse_max = 8
config.tab.close_after_operation = false
config.stealth = config.stealth || {}
config.stealth.random_viewport = false
config.screenshot = config.screenshot || {}
config.screenshot.on_each_step = true
config.screenshot.on_before_publish = true
config.screenshot.on_error = true
config.screenshot.save_dir = './logs/screenshots'

const { initConfig } = await import(pathToFileURL(path.join(projectRoot, 'core/config.js')).href)
initConfig(config)

const { getLogger, initLogger } = await import(pathToFileURL(path.join(projectRoot, 'core/logger.js')).href)
initLogger(config)
const log = getLogger()

const { getBrowser, disconnectBrowser } = await import(pathToFileURL(path.join(projectRoot, 'core/browser.js')).href)
const { loadAdapter } = await import(pathToFileURL(path.join(projectRoot, 'platforms/loader.js')).href)

const article = JSON.parse(fs.readFileSync(articlePath, 'utf8'))
const cover = (article.images || []).find(i => i.type === 'cover' && i.url)
const coverPath = cover
  ? path.resolve(repoRoot, 'data', cover.url.replace(/^\/article-images\//, 'article-images/'))
  : null
const fallbackImages = [
  'cover-a_mnxws0lg_5q6q-1776129711529.png',
  'cover-a_mnxws0lg_5q6q-1776129775969.png',
  'cover-a_mnxws0lg_5q6q-1776129792694.png',
].map(name => path.resolve(repoRoot, 'data', 'article-images', name))

function buildPost(currentScenario) {
  const basePost = {
    title: article.topic?.title || '',
    content: article.finalContent || article.draft || '',
    tags: [],
    images: coverPath ? [coverPath] : [],
    coverType: coverPath ? 'single' : undefined,
    enableAd: false,
    declarations: ['个人观点，仅供参考'],
    location: '北京',
    declareFirstPublish: true,
    autoRightsProtection: true,
    collection: '公积金',
    publishWeiToutiao: true,
    dryRun: true,
  }

  if (currentScenario === 'triple') {
    return {
      ...basePost,
      coverType: 'triple',
      images: fallbackImages,
      declareFirstPublish: false,
      autoRightsProtection: false,
      publishWeiToutiao: false,
    }
  }

  if (currentScenario === 'triple-min') {
    return {
      ...basePost,
      coverType: 'triple',
      images: fallbackImages,
      enableAd: undefined,
      declarations: [],
      location: undefined,
      declareFirstPublish: false,
      autoRightsProtection: false,
      collection: undefined,
      publishWeiToutiao: false,
    }
  }

  if (currentScenario === 'schedule') {
    const scheduledAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    scheduledAt.setHours(10, 30, 0, 0)
    return {
      ...basePost,
      coverType: 'none',
      images: [],
      scheduleTime: scheduledAt.toISOString(),
      enableAd: true,
    }
  }

  if (currentScenario === 'schedule-min') {
    const scheduledAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    scheduledAt.setHours(10, 30, 0, 0)
    return {
      ...basePost,
      coverType: 'none',
      images: [],
      enableAd: undefined,
      declarations: [],
      location: undefined,
      declareFirstPublish: false,
      autoRightsProtection: false,
      collection: undefined,
      publishWeiToutiao: false,
      scheduleTime: scheduledAt.toISOString(),
    }
  }

  return basePost
}

const post = buildPost(scenario)

for (const imagePath of post.images || []) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`封面不存在: ${imagePath}`)
  }
}

log.info('====================================================')
log.info('头条全选项 dryRun 测试')
log.info(`场景: ${scenario}`)
log.info(`文章: ${article.id}`)
log.info(`标题: ${post.title}`)
log.info(`封面模式: ${post.coverType || '默认'}`)
log.info(`图片数: ${post.images?.length || 0}`)
log.info(`位置: ${post.location}`)
log.info(`广告: ${post.enableAd}`)
log.info(`首发: ${post.declareFirstPublish}`)
log.info(`自动维权: ${post.autoRightsProtection}`)
log.info(`微头条: ${post.publishWeiToutiao}`)
log.info(`合集: ${post.collection}`)
log.info(`作品声明: ${post.declarations.join(', ')}`)
if (post.scheduleTime) {
  log.info(`定时: ${post.scheduleTime}`)
}
log.info('====================================================')

let browser = null
let page = null

try {
  const browserResult = await getBrowser()
  browser = browserResult.browser
  page = browserResult.page
  log.info(`Chrome 连接成功 (新启动: ${browserResult.isNewLaunch})`)

  const AdapterClass = await loadAdapter('toutiao')
  const adapter = new AdapterClass(page)
  await adapter.init()

  const start = Date.now()
  const result = await adapter.publish(post)
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  if (result.success) {
    log.info(`✅ 头条全选项 dryRun 完成 (${elapsed}s)`)
  } else {
    log.error(`❌ 头条全选项 dryRun 失败: ${result.message} (${elapsed}s)`)
    process.exitCode = 1
  }

  process.stdout.write(`${JSON.stringify({ success: result.success, message: result.message, articleId: article.id, dryRun: true })}\n`)
} catch (err) {
  log.error(`测试异常: ${err.message}`)
  log.error(err.stack)
  process.stdout.write(`${JSON.stringify({ success: false, message: err.message, dryRun: true })}\n`)
  process.exitCode = 1
} finally {
  if (browser) {
    await disconnectBrowser(browser).catch(() => {})
  }
}
