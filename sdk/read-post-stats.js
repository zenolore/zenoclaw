/**
 * zenoclaw/sdk/read-post-stats.js
 *
 * CLI bridge：读取指定平台帖子的互动数据，输出 JSON 到 stdout
 * 由 executor 通过 child_process.spawn 调用，无需启动 zenoclaw API server
 *
 * 用法:
 *   node zenoclaw/sdk/read-post-stats.js --platform xiaohongshu --url https://...
 *   node zenoclaw/sdk/read-post-stats.js --platform zhihu --url https://... --title "标题"
 *   node zenoclaw/sdk/read-post-stats.js --platform xiaohongshu --title "帖子标题"
 *
 * 输出 (stdout):
 *   成功: { "likes": 107, "collects": 111, "comments": 30, "views": null }
 *   失败: { "error": "错误信息" }
 *
 * 退出码: 0 成功, 1 失败
 */
import puppeteer from 'puppeteer-core'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadReader } from '../platforms/loader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs() {
  const args = process.argv.slice(2)
  const result = { platform: null, url: null, title: null, port: 9222 }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platform': result.platform = args[++i]; break
      case '--url':      result.url      = args[++i]; break
      case '--title':    result.title    = args[++i]; break
      case '--port':     result.port     = parseInt(args[++i], 10); break
    }
  }
  return result
}

function output(data) {
  process.stdout.write(JSON.stringify(data))
}

async function connectChrome(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
  if (!resp.ok) throw new Error(`Chrome 调试端口 ${port} 不可用`)
  const data = await resp.json()
  if (!data.webSocketDebuggerUrl) throw new Error('未找到 Chrome webSocketDebuggerUrl')
  return puppeteer.connect({
    browserWSEndpoint: data.webSocketDebuggerUrl,
    defaultViewport: null
  })
}

async function main() {
  const args = parseArgs()

  if (!args.platform) {
    output({ error: '缺少 --platform 参数' })
    process.exit(1)
  }
  if (!args.url && !args.title) {
    output({ error: '缺少 --url 或 --title 参数' })
    process.exit(1)
  }

  let browser = null
  let page = null

  try {
    browser = await connectChrome(args.port)
    page = await browser.newPage()

    const ReaderClass = await loadReader(args.platform)
    const reader = new ReaderClass(page)
    await reader.init()

    // 统一调用 readPostStats，与 zenoclaw scheduler 保持一致
    const post = {
      post_url: args.url || null,
      title: args.title || ''
    }
    const stats = await reader.readPostStats(post)

    if (!stats) {
      output({ error: '未获取到数据（readPostStats 返回 null）' })
    } else {
      output(stats)
    }
  } catch (err) {
    output({ error: err.message })
    process.exitCode = 1
  } finally {
    if (page) await page.close().catch(() => {})
    if (browser) browser.disconnect()
  }
}

main()
