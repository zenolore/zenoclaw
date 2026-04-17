/**
 * 端到端测试：contentBlocks 正文插图 + 三图封面
 * 
 * 使用方式：
 *   1. 确保 Chrome 已开启 --remote-debugging-port=9222
 *   2. 已登录头条号 mp.toutiao.com
 *   3. node zenoclaw/scripts/test-content-blocks.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(projectRoot, '..')

// ─── 配置 zenoclaw ───
const configPath = path.join(projectRoot, 'zenoclaw.config.yaml')
const configText = fs.readFileSync(configPath, 'utf8')
const config = yaml.load(configText)
config.timing = config.timing || {}
config.timing.warmup_browse_enabled = false
config.timing.total_duration_min = 5
config.timing.total_duration_max = 10
config.stealth = config.stealth || {}
config.stealth.random_viewport = false

const { initConfig } = await import(pathToFileURL(path.join(projectRoot, 'core/config.js')).href)
initConfig(config)

const { getLogger, initLogger } = await import(pathToFileURL(path.join(projectRoot, 'core/logger.js')).href)
initLogger(config)
const log = getLogger()

// ─── 准备测试数据 ───
const imgDir = path.resolve(repoRoot, 'data', 'article-images')
const images = fs.readdirSync(imgDir)
  .filter(f => f.endsWith('.png'))
  .slice(0, 3)
  .map(f => path.join(imgDir, f))

if (images.length < 2) {
  console.error('需要至少 2 张图片用于测试')
  process.exit(1)
}
log.info(`测试图片: ${images.map(p => path.basename(p)).join(', ')}`)

// 模拟 article-factory 产出的 post 对象
const post = {
  title: '【测试】contentBlocks 正文插图端到端验证',
  content: '这是纯文本 fallback 内容，如果 contentBlocks 没有生效你会看到这段话',
  contentBlocks: [
    { type: 'text', value: '你现在要办"租房提取公积金"，先别急着到处搜教程，先把这三件事确认了：\n\n【是不是在北京连续足额缴存满3个月】\n【你和配偶在北京名下有没有房】\n【你打算走普通租房提取，还是想按实际房租提取】\n\n这三件事一清楚，后面就顺了。' },
    { type: 'image', src: images[0], caption: '公积金提取流程图' },
    { type: 'text', value: '【北京住房公积金管理中心官网】、【北京市政务服务网"京通"小程序】。别在一堆非官方文章里转来转去，越看越乱。\n\n先讲最常用的：自己申请租房提取，钱提到本人账户。如果你就是普通租房住，每个月想把符合条件的公积金提出来贴补房租，这种最常见。' },
    { type: 'image', src: images[1], caption: '办理材料清单' },
    { type: 'text', value: '【本文更新时间：2026-04-17】\n\n*免责提示：本文按北京公开办事信息整理，便于你理解流程。具体提取条件、材料要求、办理时限请以北京住房公积金管理中心官网最新页面为准。*' },
  ],
  images: images.slice(0, 3),  // 封面用图
  coverType: 'triple',
  enableAd: false,
  declareFirstPublish: true,
  publishWeiToutiao: false,
  contentDeclaration: ['个人观点，仅供参考'],
  dryRun: true,
}

// ─── 通过 zenoclaw adapter 执行 ───
const { loadAdapter } = await import(pathToFileURL(path.join(projectRoot, 'platforms/loader.js')).href)
const { getBrowser, disconnectBrowser } = await import(pathToFileURL(path.join(projectRoot, 'core/browser.js')).href)

let browser = null
try {
  const br = await getBrowser()
  browser = br.browser

  const page = br.page
  log.info('Chrome 连接成功')

  const AdapterClass = await loadAdapter('toutiao')
  const adapter = new AdapterClass(page)
  await adapter.init()

  log.info('开始执行 publish（dryRun 模式）...')
  const result = await adapter.publish(post)

  if (result.success) {
    log.info(`✅ 测试通过: ${result.message}`)
  } else {
    log.error(`❌ 测试失败: ${result.message}`)
    process.exitCode = 1
  }
} catch (err) {
  log.error(`测试异常: ${err.message}`)
  log.error(err.stack)
  process.exitCode = 1
} finally {
  if (browser) disconnectBrowser()
}
