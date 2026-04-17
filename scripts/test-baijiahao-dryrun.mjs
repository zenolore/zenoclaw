/**
 * 百家号 dryRun 端到端测试
 * 通过 CDP 连接已打开的 Chrome，测试百家号发布全流程（不实际发布）
 *
 * 用法: node zenoclaw/scripts/test-baijiahao-dryrun.mjs
 */
import puppeteer from 'puppeteer-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

async function main() {
  console.log('=== 百家号 dryRun 测试 ===')

  // 连接 Chrome CDP
  const resp = await fetch('http://127.0.0.1:9222/json/version')
  const data = await resp.json()
  const browser = await puppeteer.connect({
    browserWSEndpoint: data.webSocketDebuggerUrl,
    defaultViewport: null,
  })

  const page = await browser.newPage()
  console.log('已连接 Chrome CDP，打开新标签页')

  // 动态导入 adapter
  const { BaijiahaoAdapter } = await import('../platforms/baijiahao/publisher.js')
  const adapter = new BaijiahaoAdapter(page)
  // 跳过预热浏览（测试用）
  adapter.warmupBrowse = async () => { console.log('[测试] 跳过预热浏览') }
  adapter.fillRemainingTime = async () => { console.log('[测试] 跳过时间补足') }
  adapter.postPublishBrowse = async () => { console.log('[测试] 跳过发布后浏览') }
  await adapter.init()

  // 准备测试数据
  const testImages = [
    path.join(ROOT, 'data/article-images/cover-a_mnxws0lg_5q6q-1776129711529.png'),
    path.join(ROOT, 'data/article-images/cover-a_mnxws0lg_5q6q-1776129775969.png'),
    path.join(ROOT, 'data/article-images/cover-a_mnxws0lg_5q6q-1776129792694.png'),
  ]

  const testPost = {
    title: '【dryRun测试】百家号自动发布全组件验证',
    content: [
      '这是一段用于测试百家号发布器的正文内容。',
      '',
      '以下是几个要点：',
      '1. 标题输入使用 Lexical 编辑器',
      '2. 正文通过 UEditor iframe 输入',
      '3. 封面图支持单图和三图模式',
      '4. 创作声明支持 AI 内容标记',
      '',
      '测试时间: ' + new Date().toLocaleString('zh-CN'),
    ].join('\n'),
    images: testImages,
    coverType: 'triple',
    declareAiContent: true,
    dryRun: true,
  }

  console.log(`标题: ${testPost.title}`)
  console.log(`封面类型: ${testPost.coverType}`)
  console.log(`图片数: ${testPost.images.length}`)
  console.log(`dryRun: ${testPost.dryRun}`)
  console.log('')

  try {
    const result = await adapter.publish(testPost)
    console.log('\n=== 发布结果 ===')
    console.log(`success: ${result.success}`)
    console.log(`message: ${result.message}`)
    if (result.step_report) {
      console.log('\n步骤报告:')
      for (const step of result.step_report) {
        const dur = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : '-'
        console.log(`  ${step.status === 'passed' ? '✅' : '❌'} ${step.stepName} (${dur})`)
        if (step.evidence?.length) {
          for (const ev of step.evidence) {
            console.log(`     📎 ${ev.key}: ${JSON.stringify(ev.value).slice(0, 80)}`)
          }
        }
      }
    }
  } catch (err) {
    console.error('测试异常:', err.message)
  }

  // 不关闭页面，保留以便手动检查
  console.log('\n页面保留，可手动检查结果。')
  browser.disconnect()
}

main().catch(console.error)
