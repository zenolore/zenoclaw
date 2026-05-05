/**
 * POST /api/browse          — 执行浏览/养号任务
 * GET  /api/browse/history  — 获取浏览历史
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { getLogger } from '../../core/logger.js'
import { safeReadJson, safeWriteJson } from '../../core/safe-json.js'
import { getBrowser, closePage, disconnectBrowser, acquireBrowserLock } from '../../core/browser.js'
import { simulateBrowsing, randomDelay, createHumanCursor, humanScroll, gaussianRandom } from '../../core/human.js'
import { getNotifier } from '../../plugins/manager.js'
import { getPlatformMeta, loadBrowser as loadBrowseAdapter, loadAdapter } from '../../platforms/loader.js'

export const browseRouter = Router()

// 活跃任务
const activeTasks = new Map()
const HISTORY_FILE = './data/browse_history.json'

function loadHistory() {
  return safeReadJson(HISTORY_FILE, [])
}

async function saveHistory(records) {
  await safeWriteJson(HISTORY_FILE, records)
}

// POST /api/browse — 开始浏览/养号
browseRouter.post('/', async (req, res) => {
  const log = getLogger()
  const { platform, action, strategy } = req.body

  if (!platform) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少 platform 参数' })
  }

  const taskId = `browse_${uuidv4().slice(0, 8)}`
  const task = {
    task_id: taskId,
    platform,
    action: action || 'nurture',
    strategy: strategy || {},
    status: 'running',
    started_at: new Date().toISOString(),
    completed_at: null,
  }
  activeTasks.set(taskId, task)

  log.info(`[API] 浏览任务已创建: ${taskId} → ${platform}/${task.action}`)

  executeBrowseTask(task).catch(err => {
    log.error(`[API] 浏览任务失败: ${taskId} — ${err.message}`)
  })

  res.status(202).json({
    task_id: taskId,
    status: 'running',
    message: `浏览任务已启动: ${task.action}`,
  })
})

// GET /api/browse/history — 浏览历史
browseRouter.get('/history', (req, res) => {
  const { platform, limit } = req.query
  let history = loadHistory()
  if (platform) history = history.filter(h => h.platform === platform)
  history.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
  if (limit) history = history.slice(0, parseInt(limit))
  res.json({ history, total: history.length })
})

// GET /api/browse/active — 当前活跃的浏览任务
browseRouter.get('/active', (req, res) => {
  const active = Array.from(activeTasks.values()).filter(t => t.status === 'running')
  res.json({ tasks: active, total: active.length })
})

// --- 内部执行 ---
async function executeBrowseTask(task) {
  const log = getLogger()
  const notifier = getNotifier()
  let browser = null, page = null
  const release = await acquireBrowserLock()

  try {
    const result = await getBrowser()
    browser = result.browser
    page = result.page

    const strategy = task.strategy
    const durationMin = strategy.duration_min || 600   // 默认 10 分钟
    const durationMax = strategy.duration_max || 1800  // 默认 30 分钟

    // 从平台适配器获取首页 URL（解耦硬编码）
    const meta = await getPlatformMeta(task.platform)
    const startUrl = strategy.start_url || meta.homeUrl || `https://www.${task.platform}.com`

    // 计算浏览时长
    const durationSec = Math.floor(gaussianRandom(durationMin, durationMax))
    const durationMs = durationSec * 1000
    log.info(`[Browse] 计划浏览 ${Math.round(durationSec / 60)} 分钟`)

    // 优先加载平台专用 browse runner，降级到通用 simulateBrowsing
    let usedPlatformRunner = false
    try {
      const BrowseClass = await loadBrowseAdapter(task.platform)
      const runner = new BrowseClass(page)
      await runner.init()
      if (typeof runner.browse === 'function') {
        log.info(`[Browse] 使用 ${task.platform} 专用 browse runner`)
        await runner.browse({ durationMs })
        usedPlatformRunner = true
      }
    } catch {
      // 平台无专用 browse.js，降级
    }

    if (!usedPlatformRunner) {
      log.info(`[Browse] 使用通用 simulateBrowsing: ${startUrl}`)
      await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      await randomDelay(3000, 6000)
      const cursor = await createHumanCursor(page)
      await simulateBrowsing(page, cursor, durationMs)
    }

    task.status = 'completed'
    task.completed_at = new Date().toISOString()

    await notifier.notify({
      type: 'task_complete',
      title: '浏览任务完成',
      message: `${task.platform}/${task.action}: ${Math.round(durationSec / 60)} 分钟`,
    })
  } catch (err) {
    task.status = 'failed'
    task.error = err.message
    task.completed_at = new Date().toISOString()
    log.error(`[Browse] ${task.task_id} 出错: ${err.message}`)
  } finally {
    // 保存历史
    const history = loadHistory()
    history.push({ ...task })
    await saveHistory(history)

    activeTasks.delete(task.task_id)
    await closePage(page)
    await disconnectBrowser(browser)
    release()
  }
}
