import { getLogger } from './logger.js'
import { cfg } from './config.js'

/**
 * AI 视觉验证模块
 *
 * 在发布前截图页面，调用视觉模型验证填充内容是否正确。
 * 使用 OpenAI 兼容 API 格式，支持 GLM-4V-Flash / GPT-4V / Qwen-VL 等。
 *
 * 配置项:
 *   vision.enabled           — 是否启用视觉验证
 *   vision.api_key           — API Key（也可通过 VISION_API_KEY 环境变量设置）
 *   vision.base_url          — API 端点（OpenAI 兼容格式）
 *   vision.model             — 模型名称
 *   vision.timeout           — 请求超时（毫秒）
 */

/**
 * 截图并转为 base64
 * @param {Page} page - Puppeteer page
 * @returns {Promise<string>} base64 编码的 PNG 图片
 */
async function screenshotToBase64(page) {
  const buffer = await page.screenshot({ fullPage: false, encoding: 'binary' })
  return Buffer.from(buffer).toString('base64')
}

/**
 * 构建发布前验证的提示词
 * @param {object} expected - 期望的内容 { title, content, tags }
 * @returns {string}
 */
function buildVerifyPrompt(expected) {
  const parts = []

  if (expected.title) {
    parts.push(`- 标题应包含: "${expected.title}"`)
  }
  if (expected.content) {
    // 取正文前 200 字作为验证参考
    const preview = expected.content.slice(0, 200)
    parts.push(`- 正文应包含类似内容: "${preview}"`)
  }
  if (expected.tags && expected.tags.length > 0) {
    parts.push(`- 标签/话题应包含: ${expected.tags.join(', ')}`)
  }
  if (expected.imageCount) {
    parts.push(`- 应有 ${expected.imageCount} 张图片已上传`)
  }

  return `你是一个网页内容验证助手。请仔细查看这张截图，验证以下内容是否已正确填写在页面上：

${parts.join('\n')}

## 验证规则
1. 检查截图中是否能看到上述内容（允许文字被截断或部分可见）
2. 如果看到编辑器/表单中有对应内容，视为已填写
3. 图片上传状态：能看到图片缩略图即为已上传

## 返回格式（严格 JSON）
{
  "pass": true 或 false,
  "confidence": 0.0-1.0 的置信度,
  "details": "具体验证结果描述",
  "issues": ["问题1", "问题2"] 或 []
}

只返回 JSON，不要其他内容。`
}

/**
 * 调用视觉模型验证截图内容
 *
 * @param {Page} page - Puppeteer page 实例
 * @param {object} expected - 期望内容 { title?, content?, tags?, imageCount? }
 * @returns {Promise<{pass: boolean, confidence: number, details: string, issues: string[]}>}
 */
export async function verifyPageContent(page, expected) {
  const log = getLogger()

  const enabled = cfg('vision.enabled', false)
  if (!enabled) {
    log.debug('[视觉验证] 未启用，跳过')
    return { pass: true, confidence: 1.0, details: '视觉验证未启用，跳过', issues: [] }
  }

  const apiKey = cfg('vision.api_key', '') || process.env.VISION_API_KEY || ''
  const baseUrl = cfg('vision.base_url', 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
  const model = cfg('vision.model', 'glm-4v-flash')
  const timeout = cfg('vision.timeout', 30000)

  if (!apiKey) {
    log.warn('[视觉验证] 未配置 API Key（vision.api_key 或 VISION_API_KEY 环境变量），跳过')
    return { pass: true, confidence: 0, details: '未配置 API Key，跳过验证', issues: [] }
  }

  log.info(`[视觉验证] 截图中... (model: ${model})`)

  try {
    // 截图转 base64
    const base64Image = await screenshotToBase64(page)

    // 构建请求
    const requestBody = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildVerifyPrompt(expected) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
        ]
      }],
      max_tokens: 500,
      temperature: 0.1
    }

    // 调用 API
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

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
      log.warn(`[视觉验证] API 调用失败: ${response.status} - ${errText.slice(0, 200)}`)
      // API 失败不阻塞发布流程
      return { pass: true, confidence: 0, details: `API 调用失败: ${response.status}`, issues: [] }
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content || ''

    if (!content.trim()) {
      log.warn('[视觉验证] 模型返回空内容')
      return { pass: true, confidence: 0, details: '模型返回空内容', issues: [] }
    }

    // 解析 JSON 响应
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) jsonStr = jsonMatch[1].trim()

    const parsed = JSON.parse(jsonStr)
    const verification = {
      pass: !!parsed.pass,
      confidence: parsed.confidence || 0,
      details: parsed.details || '',
      issues: parsed.issues || []
    }

    if (verification.pass) {
      log.info(`[视觉验证] ✅ 通过 (置信度: ${verification.confidence})`)
    } else {
      log.warn(`[视觉验证] ❌ 未通过: ${verification.details}`)
      log.warn(`[视觉验证] 问题: ${verification.issues.join('; ')}`)
    }

    return verification

  } catch (err) {
    log.warn(`[视觉验证] 异常: ${err.message}`)
    // 验证异常不阻塞发布流程
    return { pass: true, confidence: 0, details: `验证异常: ${err.message}`, issues: [] }
  }
}
