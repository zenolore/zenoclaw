/**
 * ZenoClaw API Server
 *
 * 启动方式:
 *   npm run api          # 生产模式
 *   npm run dev          # 开发模式（热重载日志）
 *
 * 默认端口: 3200
 * 配置: api.port, api.host
 */
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

import { initConfig, cfg } from '../core/config.js'
import { initLogger, getLogger } from '../core/logger.js'
import { initPlugins } from '../plugins/manager.js'
import { authMiddleware } from './middleware/auth.js'
import { createRateLimiter } from './middleware/rateLimit.js'

// Routes
import { publishRouter, startScheduledTaskPoller } from './routes/publish.js'
import { statsRouter } from './routes/stats.js'
import { analyticsRouter } from './routes/analytics.js'
import { interactRouter } from './routes/interact.js'
import { browseRouter } from './routes/browse.js'
import { accountRouter } from './routes/account.js'
import { scheduleRouter, restoreSchedules } from './routes/schedule.js'
import { platformsRouter } from './routes/platforms.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ============================================================
// 加载配置
// ============================================================
function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'zenoclaw.config.yaml')
  const fallbackPath = path.resolve(process.cwd(), 'config.yaml')
  const target = fs.existsSync(configPath) ? configPath
    : fs.existsSync(fallbackPath) ? fallbackPath : null

  if (!target) {
    console.warn('⚠️  未找到配置文件，使用默认配置')
    return {}
  }
  return yaml.load(fs.readFileSync(target, 'utf-8')) || {}
}

// ============================================================
// 启动服务
// ============================================================
async function startServer() {
  const config = loadConfig()
  initConfig(config)
  initLogger(config)
  await initPlugins(config)

  const log = getLogger()

  // 恢复已持久化的定时任务
  restoreSchedules()

  // 启动 schedule_at 定时任务轮询器
  startScheduledTaskPoller()

  const app = express()

  // --- 基础中间件 ---
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cors({
    origin: cfg('api.cors_origin', '*'),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  // --- 请求日志 ---
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      const ms = Date.now() - start
      log.info(`${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`)
    })
    next()
  })

  // --- 健康检查（鉴权前，用于前端 key 验证） ---
  app.get('/api/health', (req, res) => {
    // 如果请求带了 X-API-Key，先验证
    const requestKey = req.headers['x-api-key']
    const configKey = cfg('api.key', '')
    const authEnabled = cfg('api.auth_enabled', true)

    if (!authEnabled) {
      return res.json({ status: 'ok', auth: 'disabled' })
    }
    if (!configKey) {
      return res.status(503).json({ status: 'error', message: 'API Key 未配置' })
    }
    if (!requestKey) {
      return res.status(401).json({ status: 'error', message: '缺少 API Key' })
    }
    if (requestKey !== configKey) {
      return res.status(403).json({ status: 'error', message: 'API Key 无效' })
    }
    res.json({ status: 'ok', auth: 'valid' })
  })

  // --- 鉴权 + 限流 ---
  app.use('/api', authMiddleware)
  app.use('/api', createRateLimiter())

  // --- 只读配置端点（供前端展示当前服务配置） ---
  app.get('/api/config', (req, res) => {
    const visionKey = cfg('vision.api_key', '') || process.env.VISION_API_KEY || ''
    res.json({
      api: {
        port: cfg('api.port', 3200),
        cors_origin: cfg('api.cors_origin', '*'),
        rate_limit_max: cfg('api.rate_limit_max', 60),
        auth_enabled: cfg('api.auth_enabled', true),
      },
      plugins: {
        notifier: cfg('plugins.notifier', 'console'),
        captcha_solver: cfg('plugins.captcha_solver', 'manual'),
      },
      vision: {
        enabled: cfg('vision.enabled', false),
        has_key: !!visionKey,
        key_source: visionKey ? (process.env.VISION_API_KEY ? 'env' : 'config') : 'none',
        base_url: cfg('vision.base_url', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'),
        model: cfg('vision.model', 'glm-4v-flash'),
        timeout: cfg('vision.timeout', 30000),
      },
      data_dir: cfg('plugins.stats_dir', './data/stats'),
    })
  })

  // --- API 路由 ---
  app.use('/api/publish', publishRouter)
  app.use('/api/stats', statsRouter)
  app.use('/api/analytics', analyticsRouter)
  app.use('/api/interact', interactRouter)
  app.use('/api/browse', browseRouter)
  app.use('/api/account', accountRouter)
  app.use('/api/schedule', scheduleRouter)
  app.use('/api/platforms', platformsRouter)

  // --- 静态文件：Web 管理面板 ---
  const webDistPath = path.resolve(__dirname, '../web/dist')
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(webDistPath, 'index.html'))
    })
  }

  // --- 根路径 ---
  app.get('/', (req, res) => {
    res.json({
      name: 'ZenoClaw',
      version: '0.2.0',
      description: '开源智能浏览器自动化引擎',
      docs: '/api',
      endpoints: {
        publish: 'POST /api/publish',
        stats: 'GET  /api/stats/:postId',
        analytics: 'GET  /api/analytics',
        interact: 'POST /api/interact',
        browse: 'POST /api/browse',
        account: 'POST /api/account/login',
        schedule: 'GET  /api/schedule',
      },
    })
  })

  // --- 错误处理 ---
  app.use((err, req, res, _next) => {
    log.error(`API Error: ${err.message}`)
    log.error(err.stack)
    res.status(err.status || 500).json({
      error: err.name || 'InternalError',
      message: err.message || '服务器内部错误',
    })
  })

  // --- 启动 ---
  const port = cfg('api.port', 3200)
  const host = cfg('api.host', '0.0.0.0')

  app.listen(port, host, () => {
    log.info('═══════════════════════════════════════')
    log.info('  🐾 ZenoClaw API Server')
    log.info(`  📡 http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
    log.info(`  📖 http://localhost:${port}/`)
    log.info('  🌐 https://zeno.babiku.xyz')
    log.info('═══════════════════════════════════════')
  })

  return app
}

startServer().catch(err => {
  console.error('❌ ZenoClaw API 启动失败:', err.message)
  process.exit(1)
})
