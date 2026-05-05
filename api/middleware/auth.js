/**
 * API Key 鉴权中间件（fail-closed 模式）
 *
 * 请求头: X-API-Key: your-api-key
 * 或查询参数: ?api_key=your-api-key
 *
 * 安全策略:
 *   - api.auth_enabled: false → 显式关闭鉴权（仅限开发环境）
 *   - api.key 未配置 → 拒绝所有请求（fail-closed）
 *   - api.key 已配置 → 正常校验
 *
 * 配置:
 *   api.key: "your-secret-key"
 *   api.auth_enabled: true/false（默认 true）
 */
import crypto from 'crypto'
import { cfg } from '../../core/config.js'
import { getLogger } from '../../core/logger.js'

let _warnedNoKey = false

export function authMiddleware(req, res, next) {
  const authEnabled = cfg('api.auth_enabled', true)

  // 显式关闭鉴权（开发模式，必须在配置中明确设置 auth_enabled: false）
  if (!authEnabled) return next()

  const configKey = cfg('api.key', '')
  if (!configKey) {
    // fail-closed：未配置 API Key 时拒绝所有请求
    if (!_warnedNoKey) {
      try {
        const log = getLogger()
        log.error('[Security] api.key 未配置！所有需要鉴权的请求将被拒绝。请在 zenoclaw.config.yaml 中设置 api.key，或设置 api.auth_enabled: false 以关闭鉴权（仅限开发环境）。')
      } catch { /* logger 可能未初始化 */ }
      _warnedNoKey = true
    }
    return res.status(503).json({
      error: 'ServiceUnavailable',
      message: 'API Key 未配置，服务拒绝请求。请在 zenoclaw.config.yaml 中设置 api.key。',
    })
  }

  const requestKey = req.headers['x-api-key'] || req.query.api_key
  if (!requestKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '缺少 API Key，请在请求头中添加 X-API-Key',
    })
  }

  // 恒定时间比较，防止时序攻击
  if (!timingSafeEqual(requestKey, configKey)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'API Key 无效',
    })
  }

  next()
}

/**
 * 恒定时间字符串比较（防止时序攻击）
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  // 长度不等时仍做恒定时间比较（填充到相同长度）
  const maxLen = Math.max(a.length, b.length)
  const bufA = Buffer.alloc(maxLen, 0)
  const bufB = Buffer.alloc(maxLen, 0)
  Buffer.from(a).copy(bufA)
  Buffer.from(b).copy(bufB)
  return a.length === b.length && crypto.timingSafeEqual(bufA, bufB)
}
