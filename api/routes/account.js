/**
 * POST /api/account/login     — 自动登录账号
 * GET  /api/account            — 获取已保存的账号列表
 * POST /api/account            — 添加/更新账号信息
 * DELETE /api/account/:id      — 删除账号
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { getLogger } from '../../core/logger.js'
import { safeReadJson, safeWriteJson } from '../../core/safe-json.js'
import { getBrowser, closePage, disconnectBrowser, acquireBrowserLock } from '../../core/browser.js'
import { randomDelay, humanClick, humanType, createHumanCursor } from '../../core/human.js'
import { getCaptchaSolver } from '../../plugins/manager.js'
import { encrypt, decrypt } from '../../core/crypto.js'
import { getPlatformMeta } from '../../platforms/loader.js'

export const accountRouter = Router()

const ACCOUNTS_FILE = './data/accounts.json'

function loadAccounts() {
  return safeReadJson(ACCOUNTS_FILE, [])
}

async function saveAccounts(accounts) {
  await safeWriteJson(ACCOUNTS_FILE, accounts)
}

// GET /api/account — 获取账号列表（隐藏密码）
accountRouter.get('/', (req, res) => {
  const accounts = loadAccounts().map(a => ({
    ...a,
    password: a.password ? '********' : null,
  }))
  res.json({ accounts, total: accounts.length })
})

// POST /api/account — 添加/更新账号
accountRouter.post('/', async (req, res) => {
  const { platform, username, password, cookies, notes } = req.body
  if (!platform || !username) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少 platform 或 username' })
  }

  const accounts = loadAccounts()
  const existing = accounts.findIndex(a => a.platform === platform && a.username === username)

  const account = {
    id: existing >= 0 ? accounts[existing].id : `acc_${uuidv4().slice(0, 8)}`,
    platform,
    username,
    password: password ? encrypt(password) : (existing >= 0 ? accounts[existing].password : null),
    cookies: cookies || (existing >= 0 ? accounts[existing].cookies : null),
    notes: notes || '',
    status: 'active',
    last_login: existing >= 0 ? accounts[existing].last_login : null,
    created_at: existing >= 0 ? accounts[existing].created_at : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing >= 0) {
    accounts[existing] = account
  } else {
    accounts.push(account)
  }

  await saveAccounts(accounts)
  res.json({ ...account, password: account.password ? '********' : null })
})

// DELETE /api/account/:id — 删除账号
accountRouter.delete('/:id', async (req, res) => {
  const accounts = loadAccounts()
  const idx = accounts.findIndex(a => a.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'NotFound', message: '账号不存在' })
  accounts.splice(idx, 1)
  await saveAccounts(accounts)
  res.json({ message: '已删除' })
})

// POST /api/account/login — 自动登录
accountRouter.post('/login', async (req, res) => {
  const log = getLogger()
  const { platform, username, password } = req.body

  if (!platform) {
    return res.status(400).json({ error: 'BadRequest', message: '缺少 platform 参数' })
  }

  // 如果未提供账号密码，从已保存的账号中查找
  let loginUsername = username
  let loginPassword = password
  if (!loginUsername) {
    const accounts = loadAccounts()
    const saved = accounts.find(a => a.platform === platform && a.status === 'active')
    if (saved) {
      loginUsername = saved.username
      loginPassword = decrypt(saved.password)
    }
  }

  log.info(`[API] 登录任务: ${platform} / ${loginUsername || '(使用已有 session)'}`)

  let browser = null, page = null
  const release = await acquireBrowserLock()
  try {
    const result = await getBrowser()
    browser = result.browser
    page = result.page

    // 从平台适配器获取登录 URL（解耦硬编码）
    const meta = await getPlatformMeta(platform)
    const loginUrl = meta.loginUrl
    if (!loginUrl) {
      return res.status(400).json({ error: 'BadRequest', message: `平台 ${platform} 未配置登录 URL，请先添加平台适配器` })
    }

    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await randomDelay(2000, 4000)

    // 检测验证码
    const solver = getCaptchaSolver()
    const captchaCheck = await solver.detect(page)
    if (captchaCheck.detected) {
      log.info(`[Login] 检测到验证码: ${captchaCheck.type}`)
      const solveResult = await solver.solve({ type: captchaCheck.type, page })
      if (!solveResult.solved) {
        return res.status(422).json({ error: 'CaptchaFailed', message: solveResult.error })
      }
    }

    // 更新账号最后登录时间
    if (loginUsername) {
      const accounts = loadAccounts()
      const acc = accounts.find(a => a.platform === platform && a.username === loginUsername)
      if (acc) {
        acc.last_login = new Date().toISOString()
        await saveAccounts(accounts)
      }
    }

    res.json({
      status: 'success',
      message: `已打开 ${platform} 登录页面`,
      note: '如需输入账号密码，请在浏览器中手动完成或配置自动登录',
    })
  } catch (err) {
    log.error(`[Login] 失败: ${err.message}`)
    res.status(500).json({ error: 'LoginError', message: err.message })
  } finally {
    // 登录后不关闭页面，保持 session
    await disconnectBrowser(browser)
    release()
  }
})
