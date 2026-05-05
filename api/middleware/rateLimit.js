/**
 * API 请求频率限制中间件
 *
 * 配置:
 *   api.rate_limit_window: 60000   (毫秒)
 *   api.rate_limit_max: 60         (窗口内最大请求数)
 */
import rateLimit from 'express-rate-limit'
import { cfg } from '../../core/config.js'

export function createRateLimiter() {
  return rateLimit({
    windowMs: cfg('api.rate_limit_window', 60000),
    max: cfg('api.rate_limit_max', 60),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too Many Requests',
      message: '请求频率过高，请稍后再试',
    },
  })
}
