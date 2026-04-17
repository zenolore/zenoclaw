/**
 * 小红书发布测试 (dryRun)
 * node scripts/test-xhs-publish.mjs
 */
import puppeteer from 'puppeteer-core'
import { loadAdapter } from '../platforms/loader.js'
import { initConfig, cfg } from '../core/config.js'
import { initLogger, getLogger } from '../core/logger.js'
import fs from 'fs'
import path from 'path'

const config = initConfig()
initLogger(config)
const log = getLogger()

const CONTENT_DIR = 'C:\\Zeno-Growth-System\\content\\outputs\\xiaohongshu\\20260425-001'

// Parse content.md
const mdPath = path.join(CONTENT_DIR, 'content.md')
const md = fs.readFileSync(mdPath, 'utf-8')
const titleMatch = md.match(/^#\s+(.+)$/m) || md.match(/^title:\s*(.+)$/mi)
const title = titleMatch ? titleMatch[1].trim() : '测试标题'

// Extract body (after first heading)
const bodyMatch = md.match(/^#\s+.+\n+([\s\S]+)/m)
let body = bodyMatch ? bodyMatch[1].trim() : md.trim()
// Remove image markdown references
body = body.replace(/!\[.*?\]\(.*?\)/g, '').trim()

// Find images
const imgExts = ['.jpg', '.jpeg', '.png', '.webp']
const images = fs.readdirSync(CONTENT_DIR)
  .filter(f => imgExts.includes(path.extname(f).toLowerCase()))
  .map(f => path.join(CONTENT_DIR, f))

// Extract tags
const tagMatch = md.match(/tags?:\s*\[([^\]]+)\]/i) || md.match(/标签[：:]\s*(.+)/m)
const tags = tagMatch
  ? tagMatch[1].split(/[,，]/).map(t => t.replace(/['"]/g, '').trim()).filter(Boolean)
  : []

const post = { title, body, images, tags, dryRun: true }

log.info(`平台: xiaohongshu`)
log.info(`标题: ${title}`)
log.info(`正文: ${body.slice(0, 80)}...`)
log.info(`图片: ${images.length} 张`)
log.info(`标签: ${tags.join(', ')}`)
log.info(`模式: dryRun`)

async function main() {
  const resp = await fetch('http://127.0.0.1:9222/json/version')
  const { webSocketDebuggerUrl } = await resp.json()
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl, defaultViewport: null })

  const page = await browser.newPage()
  const AdapterClass = await loadAdapter('xiaohongshu')
  const adapter = new AdapterClass(page)
  await adapter.init()

  const start = Date.now()
  try {
    const result = await adapter.publish(post)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    log.info(`发布结果: ${JSON.stringify(result)} (${elapsed}s)`)
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    log.error(`发布失败: ${err.message} (${elapsed}s)`)
  } finally {
    await page.close().catch(() => {})
    await browser.disconnect()
  }
}

main().catch(e => { log.error('FATAL: ' + e.message); process.exit(1) })
