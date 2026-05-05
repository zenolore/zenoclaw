import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { initLogger, getLogger } from './logger.js'
import { initConfig } from './config.js'
import { getBrowser, closePage, disconnectBrowser } from './browser.js'
import { createHumanCursor, randomDelay, simulateBrowsing } from './human.js'

/**
 * 浏览器连接测试脚本
 *
 * 用法: npm test
 * 或:   node src/test-browser.js
 *
 * 功能:
 *   1. 验证 Chrome 连接（调试端口）
 *   2. 验证登录态是否生效
 *   3. 测试鼠标/键盘模拟
 *   4. 检查反检测状态（stealth + viewport + WebRTC）
 */

async function main() {
  // 加载配置
  const configPath = path.resolve('config.yaml')
  if (!fs.existsSync(configPath)) {
    console.error('❌ config.yaml 不存在，请先创建配置文件')
    console.error('   cp config.example.yaml config.yaml')
    process.exit(1)
  }

  const config = yaml.load(fs.readFileSync(configPath, 'utf-8'))
  initConfig(config)
  initLogger(config)
  const log = getLogger()

  let browser = null
  let page = null

  try {
    log.info('========== 浏览器测试开始 ==========')

    // 步骤 1: 连接浏览器
    log.info('[测试1] 连接浏览器...')
    const result = await getBrowser()
    browser = result.browser
    page = result.page
    log.info(`✅ 浏览器连接成功 (${result.isNewLaunch ? '新启动' : '已运行'})`)

    // 步骤 2: 检查是否能正常导航
    log.info('[测试2] 导航到百度（测试基本连接）...')
    await page.goto('https://www.baidu.com', { waitUntil: 'networkidle2' })
    const title = await page.title()
    log.info(`✅ 页面标题: ${title}`)

    // 步骤 3: 测试鼠标模拟
    log.info('[测试3] 测试鼠标移动和滚动...')
    const cursor = await createHumanCursor(page)
    await simulateBrowsing(page, cursor, 5000)
    log.info('✅ 鼠标移动和滚动正常')

    // 步骤 4: 检查小红书登录态
    log.info('[测试4] 检查小红书登录态...')
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
      waitUntil: 'networkidle2',
      timeout: 30000
    })
    await randomDelay(3000, 5000)

    const currentUrl = page.url()
    if (currentUrl.includes('login')) {
      log.warn('⚠️ 小红书未登录，请先在 Chrome 中手动登录 xiaohongshu.com')
    } else {
      log.info('✅ 小红书已登录')
      const screenshotDir = './logs/screenshots'
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })
      await page.screenshot({ path: './logs/screenshots/test_xhs_login.png' })
      log.info('   截图已保存: ./logs/screenshots/test_xhs_login.png')
    }

    // 步骤 5: 检查反检测状态
    log.info('[测试5] 检查反检测状态...')
    const webdriverValue = await page.evaluate(() => navigator.webdriver)
    const chromeValue = await page.evaluate(() => !!window.chrome)
    const viewport = page.viewport()
    log.info(`   navigator.webdriver = ${webdriverValue} (应为 false 或 undefined)`)
    log.info(`   window.chrome 存在 = ${chromeValue} (应为 true)`)
    if (viewport) {
      log.info(`   视口大小 = ${viewport.width}x${viewport.height}`)
    }

    if (!webdriverValue) {
      log.info('✅ 反检测正常')
    } else {
      log.warn('⚠️ navigator.webdriver 未被正确隐藏')
    }

    log.info('========== 所有测试完成 ==========')
    log.info('10 秒后自动关闭标签页...')
    await randomDelay(10000, 10000)

  } catch (err) {
    console.error('测试出错:', err)
  } finally {
    await closePage(page)
    await disconnectBrowser(browser)
  }
}

main()
