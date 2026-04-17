/**
 * 全平台批量测试脚本
 *
 * 测试内容: 发布(dryRun) + 数据读取 + 养号浏览
 * 跳过: bilibili（账号不可用）
 * 策略: 失败重试最多 3 次，记录日志不做代码修改
 *
 * 用法: node scripts/batch-test-all.mjs
 *
 * 前提: Chrome 已在调试模式运行（--remote-debugging-port=9222）
 *       且已登录需要测试的平台
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// ============================================================
// 加载配置
// ============================================================
const configPath = path.join(projectRoot, 'zenoclaw.config.yaml')
const configText = fs.readFileSync(configPath, 'utf8')
const config = yaml.load(configText)

// 测试模式：缩短所有时间
config.timing = config.timing || {}
config.timing.warmup_browse_enabled = false     // 跳过预热浏览
config.timing.total_duration_min = 60
config.timing.total_duration_max = 120

config.steps = config.steps || {}
for (const step of ['open_page', 'upload_images', 'input_title', 'input_content', 'add_tags']) {
  config.steps[step] = config.steps[step] || {}
  config.steps[step].browse_min = 2
  config.steps[step].browse_max = 5
}
config.steps.publish = config.steps.publish || {}
config.steps.publish.review_delay_min = 1000
config.steps.publish.review_delay_max = 2000

config.tab = config.tab || {}
config.tab.post_publish_browse_min = 3
config.tab.post_publish_browse_max = 5
config.tab.close_after_operation = false

config.stealth = config.stealth || {}
config.stealth.random_viewport = false

config.screenshot = config.screenshot || {}
config.screenshot.on_each_step = true
config.screenshot.on_before_publish = true
config.screenshot.on_after_publish = true
config.screenshot.on_error = true
config.screenshot.save_dir = './logs/screenshots'

// 视觉验证保持开启
config.vision = config.vision || {}
config.vision.enabled = true

const { initConfig, cfg } = await import(pathToFileURL(path.join(projectRoot, 'core/config.js')).href)
initConfig(config)

const { getLogger, initLogger } = await import(pathToFileURL(path.join(projectRoot, 'core/logger.js')).href)
initLogger(config)
const log = getLogger()

const { getBrowser, closePage, disconnectBrowser } = await import(pathToFileURL(path.join(projectRoot, 'core/browser.js')).href)
const { loadAdapter, loadReader, listPlatforms } = await import(pathToFileURL(path.join(projectRoot, 'platforms/loader.js')).href)

// ============================================================
// 平台配置
// ============================================================

const SKIP_PLATFORMS = ['bilibili', 'v2ex']  // bilibili 账号不可用，v2ex 无账号

// 有素材的平台 → 可以测发布
const CONTENT_MAP = {
  jike:        'C:\\Zeno-Growth-System\\content\\outputs\\jike\\20260424-001',
  reddit:      'C:\\Zeno-Growth-System\\content\\outputs\\reddit\\20260420-001',
  sspai:       'C:\\Zeno-Growth-System\\content\\outputs\\sspai\\20260423-001',
  v2ex:        'C:\\Zeno-Growth-System\\content\\outputs\\v2ex\\20260401-002',
  x:           'C:\\Zeno-Growth-System\\content\\outputs\\x\\20260425-001',
  xiaohongshu: 'C:\\Zeno-Growth-System\\content\\outputs\\xiaohongshu\\20260425-001',
  zhihu:       'C:\\Zeno-Growth-System\\content\\outputs\\zhihu\\20260425-001',
}

// 有 reader 的平台
const READER_PLATFORMS = ['jike', 'reddit', 'sspai', 'weibo', 'x', 'xiaohongshu', 'zhihu']

// 所有平台首页（养号用）
const HOME_URLS = {
  baijiahao:   'https://baijiahao.baidu.com/',
  channels:    'https://channels.weixin.qq.com/',
  dayu:        'https://mp.dayu.com/',
  douyin:      'https://www.douyin.com/',
  jike:        'https://web.okjike.com/',
  netease:     'https://mp.163.com/',
  producthunt: 'https://www.producthunt.com/',
  qq:          'https://om.qq.com/',
  reddit:      'https://www.reddit.com/',
  sohu:        'https://mp.sohu.com/',
  sspai:       'https://sspai.com/',
  toutiao:     'https://mp.toutiao.com/',
  v2ex:        'https://www.v2ex.com/',
  wechat:      'https://mp.weixin.qq.com/',
  weibo:       'https://weibo.com/',
  x:           'https://x.com/home',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  zhihu:       'https://www.zhihu.com/',
}

const BROWSE_DURATION_MS = 90 * 1000  // 每个平台浏览 90 秒
const MAX_RETRIES = 3
const NAV_TIMEOUT = 60000

// ============================================================
// 解析 content.md
// ============================================================
function parseContentMd(mdPath) {
  if (!fs.existsSync(mdPath)) return null
  const md = fs.readFileSync(mdPath, 'utf8')
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
  for (const k of Object.keys(sections)) {
    sections[k] = sections[k].trim()
  }
  return sections
}

function buildPost(platform, contentDir) {
  const mdPath = path.join(contentDir, 'content.md')
  const sections = parseContentMd(mdPath)
  if (!sections) return null

  const post = {
    title: sections.title || '',
    content: sections.body || '',
    images: [],
    tags: [],
    dryRun: true,  // 不实际发布
  }

  // 解析 tags
  if (sections.tags) {
    post.tags = sections.tags.split('\n').filter(l => l.startsWith('- ')).map(l => l.replace(/^-\s*/, '').trim())
  }

  // 解析图片
  if (sections.assets) {
    const assets = sections.assets.split('\n').filter(l => l.startsWith('- ')).map(l => l.replace(/^-\s*/, '').trim())
    for (const a of assets) {
      const imgPath = path.join(contentDir, a)
      if (fs.existsSync(imgPath)) {
        post.images.push(imgPath)
      }
    }
  }

  // 平台特殊处理
  if (platform === 'reddit' && sections.subreddit) {
    post.subreddit = sections.subreddit
  }
  if (platform === 'x') {
    // X 无标题，用 body
    post.content = post.content || post.title
  }

  return post
}

// ============================================================
// 测试结果收集
// ============================================================
const results = {
  publish: [],
  read: [],
  browse: [],
}

function addResult(category, platform, testName, success, message, elapsed, attempts) {
  results[category].push({ platform, testName, success, message, elapsed, attempts, time: new Date().toISOString() })
}

// ============================================================
// 核心测试函数
// ============================================================

async function testPublish(platform, contentDir) {
  const post = buildPost(platform, contentDir)
  if (!post) {
    addResult('publish', platform, 'dryRun发布', false, '无法解析 content.md', 0, 0)
    return
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now()
    let browser, page
    try {
      log.info(`\n[批量测试][${platform}][发布] 第 ${attempt} 次尝试 (dryRun)`)

      const result = await getBrowser()
      browser = result.browser
      page = result.page

      const AdapterClass = await loadAdapter(platform)
      const adapter = new AdapterClass(page)

      // 跳过预热浏览和步骤间浏览（加速测试）
      adapter.warmupBrowse = async () => {}
      adapter.browseForStep = async () => {}
      adapter.fillRemainingTime = async () => {}
      adapter.postPublishBrowse = async () => {}

      await adapter.init()
      const pubResult = await adapter.publish(post)
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)

      if (pubResult.success) {
        log.info(`[批量测试][${platform}][发布] ✅ 成功 (${elapsed}s, 第${attempt}次)`)
        addResult('publish', platform, 'dryRun发布', true, pubResult.message, elapsed, attempt)
        return
      } else {
        log.warn(`[批量测试][${platform}][发布] ❌ 失败: ${pubResult.message} (${elapsed}s, 第${attempt}次)`)
        if (attempt === MAX_RETRIES) {
          addResult('publish', platform, 'dryRun发布', false, pubResult.message, elapsed, attempt)
        }
      }
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      log.error(`[批量测试][${platform}][发布] 💥 异常: ${err.message} (${elapsed}s, 第${attempt}次)`)
      if (attempt === MAX_RETRIES) {
        addResult('publish', platform, 'dryRun发布', false, `异常: ${err.message}`, elapsed, attempt)
      }
    } finally {
      try { if (page) await closePage(page) } catch {}
      try { if (browser) await disconnectBrowser(browser) } catch {}
    }

    // 重试前等待
    if (attempt < MAX_RETRIES) {
      log.info(`[批量测试][${platform}] 等待 5 秒后重试...`)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

async function testRead(platform) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now()
    let browser, page
    try {
      log.info(`\n[批量测试][${platform}][数据] 第 ${attempt} 次尝试`)

      const result = await getBrowser()
      browser = result.browser
      page = result.page

      const ReaderClass = await loadReader(platform)
      const reader = new ReaderClass(page)
      await reader.init()

      // 尝试读取
      let readResult
      if (typeof reader.readOverview === 'function') {
        readResult = await reader.readOverview()
      } else if (typeof reader.readPostStats === 'function') {
        readResult = await reader.readPostStats({ url: null })
      } else {
        readResult = { message: 'reader 无 readOverview/readPostStats 方法' }
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      log.info(`[批量测试][${platform}][数据] ✅ 完成 (${elapsed}s): ${JSON.stringify(readResult).slice(0, 200)}`)
      addResult('read', platform, '数据读取', true, JSON.stringify(readResult).slice(0, 300), elapsed, attempt)
      return
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      log.error(`[批量测试][${platform}][数据] ❌ 失败: ${err.message} (${elapsed}s, 第${attempt}次)`)
      if (attempt === MAX_RETRIES) {
        addResult('read', platform, '数据读取', false, err.message, elapsed, attempt)
      }
    } finally {
      try { if (page) await closePage(page) } catch {}
      try { if (browser) await disconnectBrowser(browser) } catch {}
    }

    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

async function testBrowse(platform) {
  const homeUrl = HOME_URLS[platform]
  if (!homeUrl) {
    addResult('browse', platform, '养号浏览', false, '无首页 URL', 0, 0)
    return
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now()
    let browser, page
    try {
      log.info(`\n[批量测试][${platform}][养号] 第 ${attempt} 次尝试 (${BROWSE_DURATION_MS/1000}s)`)

      const result = await getBrowser()
      browser = result.browser
      page = result.page

      // 导航到首页
      await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
      log.info(`[批量测试][${platform}][养号] 首页已打开: ${page.url()}`)

      // 检查登录状态（简单检查 URL 是否被重定向到 login）
      const currentUrl = page.url()
      if (currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl.includes('passport')) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1)
        log.warn(`[批量测试][${platform}][养号] ⚠️ 可能未登录: ${currentUrl}`)
        addResult('browse', platform, '养号浏览', false, `可能未登录: ${currentUrl}`, elapsed, attempt)
        return  // 未登录不重试
      }

      // 短时间模拟浏览
      const { simulateBrowsing } = await import(pathToFileURL(path.join(projectRoot, 'core/human.js')).href)
      const { createHumanCursor } = await import(pathToFileURL(path.join(projectRoot, 'core/human.js')).href)
      const cursor = await createHumanCursor(page)
      await simulateBrowsing(page, cursor, BROWSE_DURATION_MS)

      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      log.info(`[批量测试][${platform}][养号] ✅ 完成 (${elapsed}s)`)
      addResult('browse', platform, '养号浏览', true, `浏览 ${elapsed}s`, elapsed, attempt)
      return
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      log.error(`[批量测试][${platform}][养号] ❌ 失败: ${err.message} (${elapsed}s, 第${attempt}次)`)
      if (attempt === MAX_RETRIES) {
        addResult('browse', platform, '养号浏览', false, err.message, elapsed, attempt)
      }
    } finally {
      try { if (page) await closePage(page) } catch {}
      try { if (browser) await disconnectBrowser(browser) } catch {}
    }

    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

// ============================================================
// 主流程
// ============================================================

const allPlatforms = listPlatforms().filter(p => !SKIP_PLATFORMS.includes(p))
const publishPlatforms = allPlatforms.filter(p => CONTENT_MAP[p])
const readPlatforms = allPlatforms.filter(p => READER_PLATFORMS.includes(p))

log.info('╔════════════════════════════════════════════════╗')
log.info('║        全平台批量测试开始                       ║')
log.info('╚════════════════════════════════════════════════╝')
log.info(`平台总数: ${allPlatforms.length} (跳过: ${SKIP_PLATFORMS.join(', ')})`)
log.info(`可发布测试: ${publishPlatforms.length} 个 (${publishPlatforms.join(', ')})`)
log.info(`可数据读取: ${readPlatforms.length} 个 (${readPlatforms.join(', ')})`)
log.info(`养号浏览: ${allPlatforms.length} 个`)
log.info(`每次浏览: ${BROWSE_DURATION_MS/1000}s | 最多重试: ${MAX_RETRIES} 次`)
log.info(`Vision: ${config.vision?.enabled ? '开启' : '关闭'}`)
log.info('')

const totalStart = Date.now()

// ==================== 第 1 轮：发布测试 ====================
log.info('━━━━━━━━━━ 第 1 轮：发布测试 (dryRun) ━━━━━━━━━━')
for (const platform of publishPlatforms) {
  await testPublish(platform, CONTENT_MAP[platform])
}

// ==================== 第 2 轮：数据读取 ====================
log.info('\n━━━━━━━━━━ 第 2 轮：数据读取 ━━━━━━━━━━')
for (const platform of readPlatforms) {
  await testRead(platform)
}

// ==================== 第 3 轮：养号浏览 ====================
log.info('\n━━━━━━━━━━ 第 3 轮：养号浏览 ━━━━━━━━━━')
for (const platform of allPlatforms) {
  await testBrowse(platform)
}

// ============================================================
// 汇总报告
// ============================================================
const totalElapsed = ((Date.now() - totalStart) / 1000 / 60).toFixed(1)

const report = []
report.push('')
report.push('╔════════════════════════════════════════════════════════════╗')
report.push('║               全平台测试汇总报告                           ║')
report.push('╚════════════════════════════════════════════════════════════╝')
report.push(`总耗时: ${totalElapsed} 分钟`)
report.push('')

for (const category of ['publish', 'read', 'browse']) {
  const items = results[category]
  const passed = items.filter(i => i.success).length
  const failed = items.filter(i => !i.success).length
  const label = category === 'publish' ? '发布测试' : category === 'read' ? '数据读取' : '养号浏览'

  report.push(`━━━ ${label}: ${passed}✅ ${failed}❌ (共${items.length}个) ━━━`)
  for (const item of items) {
    const icon = item.success ? '✅' : '❌'
    report.push(`  ${icon} ${item.platform.padEnd(14)} ${item.elapsed}s (${item.attempts}次) — ${item.message.slice(0, 80)}`)
  }
  report.push('')
}

// 输出并写入文件
const reportText = report.join('\n')
console.log(reportText)
log.info(reportText)

const reportPath = path.join(projectRoot, 'logs', `batch-test-${new Date().toISOString().slice(0,10)}.txt`)
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, reportText, 'utf8')
log.info(`\n报告已保存: ${reportPath}`)
