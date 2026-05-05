/**
 * POST /api/publish       — 提交发帖任务
 * GET  /api/publish       — 获取发帖任务列表
 * GET  /api/publish/:taskId — 获取任务状态
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getLogger } from '../../core/logger.js'
import { cfg } from '../../core/config.js'
import { getBrowser, closePage, disconnectBrowser, acquireBrowserLock } from '../../core/browser.js'
import { getContentProvider, getNotifier } from '../../plugins/manager.js'
import { JsonStore } from '../../core/store.js'

export const publishRouter = Router()

// 任务持久化存储（JSON 文件，重启后自动恢复）
const tasks = new JsonStore('./data/publish_tasks.json', { maxItems: 500 })

// POST /api/publish — 创建发帖任务
publishRouter.post('/', async (req, res) => {
  const log = getLogger()
  try {
    const {
      platform,
      title,
      content,
      images,
      tags,
      schedule_at,
      options,
      contentType,
      videoPath,
      coverPath,
      description,
      declareType,
      dryRun,
    } = req.body

    if (!platform) {
      return res.status(400).json({ error: 'BadRequest', message: '缺少 platform 参数' })
    }

    // 视频发布当前只允许 dryRun，防止 API 误触发真实发布
    const isVideo = contentType === 'video' || !!videoPath
    if (isVideo) {
      if (!videoPath) {
        return res.status(400).json({ error: 'BadRequest', message: '视频发布必须提供 videoPath' })
      }
      if (dryRun === false) {
        return res.status(400).json({ error: 'BadRequest', message: '视频发布当前仅支持 dryRun=true（禁止真实发布）' })
      }
    }

    const taskId = `task_${uuidv4().slice(0, 8)}`
    const task = {
      task_id: taskId,
      platform,
      title: title || '',
      content: content || '',
      images: images || [],
      tags: tags || [],
      schedule_at: schedule_at || null,
      options: options || {},
      contentType: isVideo ? 'video' : (contentType || 'article'),
      videoPath: videoPath || null,
      coverPath: coverPath || null,
      description: description || null,
      declareType: declareType || null,
      dryRun: isVideo ? true : !!dryRun,
      status: schedule_at ? 'scheduled' : 'queued',
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      result: null,
      error: null,
    }

    tasks.set(taskId, task)
    log.info(`[API] 发帖任务已创建: ${taskId} → ${platform}`)

    // 非定时任务立即执行
    if (!schedule_at) {
      executePublishTask(task).catch(err => {
        log.error(`[API] 任务执行失败: ${taskId} — ${err.message}`)
      })
    }

    res.status(201).json({
      task_id: taskId,
      status: task.status,
      message: schedule_at ? `已安排在 ${schedule_at} 执行` : '任务已加入队列',
    })
  } catch (err) {
    res.status(500).json({ error: 'InternalError', message: err.message })
  }
})

// GET /api/publish — 获取所有任务
publishRouter.get('/', (req, res) => {
  const { status, platform, limit } = req.query
  let list = tasks.values()
  if (status) list = list.filter(t => t.status === status)
  if (platform) list = list.filter(t => t.platform === platform)
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  if (limit) list = list.slice(0, parseInt(limit))
  res.json({ tasks: list, total: list.length })
})

// GET /api/publish/:taskId — 获取单个任务状态
publishRouter.get('/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId)
  if (!task) return res.status(404).json({ error: 'NotFound', message: '任务不存在' })
  res.json(task)
})

// --- 内部：执行发帖任务 ---
async function executePublishTask(task) {
  const log = getLogger()
  const notifier = getNotifier()
  let browser = null, page = null
  const release = await acquireBrowserLock()

  try {
    task.status = 'running'
    task.started_at = new Date().toISOString()
    tasks.set(task.task_id, task)
    await notifier.notify({ type: 'task_start', title: '开始发帖', message: `${task.platform}: ${task.title}` })

    const result = await getBrowser()
    browser = result.browser
    page = result.page

    // 动态加载平台适配器
    const AdapterClass = await loadAdapter(task.platform)
    const adapter = new AdapterClass(page)
    await adapter.init()

    const post = {
      title: task.title,
      content: task.content,
      images: task.images,
      tags: task.tags,
      ...task.options,
    }
    // 只有视频任务才强制改写 contentType/videoPath/dryRun，
    // 文章任务保持 options.dryRun 等历史行为不变
    if (task.contentType === 'video' || task.videoPath) {
      post.contentType = 'video'
      post.videoPath = task.videoPath
      post.coverPath = task.coverPath
      if (task.description) post.description = task.description
      if (task.declareType) post.declareType = task.declareType
      post.dryRun = true
    }

    const publishResult = await adapter.publish(post)

    if (publishResult.success) {
      task.status = 'success'
      task.result = publishResult
      tasks.set(task.task_id, task)
      await notifier.notify({ type: 'publish_success', title: '发帖成功', message: `${task.platform}: ${task.title}` })
    } else {
      task.status = 'failed'
      task.error = publishResult.message
      tasks.set(task.task_id, task)
      await notifier.notify({ type: 'publish_fail', title: '发帖失败', message: publishResult.message })
    }
  } catch (err) {
    task.status = 'failed'
    task.error = err.message
    log.error(`[PublishTask] ${task.task_id} 出错: ${err.message}`)
    await notifier.notify({ type: 'error', title: '发帖异常', message: err.message })
  } finally {
    task.completed_at = new Date().toISOString()
    tasks.set(task.task_id, task)
    await closePage(page)
    await disconnectBrowser(browser)
    release()
  }
}

// 动态平台适配器加载（自动发现 platforms/<name>/publisher.js）
async function loadAdapter(platform) {
  const { loadAdapter: load } = await import('../../platforms/loader.js')
  return load(platform)
}

// ============================================================
// 定时任务消费器（schedule_at）
// 每 30 秒扫描一次 scheduled 状态的任务，到期自动执行
// ============================================================
const SCHEDULE_POLL_INTERVAL = 30_000

let _schedulePollTimer = null

export function startScheduledTaskPoller() {
  if (_schedulePollTimer) return
  const log = getLogger()
  log.info('[SchedulePoller] 启动定时任务扫描器（间隔 30s）')

  _schedulePollTimer = setInterval(() => {
    pollScheduledTasks().catch(err => {
      log.error(`[SchedulePoller] 扫描失败: ${err.message}`)
    })
  }, SCHEDULE_POLL_INTERVAL)

  // 启动时立即扫描一次
  pollScheduledTasks().catch(() => {})
}

export function stopScheduledTaskPoller() {
  if (_schedulePollTimer) {
    clearInterval(_schedulePollTimer)
    _schedulePollTimer = null
  }
}

async function pollScheduledTasks() {
  const log = getLogger()
  const now = new Date()

  const scheduled = tasks.values().filter(t =>
    t.status === 'scheduled' && t.schedule_at
  )

  for (const task of scheduled) {
    const scheduledTime = new Date(task.schedule_at)
    if (isNaN(scheduledTime.getTime())) {
      log.warn(`[SchedulePoller] 任务 ${task.task_id} 的 schedule_at 格式无效: ${task.schedule_at}`)
      task.status = 'failed'
      task.error = `schedule_at 格式无效: ${task.schedule_at}`
      task.completed_at = now.toISOString()
      tasks.set(task.task_id, task)
      continue
    }

    if (scheduledTime <= now) {
      log.info(`[SchedulePoller] 定时任务到期，开始执行: ${task.task_id} (scheduled_at: ${task.schedule_at})`)
      task.status = 'queued'
      tasks.set(task.task_id, task)

      executePublishTask(task).catch(err => {
        log.error(`[SchedulePoller] 任务执行失败: ${task.task_id} — ${err.message}`)
      })
    }
  }
}
