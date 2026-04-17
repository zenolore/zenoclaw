import { getLogger } from './logger.js'
import { cfg } from './config.js'

/**
 * AI 视觉定位 & 页面验证模块
 *
 * 基于截图 + GLM-4V 视觉模型实现：
 *   1. 页面就绪验证 — 截图判断页面是否完整加载
 *   2. 内容填写验证 — 截图判断表单是否正确填写
 *   3. 元素坐标定位 — 截图识别目标元素的屏幕坐标
 *   4. 弹窗检测处理 — 截图识别弹窗并定位关闭按钮坐标
 *   5. 发布结果判断 — 截图判断发布后的页面状态
 *
 * 设计原则：
 *   - 零 DOM 侵入：只用 page.screenshot()，不注入脚本、不遍历 DOM
 *   - 向后兼容：vision.enabled = false 时所有函数返回默认值，不阻塞流程
 *   - 智能计时：视觉检测耗时计入操作延迟，剩余时间再等待
 *
 * 配置项:
 *   vision.enabled    — 是否启用（false 时所有函数直接返回默认值）
 *   vision.api_key    — API Key
 *   vision.base_url   — API 端点（含 /chat/completions）
 *   vision.model      — 模型名称（如 glm-4v-flash）
 *   vision.timeout    — 单次请求超时（毫秒）
 */

const log = getLogger()

// ============================================================
// 内部工具
// ============================================================

/**
 * 截图转 base64（零侵入，只调 Puppeteer 截图 API）
 */
async function screenshotBase64(page, fullPage = false) {
  const buffer = await page.screenshot({ fullPage, encoding: 'binary' })
  return Buffer.from(buffer).toString('base64')
}

/**
 * 检查视觉模型是否已启用且配置完整
 */
function isVisionEnabled() {
  const enabled = cfg('vision.enabled', false)
  const apiKey = cfg('vision.api_key', '') || process.env.VISION_API_KEY || ''
  return enabled && !!apiKey
}

/**
 * 调用视觉模型 API（OpenAI 兼容格式）
 *
 * @param {string} prompt - 文本提示
 * @param {string} imageBase64 - 图片 base64
 * @param {object} [options]
 * @param {number} [options.maxTokens=800] - 最大输出 token
 * @param {number} [options.temperature=0.1] - 温度
 * @returns {Promise<string>} 模型返回的文本
 */
async function callVisionModel(prompt, imageBase64, options = {}) {
  const apiKey = cfg('vision.api_key', '') || process.env.VISION_API_KEY || ''
  const baseUrl = cfg('vision.base_url', 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
  const model = cfg('vision.model', 'glm-4v-flash')
  const timeout = cfg('vision.timeout', 30000)
  const maxTokens = options.maxTokens || 800
  const temperature = options.temperature ?? 0.1

  const requestBody = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
      ]
    }],
    max_tokens: maxTokens,
    temperature
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })

    clearTimeout(timer)

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`)
    }

    const result = await response.json()
    return result.choices?.[0]?.message?.content?.trim() || ''
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/**
 * 从模型返回文本中提取 JSON
 */
function extractJSON(text) {
  if (!text) return null
  // 尝试从 markdown 代码块中提取
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = codeBlock ? codeBlock[1].trim() : text.trim()
  try {
    return JSON.parse(jsonStr)
  } catch {
    // 尝试找到第一个 { 到最后一个 } 的范围
    const start = jsonStr.indexOf('{')
    const end = jsonStr.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(jsonStr.slice(start, end + 1))
      } catch { return null }
    }
    return null
  }
}

// ============================================================
// 智能计时器
// ============================================================

/**
 * 智能延迟：视觉检测耗时计入总延迟，只等待剩余时间
 *
 * 示例：计划延迟 10s，视觉检测花了 6s → 只再等 4s
 *
 * @param {number} startTime - 操作开始时间 (Date.now())
 * @param {number} targetDelayMs - 目标总延迟（毫秒）
 */
export async function smartDelay(startTime, targetDelayMs) {
  const elapsed = Date.now() - startTime
  const remaining = targetDelayMs - elapsed
  if (remaining > 500) {
    log.debug(`[智能计时] 已耗时 ${(elapsed/1000).toFixed(1)}s，再等 ${(remaining/1000).toFixed(1)}s`)
    await new Promise(r => setTimeout(r, remaining))
  } else {
    log.debug(`[智能计时] 视觉检测已耗时 ${(elapsed/1000).toFixed(1)}s ≥ 目标延迟 ${(targetDelayMs/1000).toFixed(1)}s，无需额外等待`)
  }
}

// ============================================================
// 1. 页面就绪验证
// ============================================================

/**
 * 截图验证页面是否完整加载
 *
 * 向后兼容：vision.enabled = false 时直接返回 { ready: true }
 *
 * @param {Page} page - Puppeteer page
 * @param {string} pageDescription - 页面描述（如 "Reddit 发帖页面"）
 * @param {string[]} [expectedElements] - 期望看到的元素描述列表
 * @returns {Promise<{ready: boolean, details: string, elapsed: number}>}
 */
export async function verifyPageReady(page, pageDescription, expectedElements = []) {
  const startTime = Date.now()

  if (!isVisionEnabled()) {
    return { ready: true, details: '视觉验证未启用', elapsed: 0 }
  }

  try {
    const base64 = await screenshotBase64(page)

    const elementsStr = expectedElements.length > 0
      ? `\n期望看到以下元素：\n${expectedElements.map(e => `- ${e}`).join('\n')}`
      : ''

    const prompt = `你是一个网页自动化助手。请查看这张截图，判断页面是否已完整加载。

当前应该是: ${pageDescription}
${elementsStr}

## 判断标准
1. 页面主体内容是否已渲染完成（不是空白页、不是加载中）
2. 关键交互元素（按钮、输入框、链接等）是否已出现
3. 是否有 loading 动画或骨架屏仍在显示
4. 页面布局是否正常（没有错位、没有只显示一半）

## 返回格式（严格 JSON）
{
  "ready": true 或 false,
  "details": "具体描述页面当前状态",
  "missing": ["缺少的元素1", "缺少的元素2"] 或 []
}

只返回 JSON，不要其他内容。`

    const response = await callVisionModel(prompt, base64)
    const parsed = extractJSON(response)
    const elapsed = Date.now() - startTime

    if (parsed) {
      log.info(`[视觉验证] 页面就绪: ${parsed.ready ? '✅' : '❌'} (${(elapsed/1000).toFixed(1)}s) — ${parsed.details}`)
      if (!parsed.ready && parsed.missing?.length > 0) {
        log.warn(`[视觉验证] 缺少: ${parsed.missing.join(', ')}`)
      }
      return { ready: !!parsed.ready, details: parsed.details || '', elapsed }
    }

    log.warn(`[视觉验证] 模型返回无法解析，视为已就绪`)
    return { ready: true, details: '模型返回无法解析', elapsed }

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.warn(`[视觉验证] 页面就绪检测异常 (${(elapsed/1000).toFixed(1)}s): ${err.message}`)
    // 异常不阻塞流程
    return { ready: true, details: `检测异常: ${err.message}`, elapsed }
  }
}

// ============================================================
// 2. 内容填写验证
// ============================================================

/**
 * 截图验证表单内容是否已正确填写
 *
 * @param {Page} page - Puppeteer page
 * @param {object} expected - 期望内容
 * @param {string} [expected.title] - 期望标题
 * @param {string} [expected.content] - 期望正文（取前 200 字）
 * @param {number} [expected.imageCount] - 期望图片数量
 * @param {string[]} [expected.tags] - 期望标签
 * @returns {Promise<{pass: boolean, confidence: number, details: string, issues: string[], elapsed: number}>}
 */
export async function verifyContentFilled(page, expected) {
  const startTime = Date.now()

  if (!isVisionEnabled()) {
    return { pass: true, confidence: 1.0, details: '视觉验证未启用', issues: [], elapsed: 0 }
  }

  try {
    const base64 = await screenshotBase64(page)

    const parts = []
    if (expected.title) {
      parts.push(`- 标题应包含: "${expected.title}"`)
    }
    if (expected.content) {
      const preview = expected.content.slice(0, 200)
      parts.push(`- 正文应包含类似内容: "${preview}"`)
    }
    if (expected.imageCount) {
      parts.push(`- 应有 ${expected.imageCount} 张图片已上传（能看到缩略图）`)
    }
    if (expected.tags && expected.tags.length > 0) {
      parts.push(`- 标签/话题应包含: ${expected.tags.join(', ')}`)
    }

    const prompt = `你是一个网页内容验证助手。请仔细查看这张截图，验证以下内容是否已正确填写在页面上：

${parts.join('\n')}

## 验证规则
1. 检查截图中是否能看到上述内容（允许文字被截断或部分可见）
2. 如果看到编辑器/表单中有对应内容，视为已填写
3. 图片上传状态：能看到图片缩略图即为已上传
4. 如果某项完全看不到，列入 issues

## 返回格式（严格 JSON）
{
  "pass": true 或 false,
  "confidence": 0.0-1.0 的置信度,
  "details": "具体验证结果描述",
  "issues": ["问题1", "问题2"] 或 []
}

只返回 JSON，不要其他内容。`

    const response = await callVisionModel(prompt, base64)
    const parsed = extractJSON(response)
    const elapsed = Date.now() - startTime

    if (parsed) {
      const result = {
        pass: !!parsed.pass,
        confidence: parsed.confidence || 0,
        details: parsed.details || '',
        issues: parsed.issues || [],
        elapsed
      }
      if (result.pass) {
        log.info(`[视觉验证] 内容检查: ✅ 通过 (置信度: ${result.confidence}, ${(elapsed/1000).toFixed(1)}s)`)
      } else {
        log.warn(`[视觉验证] 内容检查: ❌ 未通过 — ${result.details}`)
        log.warn(`[视觉验证] 问题: ${result.issues.join('; ')}`)
      }
      return result
    }

    log.warn('[视觉验证] 模型返回无法解析')
    return { pass: true, confidence: 0, details: '模型返回无法解析', issues: [], elapsed: Date.now() - startTime }

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.warn(`[视觉验证] 内容验证异常 (${(elapsed/1000).toFixed(1)}s): ${err.message}`)
    return { pass: true, confidence: 0, details: `验证异常: ${err.message}`, issues: [], elapsed }
  }
}

// ============================================================
// 3. 元素坐标定位
// ============================================================

/**
 * 截图识别目标元素的屏幕坐标
 *
 * 用于选择器失败时，通过 AI 视觉找到元素位置，
 * 然后用 ghost-cursor 移动到该坐标点击（模拟真人操作）
 *
 * @param {Page} page - Puppeteer page
 * @param {string} elementDescription - 目标元素描述（如 "发布按钮"、"标题输入框"）
 * @param {object} [options]
 * @param {boolean} [options.fullPage=false] - 是否截全页
 * @returns {Promise<{found: boolean, x: number, y: number, description: string, elapsed: number}>}
 */
export async function locateElement(page, elementDescription, options = {}) {
  const startTime = Date.now()

  if (!isVisionEnabled()) {
    return { found: false, x: 0, y: 0, description: '视觉定位未启用', elapsed: 0 }
  }

  try {
    const base64 = await screenshotBase64(page, options.fullPage || false)

    // 获取视口尺寸供 AI 参考
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    const prompt = `你是一个网页元素定位助手。请在这张截图中找到以下目标元素：

目标元素: ${elementDescription}

截图尺寸: ${viewport.width} x ${viewport.height} 像素

## 定位规则
1. 找到目标元素后，返回其**中心点**的像素坐标（x, y）
2. x 是从左到右的水平坐标，y 是从上到下的垂直坐标
3. 坐标必须是整数
4. 如果目标元素不在截图中，返回 found: false
5. 如果有多个匹配，选择最明显/最主要的那个

## 返回格式（严格 JSON）
{
  "found": true 或 false,
  "x": 水平坐标整数,
  "y": 垂直坐标整数,
  "description": "找到的元素描述（如：页面右上角的蓝色发布按钮）"
}

只返回 JSON，不要其他内容。`

    const response = await callVisionModel(prompt, base64)
    const parsed = extractJSON(response)
    const elapsed = Date.now() - startTime

    if (parsed && parsed.found) {
      const x = Math.round(parsed.x)
      const y = Math.round(parsed.y)
      // 坐标合理性检查
      if (x > 0 && y > 0 && x < viewport.width + 50 && y < viewport.height + 50) {
        log.info(`[视觉定位] 找到 "${elementDescription}" → (${x}, ${y}) — ${parsed.description} (${(elapsed/1000).toFixed(1)}s)`)
        return { found: true, x, y, description: parsed.description || '', elapsed }
      }
      log.warn(`[视觉定位] 坐标超出合理范围: (${x}, ${y})，视口 ${viewport.width}x${viewport.height}`)
    }

    if (parsed && !parsed.found) {
      log.warn(`[视觉定位] 未找到 "${elementDescription}" — ${parsed.description || '目标不在截图中'} (${(elapsed/1000).toFixed(1)}s)`)
    }

    return { found: false, x: 0, y: 0, description: parsed?.description || '未找到目标元素', elapsed: Date.now() - startTime }

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.warn(`[视觉定位] 异常 (${(elapsed/1000).toFixed(1)}s): ${err.message}`)
    return { found: false, x: 0, y: 0, description: `定位异常: ${err.message}`, elapsed }
  }
}

// ============================================================
// 4. 弹窗检测与处理
// ============================================================

/**
 * 截图检测弹窗并定位关闭/确认按钮坐标
 *
 * @param {Page} page - Puppeteer page
 * @param {string} [action='close'] - 弹窗处理方式: 'close'(关闭) | 'confirm'(确认)
 * @returns {Promise<{hasPopup: boolean, buttonX: number, buttonY: number, popupType: string, elapsed: number}>}
 */
export async function detectPopup(page, action = 'close') {
  const startTime = Date.now()

  if (!isVisionEnabled()) {
    return { hasPopup: false, buttonX: 0, buttonY: 0, popupType: '', elapsed: 0 }
  }

  try {
    const base64 = await screenshotBase64(page)

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    const actionDesc = action === 'confirm'
      ? '确认/确定/同意/提交 按钮'
      : '关闭/取消/× 按钮'

    const prompt = `你是一个网页弹窗检测助手。请查看这张截图，判断是否有弹窗/对话框/提示框覆盖在主内容上方。

截图尺寸: ${viewport.width} x ${viewport.height} 像素

## 判断标准
1. 弹窗通常有半透明遮罩层（背景变暗）
2. 弹窗通常在页面中央，有明确的边框或阴影
3. cookie 提示、通知权限请求、登录引导等都算弹窗
4. 下拉菜单、tooltip 不算弹窗

## 如果检测到弹窗
请找到弹窗上的${actionDesc}的中心点坐标。

## 返回格式（严格 JSON）
{
  "hasPopup": true 或 false,
  "popupType": "弹窗类型描述（如: cookie提示、登录引导、发布确认）",
  "buttonX": 按钮中心X坐标整数（没有弹窗时为0）,
  "buttonY": 按钮中心Y坐标整数（没有弹窗时为0）,
  "buttonDescription": "按钮描述（如: 右上角的×按钮）"
}

只返回 JSON，不要其他内容。`

    const response = await callVisionModel(prompt, base64)
    const parsed = extractJSON(response)
    const elapsed = Date.now() - startTime

    if (parsed) {
      if (parsed.hasPopup) {
        log.info(`[视觉检测] 发现弹窗: ${parsed.popupType} → 按钮 (${parsed.buttonX}, ${parsed.buttonY}) ${parsed.buttonDescription || ''} (${(elapsed/1000).toFixed(1)}s)`)
      } else {
        log.debug(`[视觉检测] 无弹窗 (${(elapsed/1000).toFixed(1)}s)`)
      }
      return {
        hasPopup: !!parsed.hasPopup,
        buttonX: Math.round(parsed.buttonX || 0),
        buttonY: Math.round(parsed.buttonY || 0),
        popupType: parsed.popupType || '',
        elapsed
      }
    }

    return { hasPopup: false, buttonX: 0, buttonY: 0, popupType: '', elapsed: Date.now() - startTime }

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.warn(`[视觉检测] 弹窗检测异常 (${(elapsed/1000).toFixed(1)}s): ${err.message}`)
    return { hasPopup: false, buttonX: 0, buttonY: 0, popupType: '', elapsed }
  }
}

// ============================================================
// 5. 发布结果判断
// ============================================================

/**
 * 截图判断发布后的页面状态
 *
 * @param {Page} page - Puppeteer page
 * @param {string} platformName - 平台名称
 * @returns {Promise<{status: string, hasPopup: boolean, popupAction: string, buttonX: number, buttonY: number, details: string, elapsed: number}>}
 */
export async function judgePublishResult(page, platformName) {
  const startTime = Date.now()

  if (!isVisionEnabled()) {
    return { status: 'unknown', hasPopup: false, popupAction: '', buttonX: 0, buttonY: 0, details: '视觉验证未启用', elapsed: 0 }
  }

  try {
    const base64 = await screenshotBase64(page)

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    const prompt = `你是一个网页自动化助手。我刚在 ${platformName} 平台上点击了发布按钮。请查看这张截图，判断当前的发布状态。

截图尺寸: ${viewport.width} x ${viewport.height} 像素

## 可能的情况
1. **发布成功** — 页面跳转到了帖子详情页/个人主页/feed流，或显示"发布成功"提示
2. **需要确认** — 出现了确认弹窗（如"确认发布？"、"发布到哪个社区？"）
3. **需要关闭** — 出现了提示弹窗需要关闭（如"发布成功，分享到..."）
4. **发布失败** — 出现了错误提示（如"发布失败"、"请重试"、"内容违规"）
5. **仍在编辑** — 还在编辑页面，发布按钮可能没点到或页面没响应
6. **加载中** — 正在提交，显示 loading

## 如果有弹窗/对话框，请找到应该点击的按钮的坐标

## 返回格式（严格 JSON）
{
  "status": "success" | "need_confirm" | "need_close" | "failed" | "still_editing" | "loading",
  "hasPopup": true 或 false,
  "popupAction": "应该点击的按钮文字（如: 确认发布、关闭、×）",
  "buttonX": 按钮中心X坐标整数（没有弹窗时为0）,
  "buttonY": 按钮中心Y坐标整数（没有弹窗时为0）,
  "details": "详细描述当前页面状态"
}

只返回 JSON，不要其他内容。`

    const response = await callVisionModel(prompt, base64)
    const parsed = extractJSON(response)
    const elapsed = Date.now() - startTime

    if (parsed) {
      log.info(`[视觉判断] 发布结果: ${parsed.status} — ${parsed.details} (${(elapsed/1000).toFixed(1)}s)`)
      if (parsed.hasPopup) {
        log.info(`[视觉判断] 弹窗操作: "${parsed.popupAction}" → (${parsed.buttonX}, ${parsed.buttonY})`)
      }
      return {
        status: parsed.status || 'unknown',
        hasPopup: !!parsed.hasPopup,
        popupAction: parsed.popupAction || '',
        buttonX: Math.round(parsed.buttonX || 0),
        buttonY: Math.round(parsed.buttonY || 0),
        details: parsed.details || '',
        elapsed
      }
    }

    return { status: 'unknown', hasPopup: false, popupAction: '', buttonX: 0, buttonY: 0, details: '模型返回无法解析', elapsed: Date.now() - startTime }

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.warn(`[视觉判断] 发布结果判断异常 (${(elapsed/1000).toFixed(1)}s): ${err.message}`)
    return { status: 'unknown', hasPopup: false, popupAction: '', buttonX: 0, buttonY: 0, details: `异常: ${err.message}`, elapsed }
  }
}
