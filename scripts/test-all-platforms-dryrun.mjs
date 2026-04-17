/**
 * 全平台 CDP dryRun 端到端测试
 * 通过 CDP 连接已打开的 Chrome，逐个测试所有文章发布平台
 *
 * 用法: node zenoclaw/scripts/test-all-platforms-dryrun.mjs [platform]
 *   不指定 platform 则测试全部4个
 *   指定则只测试该平台：toutiao / baijiahao / zhihu / wechat
 */
import puppeteer from 'puppeteer-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const TEST_IMAGES = [
  path.join(ROOT, 'data/article-images/cover-a_mnxws0lg_5q6q-1776129711529.png'),
  path.join(ROOT, 'data/article-images/cover-a_mnxws0lg_5q6q-1776129775969.png'),
  path.join(ROOT, 'data/article-images/cover-a_mnxws0lg_5q6q-1776129792694.png'),
]

const PLATFORM_CONFIG = {
  toutiao: {
    module: '../platforms/toutiao/publisher.js',
    className: 'ToutiaoAdapter',
    post: {
      title: '【dryRun测试】头条自动发布全组件验证',
      content: '这是一段用于测试头条发布器的正文内容。\n\n以下是几个要点：\n1. 标题输入使用 ProseMirror 编辑器\n2. 正文通过 ProseMirror 输入\n3. 封面图支持单图和三图模式\n\n测试时间: ' + new Date().toLocaleString('zh-CN'),
      images: TEST_IMAGES.slice(0, 1),
      coverType: 'single',
      dryRun: true,
    },
  },
  baijiahao: {
    module: '../platforms/baijiahao/publisher.js',
    className: 'BaijiahaoAdapter',
    post: {
      title: '【dryRun测试】百家号自动发布全组件验证',
      content: '这是一段用于测试百家号发布器的正文内容。\n\n以下是几个要点：\n1. 标题输入使用 Lexical 编辑器\n2. 正文通过 UEditor iframe 输入\n3. 封面图支持单图和三图模式\n4. 创作声明支持 AI 内容标记\n\n测试时间: ' + new Date().toLocaleString('zh-CN'),
      images: TEST_IMAGES,
      coverType: 'triple',
      declareAiContent: true,
      dryRun: true,
    },
  },
  zhihu: {
    module: '../platforms/zhihu/publisher.js',
    className: 'ZhihuAdapter',
    post: {
      title: '【dryRun测试】知乎自动发布全组件验证',
      content: '这是一段用于测试知乎发布器的正文内容。\n\n以下是几个要点：\n1. 标题输入使用 textarea\n2. 正文通过 Draft.js 编辑器输入\n3. 封面图单张上传\n4. 话题标签自动搜索\n\n测试时间: ' + new Date().toLocaleString('zh-CN'),
      images: TEST_IMAGES.slice(0, 1),
      coverType: 'single',
      tags: ['科技', 'AI'],
      dryRun: true,
    },
  },
  wechat: {
    module: '../platforms/wechat/publisher.js',
    className: 'WechatAdapter',
    post: {
      title: '【dryRun测试】微信公众号自动发布全组件验证',
      content: '这是一段用于测试微信公众号发布器的正文内容。\n\n以下是几个要点：\n1. 标题输入使用 textarea\n2. 正文通过 ProseMirror 编辑器输入\n3. 封面图单张上传\n4. 原创声明自动勾选\n\n测试时间: ' + new Date().toLocaleString('zh-CN'),
      images: TEST_IMAGES.slice(0, 1),
      coverType: 'single',
      author: 'Zeno',
      dryRun: true,
    },
  },
}

async function testPlatform(browser, platformName) {
  const config = PLATFORM_CONFIG[platformName]
  if (!config) { console.error(`未知平台: ${platformName}`); return null }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`  测试平台: ${platformName}`)
  console.log(`${'='.repeat(60)}`)

  // 微信特殊：尝试复用已有已登录标签页
  let page
  if (platformName === 'wechat') {
    const pages = await browser.pages()
    const existing = pages.find(p => p.url().includes('mp.weixin.qq.com') && !p.url().includes('login'))
    if (existing) {
      page = existing
      console.log(`  复用已有微信标签页: ${page.url().slice(0, 60)}`)
    } else {
      page = await browser.newPage()
      console.log('  ⚠️ 未找到已登录的微信标签页，使用新标签页（可能需要登录）')
    }
  } else {
    page = await browser.newPage()
  }

  try {
    const mod = await import(config.module)
    const AdapterClass = mod[config.className]
    const adapter = new AdapterClass(page)

    // 跳过所有非核心延迟步骤（测试用）
    adapter.warmupBrowse = async () => {}
    adapter.fillRemainingTime = async () => {}
    adapter.postPublishBrowse = async () => {}
    adapter.browseForStep = async () => {}
    adapter.verifyBeforePublish = async () => ({ pass: true, confidence: 1, details: 'skipped' })
    adapter.conditionalScreenshot = async () => {}
    adapter.showStatus = async () => {}
    adapter.hideStatus = async () => {}
    adapter.reinitCursor = async () => { adapter.cursor = null }
    adapter.actionPause = async () => {}

    await adapter.init()

    const result = await adapter.publish(config.post)

    console.log(`\n  --- ${platformName} 结果 ---`)
    console.log(`  success: ${result.success}`)
    console.log(`  message: ${result.message}`)

    if (result.step_report) {
      for (const step of result.step_report) {
        const dur = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : '-'
        console.log(`    ${step.status === 'passed' ? '✅' : '❌'} ${step.stepName} (${dur})`)
        if (step.evidence?.length) {
          for (const ev of step.evidence) {
            console.log(`       📎 ${ev.key}: ${JSON.stringify(ev.value).slice(0, 100)}`)
          }
        }
      }
    }

    return result
  } catch (err) {
    console.error(`  ${platformName} 测试异常: ${err.message}`)
    return { success: false, message: err.message }
  }
  // 不关闭页面，保留供手动检查
}

async function main() {
  const targetPlatform = process.argv[2]
  const platforms = targetPlatform ? [targetPlatform] : ['toutiao', 'baijiahao', 'zhihu', 'wechat']

  console.log('=== 全平台 CDP dryRun 测试 ===')
  console.log(`目标平台: ${platforms.join(', ')}`)
  console.log(`测试图片: ${TEST_IMAGES[0]}`)
  console.log('')

  // 连接 Chrome CDP
  const resp = await fetch('http://127.0.0.1:9222/json/version')
  const data = await resp.json()
  const browser = await puppeteer.connect({
    browserWSEndpoint: data.webSocketDebuggerUrl,
    defaultViewport: null,
  })
  console.log('已连接 Chrome CDP')

  const results = {}
  for (const platform of platforms) {
    results[platform] = await testPlatform(browser, platform)
  }

  // 汇总
  console.log(`\n${'='.repeat(60)}`)
  console.log('  测试汇总')
  console.log(`${'='.repeat(60)}`)
  for (const [name, result] of Object.entries(results)) {
    const status = result?.success ? '✅ PASS' : '❌ FAIL'
    console.log(`  ${status}  ${name}: ${result?.message || 'unknown'}`)
  }

  const allPass = Object.values(results).every(r => r?.success)
  console.log(`\n全部通过: ${allPass ? '✅ YES' : '❌ NO'}`)

  browser.disconnect()
}

main().catch(console.error)
