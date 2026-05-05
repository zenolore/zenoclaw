/**
 * GET    /api/schedule          — 获取所有定时任务
 * POST   /api/schedule          — 创建定时任务
 * DELETE /api/schedule/:id      — 删除定时任务
 * PATCH  /api/schedule/:id      — 启用/禁用定时任务
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import cron from 'node-cron'
import { getLogger } from '../../core/logger.js'
import { cfg } from '../../core/config.js'
import { safeReadJson, safeWriteJson } from '../../core/safe-json.js'

export const scheduleRouter = Router()

const SCHEDULE_FILE = './data/schedules.json'
const activeJobs = new Map()

function loadSchedules() {
  return safeReadJson(SCHEDULE_FILE, [])
}

async function saveSchedules(schedules) {
  await safeWriteJson(SCHEDULE_FILE, schedules)
}

// GET /api/schedule — 获取所有定时任务
scheduleRouter.get('/', (req, res) => {
  const schedules = loadSchedules()
  res.json({
    schedules: schedules.map(s => ({
      ...s,
      is_running: activeJobs.has(s.id),
    })),
    total: schedules.length,
  })
})

// POST /api/schedule — 创建定时任务
scheduleRouter.post('/', async (req, res) => {
  const log = getLogger()
  const { name, type, platform, cron_expression, task_config, enabled } = req.body

  if (!cron_expression || !platform) {
    return res.status(400).json({
      error: 'BadRequest',
      message: '缺少 cron_expression 或 platform 参数',
    })
  }

  if (!cron.validate(cron_expression)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: `无效的 cron 表达式: ${cron_expression}`,
    })
  }

  const validTypes = ['publish', 'collect_stats', 'browse', 'interact']
  const taskType = type || 'publish'
  if (!validTypes.includes(taskType)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: `无效的任务类型，可用: ${validTypes.join(', ')}`,
    })
  }

  const schedule = {
    id: `sched_${uuidv4().slice(0, 8)}`,
    name: name || `${platform}_${taskType}`,
    type: taskType,
    platform,
    cron_expression,
    task_config: task_config || {},
    enabled: enabled !== false,
    created_at: new Date().toISOString(),
    last_run: null,
    next_run: null,
    run_count: 0,
  }

  const schedules = loadSchedules()
  schedules.push(schedule)
  await saveSchedules(schedules)

  if (schedule.enabled) {
    startCronJob(schedule)
  }

  log.info(`[API] 定时任务已创建: ${schedule.id} — ${cron_expression}`)
  res.status(201).json(schedule)
})

// DELETE /api/schedule/:id — 删除定时任务
scheduleRouter.delete('/:id', async (req, res) => {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'NotFound', message: '定时任务不存在' })

  // 停止 cron job
  const job = activeJobs.get(req.params.id)
  if (job) {
    job.stop()
    activeJobs.delete(req.params.id)
  }

  schedules.splice(idx, 1)
  await saveSchedules(schedules)
  res.json({ message: '已删除' })
})

// PATCH /api/schedule/:id — 启用/禁用定时任务
scheduleRouter.patch('/:id', async (req, res) => {
  const log = getLogger()
  const schedules = loadSchedules()
  const schedule = schedules.find(s => s.id === req.params.id)
  if (!schedule) return res.status(404).json({ error: 'NotFound', message: '定时任务不存在' })

  if (req.body.enabled !== undefined) {
    schedule.enabled = req.body.enabled
    if (schedule.enabled) {
      startCronJob(schedule)
      log.info(`[Schedule] 启用: ${schedule.id}`)
    } else {
      const job = activeJobs.get(schedule.id)
      if (job) { job.stop(); activeJobs.delete(schedule.id) }
      log.info(`[Schedule] 禁用: ${schedule.id}`)
    }
  }

  if (req.body.cron_expression) {
    if (!cron.validate(req.body.cron_expression)) {
      return res.status(400).json({ error: 'BadRequest', message: '无效的 cron 表达式' })
    }
    schedule.cron_expression = req.body.cron_expression
    // 重启 job
    const job = activeJobs.get(schedule.id)
    if (job) { job.stop(); activeJobs.delete(schedule.id) }
    if (schedule.enabled) startCronJob(schedule)
  }

  if (req.body.name) schedule.name = req.body.name
  if (req.body.task_config) schedule.task_config = { ...schedule.task_config, ...req.body.task_config }

  await saveSchedules(schedules)
  res.json({ ...schedule, is_running: activeJobs.has(schedule.id) })
})

// --- 内部：启动 cron job ---
function startCronJob(schedule) {
  const log = getLogger()
  if (activeJobs.has(schedule.id)) {
    activeJobs.get(schedule.id).stop()
  }

  const job = cron.schedule(schedule.cron_expression, async () => {
    log.info(`[Schedule] 触发: ${schedule.id} — ${schedule.name}`)
    schedule.last_run = new Date().toISOString()
    schedule.run_count = (schedule.run_count || 0) + 1

    // 更新持久化
    const schedules = loadSchedules()
    const s = schedules.find(x => x.id === schedule.id)
    if (s) {
      s.last_run = schedule.last_run
      s.run_count = schedule.run_count
      await saveSchedules(schedules)
    }

    // 根据类型触发对应内部 API
    try {
      await executeScheduledTask(schedule, log)
    } catch (execErr) {
      log.error(`[Schedule] 任务执行失败 ${schedule.id}: ${execErr.message}`)
    }
  })

  activeJobs.set(schedule.id, job)
}

/**
 * 根据定时任务类型，调用本地 API 执行实际操作
 */
async function executeScheduledTask(schedule, log) {
  const port = cfg('api.port', 3200)
  const apiKey = cfg('api.key', '')
  const baseUrl = `http://127.0.0.1:${port}/api`
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
  }

  const taskConfig = schedule.task_config || {}
  const platform = schedule.platform

  const TYPE_ROUTES = {
    publish: {
      url: `${baseUrl}/publish`,
      body: { platform, ...taskConfig },
    },
    collect_stats: {
      url: `${baseUrl}/stats/collect`,
      body: { platform, post_ids: taskConfig.post_ids || [] },
    },
    browse: {
      url: `${baseUrl}/browse`,
      body: {
        platform,
        action: taskConfig.action || 'feed_browse',
        strategy: taskConfig.strategy || {},
      },
    },
    interact: {
      url: `${baseUrl}/interact`,
      body: {
        platform,
        action: taskConfig.action || 'like',
        target: taskConfig.target || {},
        content: taskConfig.content || null,
      },
    },
  }

  const route = TYPE_ROUTES[schedule.type]
  if (!route) {
    log.warn(`[Schedule] 未知任务类型: ${schedule.type}，跳过执行`)
    return
  }

  log.info(`[Schedule] 执行 ${schedule.type} → POST ${route.url}`)
  const resp = await fetch(route.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(route.body),
  })

  if (!resp.ok) {
    const errBody = await resp.text()
    throw new Error(`HTTP ${resp.status}: ${errBody}`)
  }

  const result = await resp.json()
  log.info(`[Schedule] ${schedule.id} 执行完成: ${JSON.stringify(result).slice(0, 200)}`)
}

// 启动时恢复已有的定时任务
export function restoreSchedules() {
  const log = getLogger()
  const schedules = loadSchedules()
  let restored = 0
  for (const schedule of schedules) {
    if (schedule.enabled) {
      startCronJob(schedule)
      restored++
    }
  }
  if (restored > 0) {
    log.info(`[Schedule] 已恢复 ${restored} 个定时任务`)
  }
}
