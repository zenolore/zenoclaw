/**
 * GET  /api/stats              — 获取所有帖子数据概览
 * GET  /api/stats/:postId      — 获取单个帖子的数据快照
 * POST /api/stats/collect      — 手动触发数据采集
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { getLogger } from '../../core/logger.js'
import { cfg } from '../../core/config.js'
import { getBrowser, closePage, disconnectBrowser, acquireBrowserLock } from '../../core/browser.js'
import { safeReadJson, safeWriteJson } from '../../core/safe-json.js'

export const statsRouter = Router()

const STATS_DIR = () => path.resolve(cfg('plugins.stats_dir', './data/stats'))

function ensureStatsDir() {
  const dir = STATS_DIR()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function loadAllStats() {
  const dir = ensureStatsDir()
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  const all = []
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
      if (Array.isArray(data)) all.push(...data)
      else all.push(data)
    } catch { /* skip */ }
  }
  return all
}

async function saveSnapshot(postId, snapshot) {
  const dir = ensureStatsDir()
  const file = path.join(dir, `${postId}.json`)
  let existing = safeReadJson(file, [])
  if (!Array.isArray(existing)) existing = [existing]
  existing.push({ ...snapshot, timestamp: new Date().toISOString() })
  await safeWriteJson(file, existing)
}

// GET /api/stats — 所有帖子数据概览
statsRouter.get('/', (req, res) => {
  try {
    const { platform } = req.query
    let stats = loadAllStats()
    if (platform) stats = stats.filter(s => s.platform === platform)

    // 按 post_id 分组，取最新快照
    const grouped = {}
    for (const s of stats) {
      const id = s.post_id || s.id
      if (!id) continue
      if (!grouped[id] || new Date(s.timestamp) > new Date(grouped[id].timestamp)) {
        grouped[id] = s
      }
    }

    res.json({
      posts: Object.values(grouped),
      total: Object.keys(grouped).length,
    })
  } catch (err) {
    res.status(500).json({ error: 'InternalError', message: err.message })
  }
})

// GET /api/stats/:postId — 单个帖子的全部数据快照
statsRouter.get('/:postId', (req, res) => {
  try {
    const dir = ensureStatsDir()
    const file = path.join(dir, `${req.params.postId}.json`)
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: 'NotFound', message: '未找到该帖子的数据' })
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    const snapshots = Array.isArray(data) ? data : [data]
    res.json({
      post_id: req.params.postId,
      snapshots,
      total_snapshots: snapshots.length,
    })
  } catch (err) {
    res.status(500).json({ error: 'InternalError', message: err.message })
  }
})

// POST /api/stats/collect — 手动触发数据采集
statsRouter.post('/collect', async (req, res) => {
  const log = getLogger()
  const { platform, post_ids } = req.body

  if (!platform) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少 platform 参数' })
  }

  let browser = null, page = null
  const release = await acquireBrowserLock()
  try {
    log.info(`[API] 手动触发数据采集: ${platform}`)
    const result = await getBrowser()
    browser = result.browser
    page = result.page

    // 动态加载读取器
    const ReaderClass = await loadReader(platform)
    const reader = new ReaderClass(page)
    await reader.init()

    let collected = []
    if (post_ids && Array.isArray(post_ids) && post_ids.length > 0) {
      // 逐个采集指定帖子
      for (const pid of post_ids) {
        try {
          const stats = await reader.readPostStats({ post_url: pid, title: pid })
          if (stats) collected.push({ post_id: pid, ...stats })
        } catch (e) {
          log.warn(`[API] 采集 ${pid} 失败: ${e.message}`)
        }
      }
    } else {
      // 批量采集所有帖子
      const all = await reader.readAllPostStats()
      collected = (all || []).map(item => ({
        post_id: item.title || 'unknown',
        ...item,
      }))
    }

    // 保存快照
    for (const item of collected) {
      await saveSnapshot(item.post_id || item.id || item.title, { ...item, platform })
    }

    log.info(`[API] 数据采集完成，共 ${collected.length} 条`)
    res.json({ collected: collected.length, data: collected })
  } catch (err) {
    log.error(`[API] 数据采集失败: ${err.message}`)
    res.status(500).json({ error: 'CollectError', message: err.message })
  } finally {
    await closePage(page)
    await disconnectBrowser(browser)
    release()
  }
})

// 动态平台读取器加载（自动发现 platforms/<name>/reader.js）
async function loadReader(platform) {
  const { loadReader: load } = await import('../../platforms/loader.js')
  return load(platform)
}
