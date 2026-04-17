/**
 * 正文插图 + 三图封面 演示脚本
 * 在用户的 Chrome 里实际操作，可视化验证效果
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(projectRoot, '..')

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

const { getBrowser, disconnectBrowser } = await import(pathToFileURL(path.join(projectRoot, 'core/browser.js')).href)

// 3张不同的封面图
const coverImages = [
  'cover-a_mnxws0lg_5q6q-1776129711529.png',
  'cover-a_mnxws0lg_5q6q-1776129775969.png',
  'cover-a_mnxws0lg_5q6q-1776129792694.png',
].map(name => path.resolve(repoRoot, 'data', 'article-images', name))

// 检查图片存在
for (const p of coverImages) {
  if (!fs.existsSync(p)) throw new Error(`图片不存在: ${p}`)
}

// 2 张正文插图（复用封面图）
const inlineImages = [coverImages[1], coverImages[2]]

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

let browser = null
try {
  const br = await getBrowser()
  browser = br.browser
  const page = br.page
  log.info('Chrome 连接成功')

  // ═══════ 1. 打开发布页 ═══════
  log.info('[1] 打开发布页')
  await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('div.ProseMirror', { timeout: 15000 })
  await delay(3000)

  // ═══════ 2. 输入标题 ═══════
  log.info('[2] 输入标题')
  const titleEl = await page.$('textarea[placeholder*="标题"]')
  await titleEl.click()
  await page.keyboard.type('租房提取公积金完整攻略：条件材料流程一篇搞定', { delay: 40 })
  await delay(500)

  // ═══════ 3. 输入正文（文字 + 插图 交替）═══════
  log.info('[3] 输入正文（含插图）')
  const editor = await page.$('div.ProseMirror')
  await editor.click()
  await delay(300)

  // 辅助：粘贴文字段落
  async function pasteText(text) {
    await page.evaluate((t) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    }, text)
    await delay(500)
  }

  // 辅助：粘贴图片文件（编辑器自动上传到头条 CDN）
  async function pasteImageFile(filePath) {
    const buf = fs.readFileSync(filePath)
    const base64 = buf.toString('base64')
    const ext = path.extname(filePath).toLowerCase()
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
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

    // 等待上传完成
    log.info(`  图片上传中: ${fileName}`)
    await delay(5000)

    // 验证上传成功（检查 web_uri）
    const uploaded = await page.evaluate(() => {
      const imgs = document.querySelectorAll('div.ProseMirror img')
      const last = imgs[imgs.length - 1]
      return last?.getAttribute('web_uri') || ''
    })
    if (uploaded) {
      log.info(`  ✅ 图片已上传到 CDN: ${uploaded.slice(0, 50)}`)
    } else {
      log.warn('  ⚠️ 图片可能还在上传中')
    }
  }

  // === 段落 1 ===
  await pasteText('你现在要办"租房提取公积金"，先别急着到处搜教程，先把这三件事确认了：\n\n【是不是在北京连续足额缴存满3个月】\n【你和配偶在北京名下有没有房】\n【你打算走普通租房提取，还是想按实际房租提取】\n\n这三件事一清楚，后面就顺了。如果你想自己查官方入口，记住这两个名字就够了。')
  await page.keyboard.press('Enter')
  await delay(300)
  log.info('  段落1 已输入')

  // === 图片 1 ===
  await pasteImageFile(inlineImages[0])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await delay(300)

  // === 段落 2 ===
  await pasteText('【北京住房公积金管理中心官网】、【北京市政务服务网"京通"小程序】。别在一堆非官方文章里转来转去，越看越乱。\n\n先讲最常用的：自己申请租房提取，钱提到本人账户。如果你就是普通租房住，每个月想把符合条件的公积金提出来贴补房租，这种最常见。')
  await page.keyboard.press('Enter')
  await delay(300)
  log.info('  段落2 已输入')

  // === 图片 2 ===
  await pasteImageFile(inlineImages[1])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await delay(300)

  // === 段落 3 ===
  await pasteText('【本文更新时间：2026-04-14】\n\n*免责提示：本文按北京公开办事信息整理，便于你理解流程。具体提取条件、材料要求、办理时限和是否适用试点，请以北京住房公积金管理中心及北京市政务服务网最新页面为准。*')
  await delay(500)
  log.info('  段落3 已输入')

  log.info('[3] ✅ 正文 + 2张插图 输入完成')

  // ═══════ 4. 设置三图封面 ═══════
  log.info('[4] 设置三图封面')

  // 滚动到封面区域
  await page.evaluate(() => {
    document.querySelector('.article-cover')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
  await delay(500)

  // 点击"三图" radio（用 Puppeteer 的真实鼠标点击，不用 evaluate）
  const triRadio = await page.evaluateHandle(() => {
    const labels = document.querySelectorAll('.article-cover-radio-group label.byte-radio')
    for (const l of labels) {
      if (l.textContent?.includes('三图')) return l
    }
    return null
  })
  if (triRadio) {
    await triRadio.click()
    await delay(1500)
    log.info('  三图模式已选中')
  } else {
    throw new Error('未找到三图 radio')
  }

  // 检查当前封面状态
  const initialCoverState = await page.evaluate(() => {
    const slots = document.querySelectorAll('.article-cover-images > .byte-spin')
    return Array.from(slots).map((s, i) => ({
      slot: i,
      hasImg: !!s.querySelector('img[alt="cover"]'),
      hasAdd: !!s.querySelector('.article-cover-add'),
    }))
  })
  log.info(`  当前封面: ${JSON.stringify(initialCoverState)}`)

  // 辅助：通过抽屉上传一张封面
  async function uploadCoverViaDrawer(imagePath) {
    // 找到 add 按钮
    const addBtns = await page.$$('.article-cover-add')
    if (addBtns.length === 0) {
      log.info('  所有封面槽位已填满')
      return
    }

    // 点击 add 按钮
    await addBtns[0].evaluate(node => node.scrollIntoView({ block: 'center' }))
    await delay(300)
    await addBtns[0].click().catch(async () => {
      // 如果普通 click 被遮挡，用 evaluate click
      await addBtns[0].evaluate(node => node.click())
    })
    await delay(2000)

    // 切换到"上传图片" tab
    const uploadTab = await page.evaluateHandle(() => {
      const tabs = document.querySelectorAll('.mp-ic-img-drawer .byte-tabs-header-title')
      for (const t of tabs) {
        if (t.textContent?.includes('上传图片')) return t
      }
      return null
    })
    if (uploadTab) {
      await uploadTab.click()
      await delay(1000)
    }

    // 找到 file input 并上传
    const fileInput = await page.$('.mp-ic-img-drawer input[type="file"][accept="image/*"]')
    if (!fileInput) throw new Error('抽屉中未找到 file input')

    await fileInput.uploadFile(imagePath)
    log.info(`  封面上传中: ${path.basename(imagePath)}`)
    await delay(5000)

    // 点击确定
    const confirmBtn = await page.evaluateHandle(() => {
      const btns = document.querySelectorAll('.mp-ic-img-drawer button')
      for (const b of btns) {
        if (b.textContent?.trim() === '确定') return b
      }
      return null
    })
    if (confirmBtn) {
      await confirmBtn.click()
      await delay(2000)
      log.info('  ✅ 封面已确认')
    } else {
      log.warn('  ⚠️ 未找到确定按钮')
    }
  }

  // 上传剩余封面（slot 0 可能已被正文图片自动填充）
  for (let i = 0; i < coverImages.length; i++) {
    const addBtns = await page.$$('.article-cover-add')
    if (addBtns.length === 0) {
      log.info('  所有 3 个封面槽位已填满')
      break
    }
    log.info(`  上传封面 ${i + 1} (剩余 ${addBtns.length} 个空位)`)
    await uploadCoverViaDrawer(coverImages[i])
  }

  // 最终封面验证
  const finalCoverState = await page.evaluate(() => {
    const slots = document.querySelectorAll('.article-cover-images > .byte-spin')
    return Array.from(slots).map((s, i) => ({
      slot: i,
      hasImg: !!s.querySelector('img[alt="cover"]'),
      src: s.querySelector('img[alt="cover"]')?.src?.slice(0, 60) || '',
    }))
  })
  log.info(`[4] ✅ 封面最终状态: ${JSON.stringify(finalCoverState)}`)

  // ═══════ 5. 滚到顶部让用户看完整效果 ═══════
  await page.evaluate(() => window.scrollTo(0, 0))
  await delay(500)

  log.info('═══════════════════════════════════════')
  log.info('✅ 演示完成！请在浏览器中查看效果：')
  log.info('   - 正文：3段文字 + 2张插图')
  log.info('   - 封面：三图模式，3张全部填充')
  log.info('═══════════════════════════════════════')

} catch (err) {
  log.error(`演示失败: ${err.message}`)
  log.error(err.stack)
  process.exitCode = 1
} finally {
  if (browser) {
    await disconnectBrowser(browser).catch(() => {})
    log.info('已断开连接（浏览器保持打开）')
  }
}
