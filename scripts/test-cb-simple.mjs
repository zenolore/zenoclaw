/**
 * 简化版测试：只测 contentBlocks 发布流程，跳过预热浏览
 */
import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer-core'

const repoRoot = 'C:/Zeno-Growth-System'
const imgDir = path.join(repoRoot, 'data', 'article-images')
const images = fs.readdirSync(imgDir).filter(f => f.endsWith('.png')).slice(0, 3).map(f => path.join(imgDir, f))

console.log(`找到 ${images.length} 张测试图片`)

const contentBlocks = [
  { type: 'text', value: '你现在要办"租房提取公积金"，先别急着到处搜教程，先把这三件事确认了：\n\n【是不是在北京连续足额缴存满3个月】\n【你和配偶在北京名下有没有房】' },
  { type: 'image', src: images[0], caption: '公积金提取流程图' },
  { type: 'text', value: '【北京住房公积金管理中心官网】、【北京市政务服务网"京通"小程序】。别在一堆非官方文章里转来转去，越看越乱。' },
  { type: 'image', src: images[1], caption: '办理材料清单' },
  { type: 'text', value: '【本文更新时间：2026-04-17】\n\n*免责提示：本文按北京公开办事信息整理。*' },
]

async function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

async function pasteText(page, text) {
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, text)
  await delay(500)
}

async function pasteImage(page, filePath) {
  const buf = fs.readFileSync(filePath)
  const base64 = buf.toString('base64')
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png'
  const fileName = path.basename(filePath)

  await page.evaluate(async (b64, mime, name) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: mime })
    const file = new File([blob], name, { type: mime })
    const dt = new DataTransfer()
    dt.items.add(file)
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, base64, mimeType, fileName)

  console.log(`  图片上传中: ${fileName}`)
  await delay(5000)

  const uploaded = await page.evaluate(() => {
    const imgs = document.querySelectorAll('div.ProseMirror img')
    const last = imgs[imgs.length - 1]
    return last?.getAttribute('web_uri') || ''
  })
  if (uploaded) console.log(`  ✅ 上传成功: ${uploaded.slice(0, 40)}`)
  else console.log('  ⚠️ 可能仍在上传')
}

let browser
try {
  const resp = await fetch('http://127.0.0.1:9222/json/version')
  const data = await resp.json()
  browser = await puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl, defaultViewport: null })
  console.log('Chrome 连接成功')

  const page = await browser.newPage()
  console.log('导航到发布页...')
  await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('div.ProseMirror', { timeout: 15000 })
  await delay(2000)

  // 输入标题
  console.log('[Step 2] 输入标题')
  const titleEl = await page.$('textarea[placeholder*="标题"]')
  await titleEl.click()
  await page.keyboard.type('【测试】contentBlocks 端到端验证', { delay: 40 })
  await delay(500)

  // 输入正文 contentBlocks
  console.log('[Step 3] 输入正文 contentBlocks')
  const editor = await page.$('div.ProseMirror')
  await editor.click()
  await delay(300)

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    if (block.type === 'text') {
      await pasteText(page, block.value)
      await page.keyboard.press('Enter')
      await delay(300)
      console.log(`  文字块 ${i + 1} 已输入 (${block.value.length} 字)`)
    } else if (block.type === 'image') {
      await pasteImage(page, block.src)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await delay(300)
    }
  }

  // 验证
  const editorText = await page.evaluate(() => document.querySelector('.ProseMirror')?.innerText?.length || 0)
  const imgCount = await page.evaluate(() => document.querySelectorAll('.ProseMirror img').length)
  console.log(`\n✅ 正文验证: ${editorText} 字, ${imgCount} 张图片`)

  await page.evaluate(() => window.scrollTo(0, 0))
  console.log('\n测试完成！请在浏览器中查看效果。')

} catch (err) {
  console.error('测试失败:', err.message)
  console.error(err.stack)
  process.exitCode = 1
} finally {
  if (browser) browser.disconnect()
}
