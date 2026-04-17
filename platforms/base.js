import fs from 'fs'
import path from 'path'
import { getLogger } from '../core/logger.js'
import { cfg } from '../core/config.js'
import { verifyPageContent } from '../core/vision-verify.js'
import { createMidsceneAgent, safeMidsceneCall } from '../core/midscene-agent.js'
import {
  verifyPageReady,
  verifyContentFilled,
  locateElement,
  detectPopup,
  judgePublishResult,
  smartDelay
} from '../core/vision-locate.js'
import { simulateIMEText, containsChinese } from '../core/ime-simulator.js'
import { injectOverlay, updateOverlay, removeOverlay } from '../core/status-overlay.js'
import {
  createHumanCursor,
  humanClick,
  humanType,
  humanPaste,
  humanScroll,
  humanUploadFile,
  simulateBrowsing,
  randomDelay,
  calculateRemainingWait,
  gaussianRandom
} from '../core/human.js'

// ============================================================
// 结构化错误码（Adapter Error Codes）
// ============================================================

export const ERROR_CODES = {
  LOGIN_EXPIRED:    'LOGIN_EXPIRED',     // 未登录或登录已过期
  SELECTOR_MISS:    'SELECTOR_MISS',     // 关键选择器未命中
  UPLOAD_FAILED:    'UPLOAD_FAILED',     // 文件上传失败
  PUBLISH_BLOCKED:  'PUBLISH_BLOCKED',   // 发布被平台拦截（风控/审核）
  EDITOR_NOT_READY: 'EDITOR_NOT_READY',  // 编辑器未就绪
  NAVIGATION_FAILED:'NAVIGATION_FAILED', // 页面导航失败/超时
  UNKNOWN:          'UNKNOWN',           // 未分类错误
}

export class AdapterError extends Error {
  /**
   * @param {string} message - 错误描述
   * @param {string} code - ERROR_CODES 中的错误码
   * @param {string} [step] - 出错的步骤名称
   */
  constructor(message, code = ERROR_CODES.UNKNOWN, step = null) {
    super(message)
    this.name = 'AdapterError'
    this.code = code
    this.step = step
  }
}

/**
 * 平台适配器基类
 * 所有平台适配器继承此类，实现 publish() 方法
 *
 * 配置节对应关系:
 *   导航行为      → config.browser.navigation_timeout, config.timing.post_navigation_delay_*
 *   操作间隔      → config.timing.action_delay_*
 *   总发帖时长    → config.timing.total_duration_*
 *   标签页关闭    → config.tab.*
 *   截图策略      → config.screenshot.*
 *   步骤浏览时间  → config.steps.*
 */
// 步骤名称 → 中文浮窗文字（runStep 自动映射）
const STEP_LABEL_MAP = {
  warmupBrowse:     '正在预热浏览...',
  openPage:         '正在打开页面...',
  openPublishPage:  '正在打开发布页面...',
  selectSubreddit:  '正在选择社区...',
  inputTitle:       '正在输入标题...',
  inputContent:     '正在输入正文...',
  uploadImages:     '正在上传图片...',
  uploadCover:      '正在上传封面图...',
  addTags:          '正在添加标签...',
  selectQuestion:   '正在选择投稿问题...',
  declareOriginal:  '正在声明原创...',
  setScheduleTime:  '正在设置定时发布...',
  publish:          '正在发布...',
  submit:           '正在提交发布...',
  verifyPublish:    '正在验证发布结果...',
}

export class BasePlatformAdapter {
  constructor(page) {
    this.page = page
    this.cursor = null
    this.log = getLogger()
    this.startTime = null
    this._stepLog = []
    this._assertionFailures = 0
    this._midsceneAgent = null  // Midscene AI 视觉 agent
  }

  /**
   * 初始化 cursor（需要在 page 准备好后调用）
   */
  async init() {
    this.cursor = await createHumanCursor(this.page)
    this.startTime = Date.now()
    this._stepLog = []
    this._assertionFailures = 0

    // 注入状态浮窗（顶部居中显示当前操作步骤）
    await injectOverlay(this.page).catch(() => {})

    // 初始化 Midscene AI 视觉 agent（如果已启用）
    try {
      this._midsceneAgent = await createMidsceneAgent(this.page)
    } catch (err) {
      this.log.warn(`[Midscene] 初始化跳过: ${err.message}`)
      this._midsceneAgent = null
    }
  }

  // ============================================================
  // Step 追踪（Pipeline Step Monitoring）
  // ============================================================

  /**
   * 包装一个步骤，自动记录 stepName / status / duration / evidence
   * @param {string} name - 步骤名称
   * @param {Function} fn - 步骤执行函数
   */
  async runStep(name, fn) {
    const entry = {
      stepName: name,
      status: 'running',
      startedAt: new Date().toISOString(),
      evidence: [],
      error: null,
      durationMs: 0
    }
    this._stepLog.push(entry)
    // 更新状态浮窗（英文 stepName → 中文提示）
    const label = STEP_LABEL_MAP[name] || name
    await this.showStatus(label).catch(() => {})
    try {
      await fn()
      entry.status = 'passed'
    } catch (err) {
      entry.status = 'failed'
      entry.error = err.message
      throw err
    } finally {
      entry.finishedAt = new Date().toISOString()
      entry.durationMs = Date.now() - new Date(entry.startedAt).getTime()
    }
  }

  /**
   * 向当前步骤追加证据
   * @param {string} key - 证据键（如 'assert:标题', 'publishResult'）
   * @param {*} value - 证据值
   */
  addStepEvidence(key, value) {
    // 2026-04-15 安全加固：兼容未接入 runStep() 的老平台。
    // 修改原因：部分历史平台没有步骤包装，导致发布校验虽然执行了，但 step_report 中没有证据可追踪。
    // 修改策略：首次写证据时自动创建一个 runtimeEvidence 虚拟步骤，仅承载证据，不改变原有发布流程控制。
    // 回退方式：删除下方 synthetic step 创建逻辑，即可恢复“无 runStep 时不记录证据”的旧行为。
    if (!this._stepLog || this._stepLog.length === 0) {
      this._stepLog = [{
        stepName: 'runtimeEvidence',
        status: 'passed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        evidence: [],
        error: null,
        durationMs: 0,
      }]
    }
    const current = this._stepLog[this._stepLog.length - 1]
    if (current) {
      current.evidence.push({ key, value, at: new Date().toISOString() })
    }
  }

  /**
   * 获取完整步骤报告
   * @returns {Array} 步骤执行记录
   */
  getStepReport() {
    return this._stepLog || []
  }

  // ============================================================
  // 统一返回结构（Unified Result Builder）
  // ============================================================

  /**
   * 构建统一的 publish 返回结构
   * 子类在 publish() 末尾调用此方法，确保返回格式一致
   *
   * @param {boolean} success - 是否成功
   * @param {string|Error} messageOrError - 描述信息或 Error 对象
   * @param {object} [extra] - 额外字段（如 errorCode, publishedUrl）
   * @returns {{success, message, publishedUrl, step_report, errorCode}}
   */
  buildResult(success, messageOrError, extra = {}) {
    const isErr = messageOrError instanceof Error
    const message = isErr ? messageOrError.message : messageOrError
    const errCode = extra.errorCode
      || (isErr && messageOrError.code) || null
    const errStep = (isErr && messageOrError.step) || null

    let publishedUrl = extra.publishedUrl || null
    if (success && !publishedUrl) {
      try {
        const url = this.page.url()
        // 排除发布页本身的 URL（说明未跳转）
        if (url && !url.includes('/write') && !url.includes('/publish') && !url.includes('/upload') && !url.includes('/edit')) {
          publishedUrl = url
        }
      } catch { /* page may be closed */ }
    }

    return {
      success,
      message,
      publishedUrl,
      errorCode: errCode,
      errorStep: errStep,
      step_report: this.getStepReport(),
    }
  }

  /**
   * 重新初始化 cursor（page 被重新赋值后必须调用）
   * 场景：微信/搜狐 step1 切换到新标签页后 this.page 变了
   */
  async reinitCursor() {
    try {
      this.cursor = await createHumanCursor(this.page)
      this.log.debug('cursor 已重新初始化')
    } catch (e) {
      this.log.warn(`cursor 重新初始化失败: ${e.message}，后续点击将使用 fallback`)
      this.cursor = null
    }
  }

  /**
   * 子类必须实现：执行发帖操作
   * @param {object} post - 帖子数据 { title, content, images, tags }
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async publish(post) {
    throw new Error('子类必须实现 publish() 方法')
  }

  // ============================================================
  // 平台元数据（子类可重写）
  // ============================================================

  /** 平台首页 URL（养号浏览用） */
  getHomeUrl() { return null }

  /** 平台登录 URL */
  getLoginUrl() { return null }

  /** 平台互动选择器（数组式 fallback 格式） */
  getInteractSelectors() { return null }

  /** 浏览时帖子元素选择器（用于点击帖子→阅读→返回） */
  getBrowsePostSelector() { return null }

  /** 平台名称 */
  getPlatformName() { return this.platformName || 'unknown' }

  // ============================================================
  // 导航
  // ============================================================

  /**
   * 导航到指定 URL 并等待加载完成
   *
   * 配置项:
   *   browser.navigation_timeout          — 页面加载超时
   *   timing.post_navigation_delay_min/max — 加载后等待
   */
  async navigateTo(url, { waitUntil, pageDescription, expectedElements } = {}) {
    this.log.info(`导航到: ${url}`)
    const navTimeout = cfg('browser.navigation_timeout', 60000)
    const strategy = waitUntil || cfg('browser.wait_until', 'networkidle2')
    await this.page.goto(url, { waitUntil: strategy, timeout: navTimeout })

    const delayMin = cfg('timing.post_navigation_delay_min', 2000)
    const delayMax = cfg('timing.post_navigation_delay_max', 4000)
    const targetDelay = Math.floor(gaussianRandom(delayMin, delayMax))
    const stepStart = Date.now()

    // 视觉验证页面就绪（耗时计入延迟）
    if (pageDescription) {
      const vr = await verifyPageReady(this.page, pageDescription, expectedElements || [])
      this.addStepEvidence('vision_page_ready', { url, ...vr })
      if (!vr.ready) {
        this.log.warn(`[视觉验证] 页面可能未完整加载，等待额外 2s 后继续`)
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    // 智能计时：视觉检测耗时已计入，只等剩余时间
    await smartDelay(stepStart, targetDelay)
    this.log.info('页面加载完成')

    // 页面导航后重新注入状态浮窗（导航会丢失之前的 DOM）
    await injectOverlay(this.page).catch(() => {})
  }

  // ============================================================
  // 浏览模拟
  // ============================================================

  /**
   * 等待并模拟浏览（填充时间，让操作看起来像真人）
   * @param {number} minSeconds - 最短浏览时间（秒）
   * @param {number} maxSeconds - 最长浏览时间（秒）
   */
  async browseAround(minSeconds, maxSeconds) {
    const durationMs = Math.floor(
      gaussianRandom(minSeconds * 1000, maxSeconds * 1000)
    )
    await simulateBrowsing(this.page, this.cursor, durationMs)
  }

  /**
   * 按步骤名称读取配置的浏览时间并模拟浏览
   *
   * 配置项: steps.<stepName>.browse_min/max
   *
   * @param {string} stepName - 步骤名称（对应 config.steps 下的 key）
   */
  async browseForStep(stepName) {
    const browseMin = cfg(`steps.${stepName}.browse_min`, 60)
    const browseMax = cfg(`steps.${stepName}.browse_max`, 180)
    await this.browseAround(browseMin, browseMax)
  }

  // ============================================================
  // 操作间隔
  // ============================================================

  /**
   * 操作间的随机等待
   *
   * 配置项: timing.action_delay_min/max
   */
  async actionPause() {
    const delayMin = cfg('timing.action_delay_min', 3000)
    const delayMax = cfg('timing.action_delay_max', 15000)
    await randomDelay(delayMin, delayMax)
  }

  // ============================================================
  // 总时长补足
  // ============================================================

  /**
   * 在发帖流程最后，补足剩余时间以达到目标总时长
   *
   * 配置项: timing.total_duration_min/max
   */
  async fillRemainingTime() {
    if (!this.startTime) return

    const remaining = calculateRemainingWait(this.startTime)
    if (remaining > 5000) {
      this.log.info(`补足剩余时间: ${(remaining / 1000 / 60).toFixed(1)} 分钟`)
      await simulateBrowsing(this.page, this.cursor, remaining)
    }
  }

  // ============================================================
  // 发布后行为
  // ============================================================

  /**
   * 发帖前预热浏览：先导航到平台首页，模拟浏览 feed 一段时间
   * 让平台看到自然的「浏览→发帖」行为链，而非直接访问发帖页
   *
   * 配置项:
   *   timing.warmup_browse_enabled — 是否启用
   *   timing.warmup_browse_min/max — 预热浏览时间（秒）
   */
  async warmupBrowse() {
    const enabled = cfg('timing.warmup_browse_enabled', true)
    if (!enabled) {
      this.log.debug('预热浏览已禁用，跳过')
      return
    }

    const homeUrl = this.getHomeUrl?.()
    if (!homeUrl) {
      this.log.debug('平台未配置首页 URL，跳过预热浏览')
      return
    }

    const browseMin = cfg('timing.warmup_browse_min', 300)
    const browseMax = cfg('timing.warmup_browse_max', 900)
    const durationMs = Math.floor(gaussianRandom(browseMin * 1000, browseMax * 1000))

    this.log.info(`[预热浏览] 导航到首页: ${homeUrl}，浏览 ${Math.floor(durationMs / 1000)}s`)
    await this.navigateTo(homeUrl)
    const postSelector = this.getBrowsePostSelector()
    await simulateBrowsing(this.page, this.cursor, durationMs, { postSelector })
    this.log.info('[预热浏览] 完成')
  }

  /**
   * 发布成功后，在页面上继续浏览一段时间再结束
   *
   * 配置项: tab.post_publish_browse_min/max
   */
  async postPublishBrowse() {
    const browseMin = cfg('tab.post_publish_browse_min', 30)
    const browseMax = cfg('tab.post_publish_browse_max', 120)
    if (browseMax > 0) {
      this.log.info('发布后继续浏览...')
      await this.browseAround(browseMin, browseMax)
    }
  }

  /**
   * 2026-04-15 安全加固：弱校验平台统一改走“保守发布结果校验”。
   *
   * 修改原因：
   * - 多个平台在点击发布后仅做固定等待，容易把“显式失败”误判为成功。
   * - 这会导致后续继续执行 fillRemainingTime / postPublishBrowse，形成伪成功链路。
   *
   * 修改策略：
   * - 这里只拦截“页面已明确给出失败信号”的情况（文本失败提示）。
   * - 如果结果是 unknown，则维持旧行为，不直接判失败，避免因页面改版或 toast 缺失误伤正常发布。
   * - 可选接入视觉校验，但默认只记证据，不作为失败判定依据，继续保持低风险。
   *
   * 回退方式：
   * - 如果后续发现某个平台误报，只需在该平台的 step*_publish() 中删除本 helper 调用，
   *   即可恢复到“点击发布后仅等待”的旧逻辑。
   * - 本 helper 不修改 buildResult 结构，也不改变其他平台默认行为，回退面仅限接入点。
   */
  async conservativeVerifyPublishResult(options = {}) {
    const {
      guardName = this.getPlatformName(),
      waitOptions = {},
      useVisionWhenUnknown = false,
      platformName = this.getPlatformName(),
    } = options

    const waitResult = await this.waitForPublishResult(waitOptions)
    const summary = {
      guardName,
      waitResult,
      visionResult: null,
      strategy: useVisionWhenUnknown ? 'text_then_optional_vision' : 'text_only',
    }

    if (waitResult.status === 'error') {
      this.addStepEvidence('publishGuard', summary)
      throw new AdapterError(
        `${guardName} 发布被页面显式拦截：${waitResult.evidence}`,
        ERROR_CODES.PUBLISH_BLOCKED,
        'publish'
      )
    }

    if (waitResult.status === 'unknown' && useVisionWhenUnknown) {
      try {
        summary.visionResult = await this.visionCheckPublishResult({ platformName })
      } catch (err) {
        summary.visionResult = { status: 'unknown', details: `vision_error:${err.message}`, popupHandled: false }
        this.log.warn(`[发布校验] ${guardName} 视觉辅助校验失败，继续沿用保守策略: ${err.message}`)
      }
    }

    this.addStepEvidence('publishGuard', summary)
    return summary
  }

  /**
   * 关闭标签页前的延迟等待
   *
   * 配置项: tab.close_delay_min/max
   */
  async preCloseDelay() {
    const delayMin = cfg('tab.close_delay_min', 3000)
    const delayMax = cfg('tab.close_delay_max', 15000)
    this.log.debug('关闭标签页前等待...')
    await randomDelay(delayMin, delayMax)
  }

  // ============================================================
  // 截图
  // ============================================================

  /**
   * 截图保存
   *
   * 配置项:
   *   screenshot.full_page — 是否截全页
   *   screenshot.save_dir  — 截图保存目录
   */
  async takeScreenshot(name) {
    const fullPage = cfg('screenshot.full_page', false)
    const saveDir  = cfg('screenshot.save_dir', './logs/screenshots')

    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = path.join(saveDir, `${name}_${timestamp}.png`)
    await this.page.screenshot({ path: filePath, fullPage })
    this.log.info(`截图已保存: ${filePath}`)
    return filePath
  }

  /**
   * 根据截图策略决定是否截图
   *
   * 配置项: screenshot.on_each_step / on_error / on_before_publish / on_after_publish
   *
   * @param {string} name - 截图名称
   * @param {string} trigger - 触发类型: 'step' | 'error' | 'before_publish' | 'after_publish'
   */
  async conditionalScreenshot(name, trigger) {
    const triggerMap = {
      step: 'screenshot.on_each_step',
      error: 'screenshot.on_error',
      before_publish: 'screenshot.on_before_publish',
      after_publish: 'screenshot.on_after_publish',
    }
    const configKey = triggerMap[trigger]
    if (configKey && cfg(configKey, trigger === 'error')) {
      return this.takeScreenshot(name)
    }
    return null
  }

  // ============================================================
  // 状态浮窗（页面顶部居中，显示当前操作步骤）
  // ============================================================

  /**
   * 更新状态浮窗文字
   * @param {string} text - 如 "正在输入标题..."
   */
  async showStatus(text) {
    return updateOverlay(this.page, text)
  }

  /**
   * 移除状态浮窗
   */
  async hideStatus() {
    return removeOverlay(this.page)
  }

  // ============================================================
  // 快捷封装，子类直接调用
  // ============================================================

  async click(selector) {
    return humanClick(this.cursor, selector, this.page)
  }

  async type(selector, text) {
    return humanType(this.page, selector, text, this.cursor)
  }

  /**
   * CDP insertText 输入（用于 contenteditable 富文本编辑器）
   * keyboard.type 对中文或 React/Vue 编辑器不可靠时使用此方法
   */
  async paste(selector, text) {
    return humanPaste(this.page, selector, text, this.cursor)
  }

  async scroll() {
    return humanScroll(this.page)
  }

  async uploadFile(selectorOrHandle, filePaths) {
    // 兼容两种调用模式：
    //   uploadFile('input[type=file]', [path])   — string selector（大多数平台）
    //   uploadFile(elementHandle, path)           — ElementHandle（抖音/视频号/头条）
    if (typeof selectorOrHandle === 'string') {
      return humanUploadFile(this.page, selectorOrHandle, filePaths)
    }

    // ElementHandle 模式：直接在已找到的元素上调用 uploadFile
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
    await selectorOrHandle.uploadFile(...paths)
    const waitMin = cfg('upload.wait_after_select_min', 2000)
    const waitMax = cfg('upload.wait_after_select_max', 5000)
    await randomDelay(waitMin, waitMax)
    this.log.info(`文件上传完成（ElementHandle 模式，${paths.length} 个文件）`)
  }

  /**
   * 从多个候选选择器中找到第一个存在于页面中的
   * @param {string[]} candidates - 候选 CSS 选择器列表（按优先级排列）
   * @returns {Promise<string>} 匹配到的选择器
   * @throws {Error} 全部未命中时抛出
   */
  async findSelector(candidates) {
    for (const selector of candidates) {
      try {
        const el = await this.page.$(selector)
        if (el) {
          this.log.debug(`使用选择器: ${selector}`)
          return selector
        }
      } catch {
        continue
      }
    }
    this.addStepEvidence('selector_miss', { candidates, url: this.page.url() })
    throw new AdapterError(
      `未找到匹配的元素，候选选择器: ${candidates.join(', ')}`,
      ERROR_CODES.SELECTOR_MISS
    )
  }

  /**
   * 从多个候选选择器中找到第一个存在于页面中的，返回 ElementHandle
   * （findSelector 的 ElementHandle 版本，供 weibo/bilibili 等 publisher 使用）
   * @param {string[]} candidates - 候选 CSS 选择器列表
   * @returns {Promise<ElementHandle|null>} 命中的元素，全部未命中返回 null
   */
  async findElement(candidates) {
    for (const selector of candidates) {
      try {
        const el = await this.page.$(selector)
        if (el) {
          this.log.debug(`findElement 命中: ${selector}`)
          return el
        }
      } catch {
        continue
      }
    }
    this.log.warn(`findElement 未命中，候选: ${candidates.join(', ')}`)
    this.addStepEvidence('selector_miss', { candidates, url: this.page.url() })
    return null
  }

  /**
   * 通过文本内容查找按钮或元素（替代 Puppeteer 不支持的 :has-text()）
   * @param {string} tag - HTML 标签名（如 'button', 'a', 'span'）
   * @param {string} text - 要匹配的文本内容
   * @returns {Promise<ElementHandle|null>}
   */
  async findByText(tag, text) {
    const elements = await this.page.$$(tag)
    for (const el of elements) {
      const content = await el.evaluate(node => node.textContent.trim())
      if (content.includes(text)) return el
    }
    return null
  }

  // ============================================================
  // AI 视觉验证
  // ============================================================

  /**
   * 发布前 AI 视觉验证：截图当前页面，调用视觉模型确认内容已正确填写
   *
   * 配置项: vision.enabled / vision.api_key / vision.base_url / vision.model
   *
   * @param {object} expected - 期望内容 { title?, content?, tags?, imageCount? }
   * @returns {Promise<{pass: boolean, confidence: number, details: string, issues: string[]}>}
   */
  async verifyBeforePublish(expected) {
    return verifyPageContent(this.page, expected)
  }

  // ============================================================
  // AI 视觉验证核心方法（零 DOM 侵入，纯截图）
  //
  // 所有方法在 vision.enabled = false 时直接返回默认值，不阻塞流程。
  // 视觉检测耗时计入操作延迟（智能计时），不额外增加总时长。
  // ============================================================

  /**
   * 视觉验证页面就绪 + 智能计时
   *
   * 截图让 AI 判断页面是否完整加载。
   * 视觉检测耗时自动计入 targetDelayMs，剩余时间再等待。
   *
   * @param {string} pageDescription - 页面描述（如 "Reddit 发帖页面"）
   * @param {object} [options]
   * @param {string[]} [options.expectedElements] - 期望看到的元素描述
   * @param {number} [options.targetDelayMs] - 目标总延迟（含视觉检测时间）
   * @returns {Promise<{ready: boolean, details: string}>}
   */
  async visionCheckPageReady(pageDescription, options = {}) {
    const targetDelay = options.targetDelayMs || Math.floor(
      gaussianRandom(
        cfg('timing.action_delay_min', 3000),
        cfg('timing.action_delay_max', 15000)
      )
    )
    const stepStart = Date.now()

    const result = await verifyPageReady(
      this.page, pageDescription, options.expectedElements || []
    )
    this.addStepEvidence('vision_page_ready', { pageDescription, ...result })

    if (!result.ready) {
      this.log.warn(`[视觉验证] 页面未就绪，额外等待 2s`)
      await new Promise(r => setTimeout(r, 2000))
    }

    await smartDelay(stepStart, targetDelay)
    return result
  }

  /**
   * 视觉验证内容填写 + 智能计时
   *
   * 截图让 AI 确认表单内容是否正确填写。
   * 用于填写完标题、正文、上传图片后的检查。
   *
   * @param {object} expected - 期望内容 { title?, content?, tags?, imageCount? }
   * @param {object} [options]
   * @param {number} [options.targetDelayMs] - 目标总延迟
   * @returns {Promise<{pass: boolean, confidence: number, details: string, issues: string[]}>}
   */
  async visionCheckContent(expected, options = {}) {
    const targetDelay = options.targetDelayMs || Math.floor(
      gaussianRandom(
        cfg('timing.action_delay_min', 3000),
        cfg('timing.action_delay_max', 15000)
      )
    )
    const stepStart = Date.now()

    const result = await verifyContentFilled(this.page, expected)
    this.addStepEvidence('vision_content_check', { expected: Object.keys(expected), ...result })

    await smartDelay(stepStart, targetDelay)
    return result
  }

  /**
   * 视觉定位 + ghost-cursor 鼠标点击
   *
   * 当选择器找不到元素时，截图让 AI 找到目标坐标，
   * 然后用 ghost-cursor 模拟真人鼠标移动过去点击。
   *
   * @param {string} elementDescription - 目标描述（如 "蓝色的发布按钮"）
   * @returns {Promise<{clicked: boolean, method: string, details: string}>}
   */
  async visionLocateAndClick(elementDescription) {
    const result = await locateElement(this.page, elementDescription)
    this.addStepEvidence('vision_locate', { target: elementDescription, ...result })

    if (!result.found) {
      return { clicked: false, method: 'vision', details: result.description }
    }

    // 用 ghost-cursor 模拟真人鼠标移动 + 点击
    try {
      if (this.cursor) {
        // ghost-cursor：贝塞尔曲线移动到目标坐标，然后点击
        await this.cursor.moveTo({ x: result.x, y: result.y })
        const clickWait = Math.floor(gaussianRandom(
          cfg('mouse.click_wait_min', 50),
          cfg('mouse.click_wait_max', 200)
        ))
        await new Promise(r => setTimeout(r, clickWait))
        await this.page.mouse.click(result.x, result.y)
      } else {
        await this.page.mouse.click(result.x, result.y)
      }
      this.log.info(`[视觉点击] 已点击 "${elementDescription}" @ (${result.x}, ${result.y})`)
      return { clicked: true, method: 'vision_cursor', details: result.description }
    } catch (err) {
      this.log.warn(`[视觉点击] 点击失败: ${err.message}`)
      return { clicked: false, method: 'vision', details: `点击异常: ${err.message}` }
    }
  }

  /**
   * 视觉检测弹窗 + 自动处理
   *
   * 截图检测是否有弹窗遮挡，如果有则用鼠标点击关闭/确认。
   * 适用于不可预测的 cookie 提示、通知弹窗、发布确认框等。
   *
   * @param {string} [action='close'] - 处理方式: 'close' | 'confirm'
   * @returns {Promise<{hasPopup: boolean, handled: boolean, popupType: string}>}
   */
  async visionHandlePopup(action = 'close') {
    const result = await detectPopup(this.page, action)
    this.addStepEvidence('vision_popup', result)

    if (!result.hasPopup) {
      return { hasPopup: false, handled: false, popupType: '' }
    }

    if (result.buttonX <= 0 || result.buttonY <= 0) {
      this.log.warn(`[视觉弹窗] 检测到弹窗但未定位到按钮: ${result.popupType}`)
      return { hasPopup: true, handled: false, popupType: result.popupType }
    }

    // ghost-cursor 鼠标点击弹窗按钮
    try {
      if (this.cursor) {
        await this.cursor.moveTo({ x: result.buttonX, y: result.buttonY })
        const clickWait = Math.floor(gaussianRandom(50, 200))
        await new Promise(r => setTimeout(r, clickWait))
        await this.page.mouse.click(result.buttonX, result.buttonY)
      } else {
        await this.page.mouse.click(result.buttonX, result.buttonY)
      }
      this.log.info(`[视觉弹窗] 已处理弹窗: ${result.popupType} → (${result.buttonX}, ${result.buttonY})`)
      await randomDelay(500, 1500)
      return { hasPopup: true, handled: true, popupType: result.popupType }
    } catch (err) {
      this.log.warn(`[视觉弹窗] 处理失败: ${err.message}`)
      return { hasPopup: true, handled: false, popupType: result.popupType }
    }
  }

  /**
   * 视觉判断发布结果 + 自动处理弹窗
   *
   * 点击发布按钮后，截图判断当前状态：
   *   - 成功 → 直接返回
   *   - 需要确认 → 自动点击确认按钮
   *   - 需要关闭 → 自动点击关闭按钮
   *   - 失败/仍在编辑 → 返回状态供上层处理
   *
   * @param {object} [options]
   * @param {string} [options.platformName] - 平台名称
   * @returns {Promise<{status: string, details: string, popupHandled: boolean}>}
   */
  async visionCheckPublishResult(options = {}) {
    const platformName = options.platformName || this.getPlatformName()
    const result = await judgePublishResult(this.page, platformName)
    this.addStepEvidence('vision_publish_result', result)

    // 自动处理弹窗
    if (result.hasPopup && result.buttonX > 0 && result.buttonY > 0) {
      try {
        if (this.cursor) {
          await this.cursor.moveTo({ x: result.buttonX, y: result.buttonY })
          await new Promise(r => setTimeout(r, Math.floor(gaussianRandom(50, 200))))
          await this.page.mouse.click(result.buttonX, result.buttonY)
        } else {
          await this.page.mouse.click(result.buttonX, result.buttonY)
        }
        this.log.info(`[视觉发布] 已点击弹窗按钮: "${result.popupAction}" → (${result.buttonX}, ${result.buttonY})`)
        await randomDelay(1000, 3000)
        return { status: result.status, details: result.details, popupHandled: true }
      } catch (err) {
        this.log.warn(`[视觉发布] 弹窗点击失败: ${err.message}`)
      }
    }

    return { status: result.status, details: result.details, popupHandled: false }
  }

  // ============================================================
  // Midscene AI 视觉状态机
  // ============================================================

  /**
   * AI 视觉验证：用自然语言断言当前页面状态
   * 失败不阻塞流程，仅记录证据
   *
   * @param {string} assertion - 自然语言断言（如 '标题输入框中包含文字"xxx"'）
   * @param {object} [options]
   * @param {boolean} [options.throwOnFail=false] - 验证失败时是否抛异常
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async aiVerify(assertion, options = {}) {
    if (!this._midsceneAgent) {
      return { success: true, error: 'agent_not_available' }
    }
    const verifyEnabled = cfg('midscene.verify_after_step', true)
    if (!verifyEnabled) {
      return { success: true, error: 'verify_disabled' }
    }

    const result = await safeMidsceneCall(this._midsceneAgent, 'aiAssert', assertion)
    this.addStepEvidence(`ai_verify`, { assertion, ...result })

    if (!result.success && options.throwOnFail) {
      throw new AdapterError(
        `AI 验证失败: ${assertion} — ${result.error}`,
        ERROR_CODES.UNKNOWN
      )
    }
    return result
  }

  /**
   * AI 操作：用自然语言指示 AI 在页面上执行操作
   * 适用于选择器不可靠的场景（下拉框、弹窗、Tab 切换等）
   *
   * @param {string} instruction - 自然语言指令（如 '点击发布按钮'）
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async aiOperate(instruction) {
    if (!this._midsceneAgent) {
      return { success: false, error: 'agent_not_available' }
    }
    const result = await safeMidsceneCall(this._midsceneAgent, 'aiAct', instruction)
    this.addStepEvidence(`ai_operate`, { instruction, ...result })
    return result
  }

  /**
   * AI 数据提取：用自然语言从页面提取结构化数据
   *
   * @param {string} query - 数据描述（如 '{likes: number, comments: number}'）
   * @returns {Promise<{success: boolean, result?: any, error?: string}>}
   */
  async aiExtract(query) {
    if (!this._midsceneAgent) {
      return { success: false, error: 'agent_not_available' }
    }
    const result = await safeMidsceneCall(this._midsceneAgent, 'aiQuery', query)
    this.addStepEvidence(`ai_extract`, { query, ...result })
    return result
  }

  /**
   * 智能点击：先尝试选择器，失败时降级到 AI 视觉操作
   *
   * @param {string[]} selectors - 候选 CSS 选择器
   * @param {string} aiDescription - AI 降级时的自然语言描述（如 '点击发布按钮'）
   * @returns {Promise<boolean>} 是否成功点击
   */
  async smartClick(selectors, aiDescription) {
    // 1. 先尝试传统选择器（快速路径，0 成本）
    const el = await this.findElement(selectors)
    if (el) {
      await this.clickElement(el)
      return true
    }

    // 2. 选择器未命中 → 尝试自建视觉定位（零 DOM 侵入）
    if (aiDescription) {
      const visionResult = await this.visionLocateAndClick(aiDescription)
      if (visionResult.clicked) return true
    }

    // 3. 视觉定位也失败 → 最后尝试 Midscene（如果可用）
    const fallbackEnabled = cfg('midscene.fallback_on_selector_miss', true)
    if (fallbackEnabled && this._midsceneAgent) {
      this.log.warn(`[smartClick] 视觉定位未命中，Midscene 降级: ${aiDescription}`)
      const result = await this.aiOperate(aiDescription)
      return result.success
    }

    this.log.warn(`[smartClick] 所有方式均未命中: ${selectors.join(', ')}`)
    return false
  }

  /**
   * 智能查找并点击：findElement + clickElement + AI 降级
   * 未找到时抛出 AdapterError（与 findSelector 行为一致）
   *
   * @param {string[]} selectors - 候选 CSS 选择器
   * @param {string} aiDescription - AI 降级描述
   * @throws {AdapterError} 选择器和 AI 均失败时
   */
  async smartFindAndClick(selectors, aiDescription) {
    const success = await this.smartClick(selectors, aiDescription)
    if (!success) {
      throw new AdapterError(
        `未找到元素且 AI 操作失败: ${aiDescription}`,
        ERROR_CODES.SELECTOR_MISS
      )
    }
  }

  /**
   * AI 弹窗检测与处理：检测意外弹窗并尝试关闭
   * 在关键步骤之间调用，防止弹窗阻塞后续操作
   *
   * @returns {Promise<{hasPopup: boolean, dismissed: boolean}>}
   */
  async checkForPopup() {
    if (!this._midsceneAgent || !cfg('midscene.auto_dismiss_popup', true)) {
      return { hasPopup: false, dismissed: false }
    }

    try {
      const queryResult = await safeMidsceneCall(
        this._midsceneAgent,
        'aiQuery',
        '{hasPopup: boolean, popupDescription: string}, 检查页面是否有弹窗、对话框、提示框覆盖在主内容上方。如果没有弹窗返回 hasPopup: false'
      )

      if (!queryResult.success || !queryResult.result?.hasPopup) {
        return { hasPopup: false, dismissed: false }
      }

      this.log.warn(`[Midscene] 检测到弹窗: ${queryResult.result.popupDescription}`)
      const dismissResult = await safeMidsceneCall(
        this._midsceneAgent,
        'aiAct',
        '关闭当前弹窗、对话框或提示框（点击关闭按钮、取消按钮或点击遮罩层）'
      )

      this.addStepEvidence('popup_dismissed', {
        popup: queryResult.result.popupDescription,
        dismissed: dismissResult.success
      })

      return { hasPopup: true, dismissed: dismissResult.success }
    } catch (err) {
      this.log.debug(`[Midscene] 弹窗检测异常: ${err.message}`)
      return { hasPopup: false, dismissed: false }
    }
  }

  // ============================================================
  // 元素操作
  // ============================================================

  /**
   * 通过 ghost-cursor 点击 ElementHandle（保留鼠标移动轨迹）
   * cursor 不存在时 fallback 到原生 el.click()
   * @param {ElementHandle} el - 目标元素
   */
  async clickElement(el) {
    if (this.cursor) {
      const clickOffset  = cfg('mouse.click_offset_percent', 10)
      const clickWaitMin = cfg('mouse.click_wait_min', 50)
      const clickWaitMax = cfg('mouse.click_wait_max', 200)
      await this.cursor.click(el, {
        paddingPercentage: clickOffset,
        waitForClick: Math.floor(gaussianRandom(clickWaitMin, clickWaitMax))
      })
    } else {
      await el.click()
    }
  }

  async clickByText(tag, text) {
    const el = await this.findByText(tag, text)
    if (!el) throw new Error(`未找到包含文本 "${text}" 的 <${tag}> 元素`)
    await this.clickElement(el)
    this.log.debug(`点击文本元素: <${tag}>"${text}"`)
  }

  /**
   * 向 ElementHandle 输入文字（配合 findElement 使用）
   *
   * 策略：CDP Input.insertText，兼容普通 input 和 React/Vue 富文本编辑器。
   * 按段落拆分，段间模拟思考停顿，与 humanPaste 保持一致。
   *
   * @param {ElementHandle} element - 目标元素句柄
   * @param {string} text - 要输入的文字
   */
  async humanTypeInElement(element, text) {
    const preMin = cfg('keyboard.pre_type_delay_min', 300)
    const preMax = cfg('keyboard.pre_type_delay_max', 800)

    await this.clickElement(element)
    await randomDelay(preMin, preMax)

    const cdp = await this.page.target().createCDPSession()
    const paragraphs = text.split('\n')

    // 自适应输入策略（与 humanPaste 一致）
    const imeEnabled = cfg('keyboard.ime_enabled', true)
    const imeThresholdShort = cfg('keyboard.ime_threshold_short', 200)
    const imeThresholdLong = cfg('keyboard.ime_threshold_long', 800)
    const imeParagraphLimit = cfg('keyboard.ime_paragraph_limit', 3)
    const totalLen = text.length

    let mode = 'ime'
    if (totalLen > imeThresholdLong) {
      mode = 'fast'
      this.log.info(`长文模式（${totalLen}字），分段快速输入`)
    } else if (totalLen > imeThresholdShort) {
      mode = 'hybrid'
      this.log.info(`混合模式（${totalLen}字），前${imeParagraphLimit}段 IME`)
    }

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i]
      if (para.length > 0) {
        let useIME = false
        if (mode === 'ime') {
          useIME = imeEnabled && containsChinese(para)
        } else if (mode === 'hybrid') {
          useIME = imeEnabled && containsChinese(para) && i < imeParagraphLimit
        }

        if (useIME) {
          try {
            await simulateIMEText(cdp, para)
          } catch (imeErr) {
            this.log.warn(`IME 输入第${i+1}段失败，降级为快速输入`)
            await cdp.send('Input.insertText', { text: para })
          }
        } else {
          const sentences = para.match(/[^。！？.!?\n]+[。！？.!?]?/g) || [para]
          for (let s = 0; s < sentences.length; s++) {
            await cdp.send('Input.insertText', { text: sentences[s] })
            if (s < sentences.length - 1) await randomDelay(150, 500)
          }
        }
      }
      if (i < paragraphs.length - 1) {
        await randomDelay(200, 500)
        await this.page.keyboard.press('Enter')
        const pauseMin = mode === 'fast' ? 300 : 800
        const pauseMax = mode === 'fast' ? 1000 : 2000
        await randomDelay(pauseMin, pauseMax)
      }
    }

    await cdp.detach()
    this.log.debug('humanTypeInElement 输入完成')
  }

  // ============================================================
  // 条件等待（Condition-Based Waits）
  // ============================================================

  /**
   * 等待多个选择器中任一出现
   * @param {string[]} selectors - CSS 选择器数组
   * @param {number} timeout - 最大等待时间（毫秒）
   * @returns {string|null} 命中的选择器，超时返回 null
   */
  async waitForAny(selectors, timeout = 15000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      for (const sel of selectors) {
        try {
          const el = await this.page.$(sel)
          if (el) return sel
        } catch { /* next */ }
      }
      await randomDelay(300, 600)
    }
    return null
  }

  /**
   * 等待编辑器就绪（标题或正文元素可交互）
   * @param {string[]} titleSelectors - 标题选择器
   * @param {string[]} contentSelectors - 正文选择器
   * @param {number} timeout - 最大等待时间
   * @returns {boolean}
   */
  async waitForEditorReady(titleSelectors, contentSelectors, timeout = 20000) {
    const allSels = [...titleSelectors, ...contentSelectors]
    const hit = await this.waitForAny(allSels, timeout)
    if (hit) {
      this.log.info(`[就绪] 编辑器已就绪: ${hit}`)
      return true
    }
    this.log.warn(`[就绪] 编辑器未就绪（${timeout}ms 超时）`)
    return false
  }

  /**
   * 等待 URL 包含指定字符串
   * @param {string} pattern - URL 中应包含的子串
   * @param {number} timeout - 最大等待时间
   * @returns {boolean}
   */
  async waitForUrlContains(pattern, timeout = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (this.page.url().includes(pattern)) return true
      await randomDelay(300, 600)
    }
    return false
  }

  // ============================================================
  // 后置断言（Post-Action Assertions）
  // ============================================================

  /**
   * 断言 input/textarea 的值包含预期文本
   * @param {string|string[]} selectors - CSS 选择器（单个或多个）
   * @param {string} expected - 期望包含的文本
   * @param {string} label - 日志标签（如 "标题"）
   */
  async assertInputValue(selectors, expected, label) {
    const sels = Array.isArray(selectors) ? selectors : [selectors]
    const prefix = expected.trim().substring(0, 30)
    for (const sel of sels) {
      try {
        const actual = await this.page.$eval(sel, el => el.value || el.textContent || '')
        if (actual && actual.trim().includes(prefix)) {
          this.log.info(`[断言] ${label} 回读验证通过 ✓`)
          this.addStepEvidence(`assert:${label}`, 'passed')
          return true
        }
      } catch { /* next selector */ }
    }
    this.log.warn(`[断言] ${label} 回读不一致: 期望含 "${prefix}"`)
    this.addStepEvidence(`assert:${label}`, 'failed')
    this._assertionFailures++
    return false
  }

  /**
   * 断言富文本编辑器（contenteditable）的内容包含预期文本片段
   * @param {string|string[]} selectors - 编辑器 CSS 选择器
   * @param {string} expected - 期望包含的文本
   * @param {string} label - 日志标签
   */
  async assertRichTextContent(selectors, expected, label) {
    const sels = Array.isArray(selectors) ? selectors : [selectors]
    const prefix = expected.trim().substring(0, 40)
    for (const sel of sels) {
      try {
        const actual = await this.page.$eval(sel, el => (el.textContent || '').substring(0, 200))
        if (actual && actual.includes(prefix)) {
          this.log.info(`[断言] ${label} 内容验证通过 ✓`)
          this.addStepEvidence(`assert:${label}`, 'passed')
          return true
        }
      } catch { /* next selector */ }
    }
    this.log.warn(`[断言] ${label} 内容不一致: 期望含 "${prefix}"`)
    this.addStepEvidence(`assert:${label}`, 'failed')
    this._assertionFailures++
    return false
  }

  /**
   * 断言元素存在
   * @param {string|string[]} selectors - CSS 选择器
   * @param {string} label - 日志标签
   * @returns {boolean}
   */
  async assertElementExists(selectors, label) {
    const sels = Array.isArray(selectors) ? selectors : [selectors]
    for (const sel of sels) {
      try {
        const el = await this.page.$(sel)
        if (el) {
          this.log.info(`[断言] ${label} 元素存在 ✓`)
          return true
        }
      } catch { /* next */ }
    }
    this.log.warn(`[断言] ${label} 元素未找到`)
    return false
  }

  /**
   * 等待元素消失（如上传 loading、处理中状态）
   * @param {string} selector - CSS 选择器
   * @param {number} timeout - 最大等待时间（毫秒）
   * @param {string} label - 日志标签
   * @returns {boolean}
   */
  async waitForElementGone(selector, timeout = 10000, label = '') {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const el = await this.page.$(selector)
        if (!el) {
          if (label) this.log.info(`[断言] ${label} 已消失 ✓`)
          return true
        }
      } catch { return true }
      await randomDelay(500, 1000)
    }
    if (label) this.log.warn(`[断言] ${label} 超时未消失`)
    return false
  }

  /**
   * 发布后结果验证 — 检测成功/失败信号
   * @param {object} options
   * @param {string[]} [options.successTexts] - 成功提示文本
   * @param {string[]} [options.errorTexts] - 错误提示文本
   * @param {string} [options.successUrlPattern] - 成功跳转 URL 模式
   * @param {number} [options.timeout] - 最大等待时间
   * @returns {{status: 'success'|'error'|'unknown', evidence: string}}
   */
  async waitForPublishResult(options = {}) {
    const {
      successTexts = ['发布成功', '已发布', '发表成功', '提交成功'],
      errorTexts = ['发布失败', '发表失败', '请重试', '网络错误', '审核不通过'],
      successUrlPattern = null,
      timeout = 10000
    } = options

    const start = Date.now()
    while (Date.now() - start < timeout) {
      // 检查 URL 跳转
      if (successUrlPattern) {
        const url = this.page.url()
        if (url.includes(successUrlPattern)) {
          this.log.info(`[断言] 发布成功（URL 跳转）: ${url.substring(0, 80)}`)
          const r = { status: 'success', evidence: `url:${url.substring(0, 80)}` }
          this.addStepEvidence('publishResult', r)
          return r
        }
      }

      // 检查页面文本
      try {
        const bodyText = await this.page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '')

        for (const text of errorTexts) {
          if (bodyText.includes(text)) {
            this.log.warn(`[断言] 发布可能失败: 检测到 "${text}"`)
            const r = { status: 'error', evidence: `text:${text}` }
            this.addStepEvidence('publishResult', r)
            return r
          }
        }

        for (const text of successTexts) {
          if (bodyText.includes(text)) {
            this.log.info(`[断言] 发布成功: 检测到 "${text}" ✓`)
            const r = { status: 'success', evidence: `text:${text}` }
            this.addStepEvidence('publishResult', r)
            return r
          }
        }
      } catch { /* page may be navigating */ }

      await randomDelay(500, 1000)
    }

    this.log.warn(`[断言] 发布结果未知（${timeout}ms 内未检测到明确信号）`)
    const result = { status: 'unknown', evidence: 'timeout' }
    this.addStepEvidence('publishResult', result)
    return result
  }
}
