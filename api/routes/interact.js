/**
 * POST /api/interact          — 执行互动操作（点赞/评论/收藏/关注/回复）
 * GET  /api/interact/history  — 获取互动历史
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { getLogger } from '../../core/logger.js'
import { safeReadJson, safeWriteJson } from '../../core/safe-json.js'
import { getBrowser, closePage, disconnectBrowser, acquireBrowserLock } from '../../core/browser.js'
import { randomDelay, humanClick, humanType, createHumanCursor } from '../../core/human.js'
import { getNotifier, getContentProvider } from '../../plugins/manager.js'
import { getPlatformMeta } from '../../platforms/loader.js'

export const interactRouter = Router()

const HISTORY_FILE = './data/interact_history.json'

function loadHistory() {
  return safeReadJson(HISTORY_FILE, [])
}

async function saveHistory(records) {
  await safeWriteJson(HISTORY_FILE, records)
}

// POST /api/interact — 执行互动
interactRouter.post('/', async (req, res) => {
  const log = getLogger()
  const { platform, action, target, content } = req.body

  if (!platform || !action) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少 platform 或 action 参数' })
  }

  const validActions = ['like', 'collect', 'comment', 'reply', 'follow', 'share']
  if (!validActions.includes(action)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: `无效的 action，可用: ${validActions.join(', ')}`,
    })
  }

  const taskId = `interact_${uuidv4().slice(0, 8)}`
  log.info(`[API] 互动任务: ${taskId} → ${platform}/${action}`)

  // 异步执行互动
  executeInteraction({ taskId, platform, action, target, content }).catch(err => {
    log.error(`[API] 互动失败: ${taskId} — ${err.message}`)
  })

  res.status(202).json({
    task_id: taskId,
    status: 'accepted',
    message: `互动任务已接受: ${action}`,
  })
})

// GET /api/interact/history — 互动历史
interactRouter.get('/history', (req, res) => {
  const { platform, action, limit } = req.query
  let history = loadHistory()
  if (platform) history = history.filter(h => h.platform === platform)
  if (action) history = history.filter(h => h.action === action)
  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  if (limit) history = history.slice(0, parseInt(limit))
  res.json({ history, total: history.length })
})

// --- 内部执行 ---
async function executeInteraction({ taskId, platform, action, target, content }) {
  const log = getLogger()
  const notifier = getNotifier()
  let browser = null, page = null
  const release = await acquireBrowserLock()

  try {
    const result = await getBrowser()
    browser = result.browser
    page = result.page
    const cursor = await createHumanCursor(page)

    // 如果需要生成回复内容
    let replyContent = content
    if ((action === 'reply' || action === 'comment') && !replyContent) {
      const provider = getContentProvider()
      replyContent = await provider.generateReply({
        platform,
        originalComment: target?.comment_text || '',
        tone: 'friendly',
      })
    }

    // 导航到目标页面
    if (target?.url) {
      await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 30000 })
      await randomDelay(2000, 4000)
    }

    // 根据 action 执行不同操作
    log.info(`[Interact] 执行 ${action} on ${platform}`)
    await performAction(page, cursor, { platform, action, target, content: replyContent, log })

    // 记录历史
    const record = {
      task_id: taskId,
      platform,
      action,
      target,
      content: replyContent,
      status: 'completed',
      timestamp: new Date().toISOString(),
    }
    const history = loadHistory()
    history.push(record)
    await saveHistory(history)

    await notifier.notify({
      type: 'task_complete',
      title: '互动完成',
      message: `${platform}/${action}: ${taskId}`,
    })
  } catch (err) {
    log.error(`[Interact] ${taskId} 出错: ${err.message}`)
    const history = loadHistory()
    history.push({
      task_id: taskId,
      platform,
      action,
      target,
      status: 'failed',
      error: err.message,
      timestamp: new Date().toISOString(),
    })
    await saveHistory(history)
  } finally {
    await closePage(page)
    await disconnectBrowser(browser)
    release()
  }
}

// ============================================================
// 平台交互选择器配置
// 通过 getPlatformMeta() 从平台适配器动态获取，不再硬编码
// ============================================================
const DEFAULT_INTERACT_SELECTORS = {
  like: ['[class*="like"]', '[aria-label*="like"]', 'button[class*="zan"]'],
  collect: ['[class*="collect"]', '[class*="fav"]', '[class*="bookmark"]'],
  comment_input: ['textarea[class*="comment"]', 'textarea[placeholder*="评论"]', '.comment-input textarea'],
  comment_submit: ['button[type="submit"]'],
  follow: ['button[class*="follow"]'],
}

/**
 * 获取平台的互动选择器（从适配器动态加载，回退到通用默认值）
 */
async function getSelectorsForPlatform(platform) {
  const meta = await getPlatformMeta(platform)
  return meta.interactSelectors || DEFAULT_INTERACT_SELECTORS
}

/**
 * 尝试在页面上查找并点击匹配的元素
 * @returns {boolean} 是否找到并点击成功
 */
async function tryClickSelector(page, cursor, selectors, log) {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector)
      if (el) {
        const box = await el.boundingBox()
        if (box) {
          await humanClick(cursor, selector, page)
          log.info(`[Interact] 点击成功: ${selector}`)
          return true
        }
      }
    } catch {
      // selector 不匹配，继续尝试下一个
    }
  }
  return false
}

/**
 * 通过文本内容查找并点击元素（替代 Puppeteer 不支持的 :has-text()）
 * @param {Page} page
 * @param {string} tag - HTML 标签名
 * @param {string[]} texts - 要匹配的文本列表（按优先级）
 * @param {Logger} log
 * @returns {boolean}
 */
async function tryClickByText(page, tag, texts, log) {
  const elements = await page.$$(tag)
  for (const text of texts) {
    for (const el of elements) {
      try {
        const content = await el.evaluate(node => node.textContent.trim())
        if (content.includes(text)) {
          await el.click()
          log.info(`[Interact] 文本匹配点击: <${tag}>"${text}"`)
          return true
        }
      } catch { /* continue */ }
    }
  }
  return false
}

/**
 * 执行真实的浏览器互动操作
 */
async function performAction(page, cursor, { platform, action, target, content, log }) {
  const selectors = await getSelectorsForPlatform(platform)

  switch (action) {
    case 'like': {
      const clicked = await tryClickSelector(page, cursor, selectors.like, log)
      if (!clicked) {
        throw new Error(`[${platform}] 未找到点赞按钮，可能页面结构已变更`)
      }
      await randomDelay(1000, 2000)
      break
    }

    case 'collect': {
      const clicked = await tryClickSelector(page, cursor, selectors.collect, log)
      if (!clicked) {
        throw new Error(`[${platform}] 未找到收藏按钮，可能页面结构已变更`)
      }
      await randomDelay(1000, 2000)
      break
    }

    case 'comment':
    case 'reply': {
      if (!content) {
        throw new Error('评论/回复内容为空')
      }
      // 找到评论输入框
      let inputFound = false
      for (const selector of selectors.comment_input) {
        try {
          const el = await page.$(selector)
          if (el) {
            await humanClick(cursor, selector, page)
            await randomDelay(500, 1000)
            await humanType(page, selector, content, cursor)
            inputFound = true
            break
          }
        } catch { /* continue */ }
      }
      if (!inputFound) {
        throw new Error(`[${platform}] 未找到评论输入框`)
      }

      await randomDelay(1000, 2000)

      // 点击发送按钮
      let submitted = await tryClickSelector(page, cursor, selectors.comment_submit, log)
      if (!submitted) {
        // 文本匹配 fallback（替代 :has-text()）
        submitted = await tryClickByText(page, 'button', ['发送', '发布'], log)
      }
      if (!submitted) {
        // fallback: 按 Enter 提交
        await page.keyboard.press('Enter')
        log.info('[Interact] 使用 Enter 键提交评论')
      }
      await randomDelay(2000, 4000)
      break
    }

    case 'follow': {
      let clicked = await tryClickSelector(page, cursor, selectors.follow, log)
      if (!clicked) {
        // 文本匹配 fallback（替代 :has-text()）
        clicked = await tryClickByText(page, 'button', ['关注', '+关注'], log)
      }
      if (!clicked) {
        throw new Error(`[${platform}] 未找到关注按钮，可能页面结构已变更`)
      }
      await randomDelay(1000, 2000)
      break
    }

    case 'share': {
      // 分享通常有多种方式，这里先做基础实现
      log.info(`[Interact] 分享操作暂不支持浏览器自动化，已记录`)
      break
    }

    default:
      throw new Error(`未知的互动操作: ${action}`)
  }
}
