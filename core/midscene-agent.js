/**
 * Midscene.js 封装层 — AI 视觉状态机
 *
 * 将 Midscene 的 PuppeteerAgent 封装为 ZenoClaw 的内部模块，
 * 统一处理：配置桥接、环境变量设置、agent 生命周期、错误容错。
 *
 * 使用方式：
 *   const { createMidsceneAgent } = await import('./core/midscene-agent.js')
 *   const agent = await createMidsceneAgent(page)
 *   if (agent) {
 *     await agent.aiAssert('页面显示发布成功')
 *   }
 *
 * 配置项（zenoclaw.config.yaml → midscene.*）：
 *   midscene.enabled           — 总开关
 *   midscene.model_name        — 视觉模型名称
 *   midscene.model_family      — 模型族
 *   midscene.base_url          — API 端点
 *   midscene.api_key           — API Key（也可通过 MIDSCENE_MODEL_API_KEY 环境变量）
 *   midscene.timeout           — 单次调用超时
 */

import { getLogger } from './logger.js'
import { cfg } from './config.js'

let _PuppeteerAgent = null

/**
 * 延迟加载 @midscene/web/puppeteer（避免未安装时阻塞启动）
 */
async function loadPuppeteerAgent() {
  if (_PuppeteerAgent) return _PuppeteerAgent
  try {
    const mod = await import('@midscene/web/puppeteer')
    _PuppeteerAgent = mod.PuppeteerAgent
    return _PuppeteerAgent
  } catch (err) {
    getLogger().warn(`[Midscene] 加载 @midscene/web 失败: ${err.message}`)
    return null
  }
}

/**
 * 将 ZenoClaw 配置桥接到 Midscene 所需的环境变量
 * Midscene 通过 process.env 读取模型配置
 */
function bridgeConfigToEnv() {
  const apiKey = cfg('midscene.api_key', '') || cfg('vision.api_key', '') || process.env.VISION_API_KEY || ''
  const baseUrl = cfg('midscene.base_url', 'https://open.bigmodel.cn/api/paas/v4')
  const modelName = cfg('midscene.model_name', 'glm-4v-flash')
  const modelFamily = cfg('midscene.model_family', 'glm-v')

  if (apiKey && !process.env.MIDSCENE_MODEL_API_KEY) {
    process.env.MIDSCENE_MODEL_API_KEY = apiKey
  }
  if (!process.env.MIDSCENE_MODEL_BASE_URL) {
    process.env.MIDSCENE_MODEL_BASE_URL = baseUrl
  }
  if (!process.env.MIDSCENE_MODEL_NAME) {
    process.env.MIDSCENE_MODEL_NAME = modelName
  }
  if (!process.env.MIDSCENE_MODEL_FAMILY) {
    process.env.MIDSCENE_MODEL_FAMILY = modelFamily
  }

  return { apiKey, baseUrl, modelName, modelFamily }
}

/**
 * 为一个 Puppeteer page 创建 Midscene Agent
 *
 * @param {import('puppeteer-core').Page} page - Puppeteer page 实例
 * @returns {Promise<import('@midscene/web/puppeteer').PuppeteerAgent|null>}
 *          成功返回 agent，未启用或失败返回 null
 */
export async function createMidsceneAgent(page) {
  const log = getLogger()
  const enabled = cfg('midscene.enabled', false)

  if (!enabled) {
    log.debug('[Midscene] 未启用（midscene.enabled = false），跳过')
    return null
  }

  const { apiKey, modelName } = bridgeConfigToEnv()
  if (!apiKey) {
    log.warn('[Midscene] 未配置 API Key（midscene.api_key 或 MIDSCENE_MODEL_API_KEY），跳过')
    return null
  }

  const AgentClass = await loadPuppeteerAgent()
  if (!AgentClass) {
    log.warn('[Midscene] @midscene/web 未安装或加载失败，跳过')
    return null
  }

  try {
    const agent = new AgentClass(page, {
      forceSameTabNavigation: false, // 允许新标签页（ZenoClaw 需要）
    })
    log.info(`[Midscene] ✅ Agent 已创建 (model: ${modelName})`)
    return agent
  } catch (err) {
    log.warn(`[Midscene] Agent 创建失败: ${err.message}`)
    return null
  }
}

/**
 * 安全执行 Midscene AI 操作（容错包装）
 * 任何 Midscene 调用失败都不会阻塞主流程
 *
 * @param {object|null} agent - Midscene PuppeteerAgent
 * @param {'aiAct'|'aiAssert'|'aiQuery'} method - 调用方法
 * @param {string} prompt - 自然语言指令
 * @param {object} [options] - 额外选项
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
export async function safeMidsceneCall(agent, method, prompt, options = {}) {
  const log = getLogger()

  if (!agent) {
    return { success: false, error: 'agent_not_available' }
  }

  const timeout = cfg('midscene.timeout', 30000)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    let result
    if (method === 'aiAct') {
      result = await agent.aiAct(prompt)
    } else if (method === 'aiAssert') {
      result = await agent.aiAssert(prompt)
    } else if (method === 'aiQuery') {
      result = await agent.aiQuery(prompt)
    } else {
      clearTimeout(timer)
      return { success: false, error: `unknown method: ${method}` }
    }

    clearTimeout(timer)
    log.info(`[Midscene] ${method}("${prompt.slice(0, 60)}") ✅`)
    return { success: true, result }
  } catch (err) {
    log.warn(`[Midscene] ${method}("${prompt.slice(0, 60)}") 失败: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * 检查 Midscene 是否可用（包已安装 + 已启用 + 有 API Key）
 * @returns {Promise<boolean>}
 */
export async function isMidsceneAvailable() {
  if (!cfg('midscene.enabled', false)) return false
  const apiKey = cfg('midscene.api_key', '') || cfg('vision.api_key', '') || process.env.VISION_API_KEY || ''
  if (!apiKey) return false
  const AgentClass = await loadPuppeteerAgent()
  return !!AgentClass
}
