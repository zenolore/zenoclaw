import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'
import fs from 'fs'
import { getLogger } from './logger.js'
import { cfg } from './config.js'
import { gaussianRandom } from './human.js'
import { requireHealthyFingerprint } from './fingerprint-audit.js'

// ============================================================
// 浏览器操作互斥锁
// 同一时间只允许一个任务操作浏览器，后续请求排队等待
// ============================================================
let _browserLockQueue = Promise.resolve()

/**
 * 获取浏览器操作锁
 * 返回一个 release 函数，任务完成后必须调用以释放锁
 *
 * 用法：
 *   const release = await acquireBrowserLock()
 *   try {
 *     const { browser, page } = await getBrowser()
 *     // ... 执行操作 ...
 *   } finally {
 *     release()
 *   }
 */
export function acquireBrowserLock() {
  let _release
  const waitPromise = new Promise(resolve => { _release = resolve })
  const ready = _browserLockQueue
  _browserLockQueue = _browserLockQueue.then(() => waitPromise)
  return ready.then(() => _release)
}

/**
 * 获取浏览器连接
 *
 * 优先连接已运行的 Chrome（通过 remote debugging port），
 * 如果 Chrome 未运行则自动启动。
 * 操作在新标签页中进行，不影响用户已打开的页面。
 *
 * ⚠️ 多个任务并发时，请先调用 acquireBrowserLock() 获取锁
 *
 * 配置项:
 *   browser.debug_port          — 调试端口
 *   browser.element_timeout     — 元素等待超时
 *   browser.navigation_timeout  — 导航超时
 *   browser.startup_timeout     — Chrome 启动超时
 *   stealth.random_viewport     — 是否随机化视口大小
 *   stealth.viewport_width/height_min/max — 视口范围
 *   stealth.disable_webrtc      — 是否禁用 WebRTC
 *
 * @returns {Promise<{browser: Browser, page: Page, isNewLaunch: boolean}>}
 */
export async function getBrowser() {
  const log = getLogger()
  const debugPort = cfg('browser.debug_port', 9222)

  // 带重试的连接（前次 disconnect 后 WebSocket slot 可能需要几秒释放）
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const existing = await tryConnectExisting(debugPort, log)
    if (existing) {
      log.info('已连接到当前运行的 Chrome 浏览器')
      const page = await createConfiguredPage(existing, log)
      return { browser: existing, page, isNewLaunch: false }
    }
    if (attempt < maxRetries) {
      log.info(`连接未成功，等待 3s 后重试 (${attempt}/${maxRetries})...`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // 全部重试失败 → 自动启动
  log.info('未检测到可连接的 Chrome，正在启动...')
  const browser = await launchChromeWithDebug(debugPort, log)
  const page = await createConfiguredPage(browser, log)

  return { browser, page, isNewLaunch: true }
}

/**
 * 创建一个配置好的新标签页
 * 应用超时、视口随机化、WebRTC 防护等
 */
async function createConfiguredPage(browser, log) {
  const page = await browser.newPage()

  // 超时设置
  const elementTimeout = cfg('browser.element_timeout', 30000)
  const navTimeout     = cfg('browser.navigation_timeout', 60000)
  page.setDefaultTimeout(elementTimeout)
  page.setDefaultNavigationTimeout(navTimeout)

  // ── 精准反检测补丁（替代 puppeteer-extra-plugin-stealth）──
  // 只做最小必要修改，不注入大量脚本，避免破坏 SPA 渲染
  if (cfg('stealth.patches_enabled', true)) {
    await page.evaluateOnNewDocument(() => {
      // 1. navigator.webdriver = false（最关键的检测点）
      Object.defineProperty(navigator, 'webdriver', { get: () => false })

      // 2. chrome.runtime 存在性（真实 Chrome 有此对象）
      if (!window.chrome) window.chrome = {}
      if (!window.chrome.runtime) {
        window.chrome.runtime = { connect: () => {}, sendMessage: () => {} }
      }

      // 3. plugins 数组不为空（Headless Chrome 的 plugins.length === 0）
      if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
          ]
        })
      }

      // 4. languages 一致性
      if (!navigator.languages || navigator.languages.length === 0) {
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] })
      }
    })
    log.debug('精准反检测补丁已注入（navigator.webdriver, chrome.runtime, plugins, languages）')
  }

  // WebRTC 防泄露（默认关闭，真实用户的浏览器有 WebRTC）
  if (cfg('stealth.disable_webrtc', false)) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        get: () => ({ getUserMedia: () => Promise.reject(new Error('blocked')) })
      })
      window.RTCPeerConnection = undefined
      window.webkitRTCPeerConnection = undefined
    })
    log.debug('WebRTC 已禁用')
  }

  // 指纹一致性自检（首次访问真实页面后做一次；about:blank 上 navigator 可能被裁剪）
  // 为避免阻塞 page 创建，这里只挂一个一次性 hook：等到第一次成功导航后再检查
  if (cfg('stealth.audit.enabled', true)) {
    let audited = false
    const onceAudit = async () => {
      if (audited) return
      audited = true
      try {
        const url = page.url()
        if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return
        await requireHealthyFingerprint(page)
      } catch (err) {
        // mode=block 时会抛；这里把错误重新抛出，让上层启动流程感知
        log.error(`[FingerprintAudit] ${err.message}`)
        if (cfg('stealth.audit.mode', 'warn') === 'block') throw err
      }
    }
    page.once('framenavigated', () => { onceAudit().catch(() => {}) })
  }

  return page
}

/**
 * 尝试连接已运行的 Chrome（通过 remote debugging port）
 */
async function tryConnectExisting(debugPort, log) {
  try {
    const resp = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return null

    const data = await resp.json()
    const wsUrl = data.webSocketDebuggerUrl
    if (!wsUrl) return null

    log.debug(`发现 Chrome 调试端口 ws: ${wsUrl}`)
    // 带超时的连接（防止僵死 WebSocket 导致永久挂起）
    const connectTimeout = cfg('browser.connect_timeout', 15000)
    // 2026-04-18: 不再降级到 page 级 ws（page 级 ws 下 puppeteer 事件系统失效：
    //   fileChooser、Network response、CDP events 全部无法触发）
    //   改为 browser 级 ws 带重试（3 次，每次间隔 1s）
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const browser = await Promise.race([
          puppeteer.connect({
            browserWSEndpoint: wsUrl,
            defaultViewport: null
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Chrome browser WebSocket 连接超时')), connectTimeout)
          )
        ])
        if (attempt > 1) log.info(`browser 级 ws 重试成功 (第 ${attempt} 次)`)
        return browser
      } catch (wsErr) {
        if (attempt < maxAttempts) {
          log.warn(`browser 级 ws 连接失败 (${attempt}/${maxAttempts}): ${wsErr.message}，1s 后重试`)
          await new Promise(r => setTimeout(r, 1000))
        } else {
          log.error(`browser 级 ws 连接最终失败: ${wsErr.message}。page 级降级已禁用（降级模式会导致 puppeteer 事件系统失效）`)
          return null
        }
      }
    }
    return null
  } catch (e) {
    log.warn?.(`连接已有 Chrome 失败: ${e.message}`)
    return null
  }
}

/**
 * 降级方案：当 browser WebSocket 被僵死连接占用时，
 * 通过 /json 接口获取 page 级 WebSocket URL，
 * 用 CDP 协议直接连接页面再取 browser 对象
 */
async function tryConnectViaPage(debugPort, timeout, log) {
  try {
    const resp = await fetch(`http://127.0.0.1:${debugPort}/json`, { signal: AbortSignal.timeout(5000) })
    const targets = await resp.json()
    const pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    if (!pageTarget) return null

    log.debug(`page 级 ws: ${pageTarget.webSocketDebuggerUrl}`)
    const browser = await Promise.race([
      puppeteer.connect({
        browserWSEndpoint: pageTarget.webSocketDebuggerUrl,
        defaultViewport: null
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chrome page WebSocket 连接超时')), timeout)
      )
    ])
    return browser
  } catch (e) {
    log.warn?.(`page 级连接也失败: ${e.message}`)
    return null
  }
}

/**
 * 启动 Chrome 并开启 remote debugging
 *
 * 这种方式启动的 Chrome 和你平时手动打开的完全一样：
 * - 加载你的 Profile（登录态、历史记录、书签全部在）
 * - 开启调试端口供程序连接
 * - 用户可以正常手动使用这个浏览器
 *
 * 配置项:
 *   browser.chrome_user_data — 用户数据目录（必填）
 *   browser.profile          — Profile 名称
 *   browser.chrome_path      — Chrome 可执行文件路径
 *   browser.startup_timeout  — 启动超时
 */
async function launchChromeWithDebug(debugPort, log) {
  const userDataDir = cfg('browser.chrome_user_data', '')
  if (!userDataDir) {
    throw new Error(
      'config.yaml 中 browser.chrome_user_data 未配置\n' +
      '请在 Chrome 地址栏输入 chrome://version 查找 Profile 路径'
    )
  }

  const profileDir = cfg('browser.profile', 'Default')
  const chromePath = cfg('browser.chrome_path', '') || findChromePath()

  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars'
  ]

  log.info(`启动 Chrome: ${chromePath}`)
  log.info(`Profile: ${profileDir}, 调试端口: ${debugPort}`)

  // 后台启动 Chrome 进程（不阻塞）
  const chromeProcess = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore'
  })
  chromeProcess.unref()

  // 等待 Chrome 调试端口就绪
  const startupTimeout = cfg('browser.startup_timeout', 30000)
  log.info('等待 Chrome 启动...')
  const browser = await waitForDebugPort(debugPort, startupTimeout)

  if (!browser) {
    throw new Error(`Chrome 启动超时，请检查 chrome_path 配置是否正确: ${chromePath}`)
  }

  log.info('Chrome 启动成功')
  return browser
}

/**
 * 轮询等待 Chrome 调试端口就绪
 */
async function waitForDebugPort(port, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (resp.ok) {
        const data = await resp.json()
        const wsUrl = data.webSocketDebuggerUrl
        if (wsUrl) {
          const browser = await puppeteer.connect({
            browserWSEndpoint: wsUrl,
            defaultViewport: null
          })
          return browser
        }
      }
    } catch {
      // Chrome 还没准备好，继续等
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

/**
 * 自动查找 Chrome 可执行文件路径
 */
function findChromePath() {
  const platform = process.platform

  const paths = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser'
    ]
  }

  const candidates = paths[platform] || []
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      continue
    }
  }

  throw new Error(
    '未找到 Chrome，请在 config.yaml 中手动配置 browser.chrome_path\n' +
    `当前系统: ${platform}`
  )
}

/**
 * 关闭标签页（不关闭浏览器）
 * 操作完成后只关闭我们打开的标签页，用户的其他标签页不受影响
 */
export async function closePage(page) {
  const log = getLogger()
  try {
    if (page && !page.isClosed()) {
      await page.close()
      log.info('标签页已关闭')
    }
  } catch (err) {
    log.warn(`关闭标签页时出错: ${err.message}`)
  }
}

/**
 * 断开与浏览器的连接（不关闭浏览器）
 * 程序退出时调用，Chrome 继续运行
 */
export async function disconnectBrowser(browser) {
  const log = getLogger()
  try {
    if (browser) {
      // 强制关闭底层 WebSocket，确保 Chrome 立即释放连接 slot
      try {
        const ws = browser._connection?._transport?._ws
        if (ws && ws.readyState <= 1) { // CONNECTING or OPEN
          ws.close()
        }
      } catch { /* ignore internal access errors */ }
      browser.disconnect()
      log.info('已断开与 Chrome 的连接（浏览器保持运行）')
    }
  } catch (err) {
    log.warn(`断开连接时出错: ${err.message}`)
  }
}

/**
 * 强制关闭浏览器（一般不用，仅测试时使用）
 */
export async function closeBrowser(browser) {
  const log = getLogger()
  try {
    if (browser) {
      await browser.close()
      log.info('Chrome 已关闭')
    }
  } catch (err) {
    log.warn(`关闭浏览器时出错: ${err.message}`)
  }
}
