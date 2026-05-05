import { createCursor } from 'ghost-cursor'
import { getLogger } from './logger.js'
import { cfg } from './config.js'
import { simulateIMEText, containsChinese } from './ime-simulator.js'
import { persona, p as personaParam, modulateMean, modulateRange, shouldDo } from './persona.js'

/**
 * 人类行为模拟工具库
 *
 * 所有操作通过 CDP 协议在浏览器内部执行，不影响物理鼠标和键盘。
 * 所有参数从 config.yaml 读取，不硬编码。
 *
 * 配置节对应关系:
 *   鼠标行为  → config.mouse.*
 *   键盘行为  → config.keyboard.*
 *   滚动行为  → config.scroll.*
 *   浏览模拟  → config.browse.*
 *   操作间隔  → config.timing.*
 *   文件上传  → config.upload.*
 */

// ============================================================
// 工具函数
// ============================================================

/**
 * 高斯分布随机数（中间值概率高，更接近真人）
 */
export function gaussianRandom(min, max) {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  num = num / 6 + 0.5
  num = Math.max(0, Math.min(1, num))
  return min + num * (max - min)
}

/**
 * 随机延迟（高斯分布）
 */
export function randomDelay(minMs, maxMs) {
  return new Promise(resolve => {
    const delay = Math.floor(gaussianRandom(minMs, maxMs))
    setTimeout(resolve, delay)
  })
}

/**
 * 固定延迟
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================
// 鼠标模拟 — 读取 config.mouse.*
// ============================================================

/**
 * 创建 ghost-cursor 实例
 */
export async function createHumanCursor(page) {
  const startPoint = await getRandomStartPoint(page)
  return createCursor(page, startPoint)
}

async function getRandomStartPoint(page) {
  const viewport = await page.viewport()
  if (!viewport) return undefined
  const margin = cfg('mouse.move_area_margin', 0.1)
  return {
    x: Math.floor(Math.random() * viewport.width * (1 - 2 * margin) + viewport.width * margin),
    y: Math.floor(Math.random() * viewport.height * (1 - 2 * margin) + viewport.height * margin)
  }
}

/**
 * 模拟真人点击
 *
 * 配置项:
 *   mouse.click_offset_percent — 点击位置随机偏移百分比
 *   mouse.click_wait_min/max  — 到达目标后按下前的等待
 *   browser.element_timeout    — 等待元素出现的超时
 */
export async function humanClick(cursor, selector, page) {
  const log = getLogger()
  log.debug(`点击元素: ${selector}`)

  const elementTimeout = cfg('browser.element_timeout', 30000)
  const clickOffset    = cfg('mouse.click_offset_percent', 10)
  const clickWaitMin   = cfg('mouse.click_wait_min', 50)
  const clickWaitMax   = cfg('mouse.click_wait_max', 200)

  try {
    await page.waitForSelector(selector, { visible: true, timeout: elementTimeout })
    await cursor.click(selector, {
      paddingPercentage: clickOffset,
      waitForClick: Math.floor(gaussianRandom(clickWaitMin, clickWaitMax))
    })
    log.debug(`点击完成: ${selector}`)
  } catch (err) {
    log.error(`点击失败 [${selector}]: ${err.message}`)
    throw err
  }
}

/**
 * 鼠标移动到某个元素（不点击）
 *
 * 配置项:
 *   mouse.move_offset_percent — 移动目标偏移百分比
 *   browser.element_timeout   — 超时
 */
export async function humanMove(cursor, selector, page) {
  const log = getLogger()
  log.debug(`移动到元素: ${selector}`)

  const elementTimeout = cfg('browser.element_timeout', 30000)
  const moveOffset     = cfg('mouse.move_offset_percent', 15)

  await page.waitForSelector(selector, { visible: true, timeout: elementTimeout })
  await cursor.move(selector, {
    paddingPercentage: moveOffset
  })
}

/**
 * 鼠标在页面上随机移动
 *
 * 配置项:
 *   mouse.move_area_margin — 安全边距
 */
export async function humanRandomMove(cursor, page) {
  if (!cursor) return
  const viewport = page.viewport()
  if (!viewport) return

  const margin = cfg('mouse.move_area_margin', 0.1)
  const x = Math.floor(Math.random() * viewport.width * (1 - 2 * margin) + viewport.width * margin)
  const y = Math.floor(Math.random() * viewport.height * (1 - 2 * margin) + viewport.height * margin)

  const moveSpeed = cfg('mouse.move_speed', 1.0)
  await cursor.moveTo({ x, y }, { moveSpeed })
}

// ============================================================
// 键盘模拟 — 读取 config.keyboard.*
// ============================================================

/**
 * 生成一个随机的「错误字符」用于打错字模拟
 */
function getRandomTypoChar(originalChar) {
  const nearby = {
    'a': 'sqwz', 'b': 'vngh', 'c': 'xvdf', 'd': 'sfec', 'e': 'wrd',
    'f': 'dgrc', 'g': 'fhtv', 'h': 'gjyn', 'i': 'uok', 'j': 'hkun',
    'k': 'jloi', 'l': 'kop', 'm': 'njk', 'n': 'bmhj', 'o': 'iplk',
    'p': 'ol', 'q': 'wa', 'r': 'etf', 's': 'adwx', 't': 'ryg',
    'u': 'yij', 'v': 'cbfg', 'w': 'qeas', 'x': 'zsdc', 'y': 'tuh',
    'z': 'xas'
  }
  const lower = originalChar.toLowerCase()
  const candidates = nearby[lower] || 'abcdefghijklmnopqrstuvwxyz'
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/**
 * 模拟真人打字
 *
 * 配置项:
 *   keyboard.delay_min/max            — 字符间延迟
 *   keyboard.pause_chance             — 思考暂停概率
 *   keyboard.pause_min/max            — 思考暂停时间
 *   keyboard.look_interval_min/max    — 看屏幕间隔
 *   keyboard.look_delay_min/max       — 看屏幕停顿
 *   keyboard.enter_delay_factor       — 回车延迟倍数
 *   keyboard.pre_type_delay_min/max   — 打字前等待
 *   keyboard.typo_enabled             — 是否启用打错字
 *   keyboard.typo_chance              — 打错字概率
 *   keyboard.typo_correct_delay_min/max — 发现打错后等待
 *   keyboard.typo_backspace_delay_min/max — 退格延迟
 *   browser.element_timeout           — 元素等待超时
 */
export async function humanType(page, selector, text, cursor = null) {
  const log = getLogger()

  const delayMin          = cfg('keyboard.delay_min', 100)
  const delayMax          = cfg('keyboard.delay_max', 300)
  const pauseChance       = cfg('keyboard.pause_chance', 0.1)
  const pauseMin          = cfg('keyboard.pause_min', 2000)
  const pauseMax          = cfg('keyboard.pause_max', 5000)
  const lookIntervalMin   = cfg('keyboard.look_interval_min', 10)
  const lookIntervalMax   = cfg('keyboard.look_interval_max', 20)
  const lookDelayMin      = cfg('keyboard.look_delay_min', 500)
  const lookDelayMax      = cfg('keyboard.look_delay_max', 1500)
  const enterFactor       = cfg('keyboard.enter_delay_factor', 2.0)
  const preTypeDelayMin   = cfg('keyboard.pre_type_delay_min', 300)
  const preTypeDelayMax   = cfg('keyboard.pre_type_delay_max', 800)
  const typoEnabled       = cfg('keyboard.typo_enabled', false)
  const typoChance        = cfg('keyboard.typo_chance', 0.02)
  const typoCorrectMin   = cfg('keyboard.typo_correct_delay_min', 300)
  const typoCorrectMax   = cfg('keyboard.typo_correct_delay_max', 1000)
  const typoBackspaceMin = cfg('keyboard.typo_backspace_delay_min', 50)
  const typoBackspaceMax = cfg('keyboard.typo_backspace_delay_max', 150)
  const elementTimeout    = cfg('browser.element_timeout', 30000)

  log.info(`开始输入文字（${text.length} 个字符）`)

  // 先用 cursor 移动鼠标到目标再点击（保证鼠标位置和键盘焦点同步）
  // 无 cursor 时 fallback 到 page.click
  await page.waitForSelector(selector, { visible: true, timeout: elementTimeout })
  if (cursor) {
    const clickOffset  = cfg('mouse.click_offset_percent', 10)
    const clickWaitMin = cfg('mouse.click_wait_min', 50)
    const clickWaitMax = cfg('mouse.click_wait_max', 200)
    await cursor.click(selector, {
      paddingPercentage: clickOffset,
      waitForClick: Math.floor(gaussianRandom(clickWaitMin, clickWaitMax))
    })
  } else {
    await page.click(selector)
  }
  await randomDelay(preTypeDelayMin, preTypeDelayMax)

  let nextLookAt = Math.floor(gaussianRandom(lookIntervalMin, lookIntervalMax))

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    // 换行符
    if (char === '\n') {
      await page.keyboard.press('Enter')
      await randomDelay(delayMin * enterFactor, delayMax * enterFactor)
      continue
    }

    // 打错字模拟
    if (typoEnabled && Math.random() < typoChance) {
      const typoChar = getRandomTypoChar(char)
      await page.keyboard.type(typoChar)
      await randomDelay(delayMin, delayMax)
      // 「发现」打错了
      await randomDelay(typoCorrectMin, typoCorrectMax)
      await page.keyboard.press('Backspace')
      await randomDelay(typoBackspaceMin, typoBackspaceMax)
      log.debug(`打错字 '${typoChar}' → 已更正`)
    }

    // 输入正确字符
    await page.keyboard.type(char)
    await randomDelay(delayMin, delayMax)

    // 思考暂停
    if (Math.random() < pauseChance) {
      const pauseTime = Math.floor(gaussianRandom(pauseMin, pauseMax))
      log.debug(`打字暂停 ${(pauseTime / 1000).toFixed(1)}s（模拟思考）`)
      await sleep(pauseTime)
    }

    // 看屏幕停顿
    if (i > 0 && i >= nextLookAt) {
      await randomDelay(lookDelayMin, lookDelayMax)
      nextLookAt = i + Math.floor(gaussianRandom(lookIntervalMin, lookIntervalMax))
    }
  }

  log.info('文字输入完成')
}

/**
 * 剪贴板粘贴输入（用于 contenteditable 富文本编辑器的备选方案）
 *
 * 某些富文本编辑器（React/Vue 驱动）不响应逐字 keyboard.type()，
 * 此方法通过剪贴板粘贴 + 模拟人工节奏来输入内容。
 *
 * 策略：将文本按段落拆分，每段通过剪贴板粘贴，段间模拟停顿。
 *
 * @param {Page} page - Puppeteer page
 * @param {string} selector - 目标元素选择器
 * @param {string} text - 要输入的文本
 * @param {object|null} cursor - ghost-cursor 实例
 */
export async function humanPaste(page, selector, text, cursor = null) {
  const log = getLogger()
  const elementTimeout = cfg('browser.element_timeout', 30000)
  const preTypeDelayMin = cfg('keyboard.pre_type_delay_min', 300)
  const preTypeDelayMax = cfg('keyboard.pre_type_delay_max', 800)

  log.info(`CDP insertText 输入（${text.length} 个字符）`)

  // 用 cursor 点击获取焦点（鼠标/键盘同步）
  await page.waitForSelector(selector, { visible: true, timeout: elementTimeout })
  if (cursor) {
    const clickOffset  = cfg('mouse.click_offset_percent', 10)
    const clickWaitMin = cfg('mouse.click_wait_min', 50)
    const clickWaitMax = cfg('mouse.click_wait_max', 200)
    await cursor.click(selector, {
      paddingPercentage: clickOffset,
      waitForClick: Math.floor(gaussianRandom(clickWaitMin, clickWaitMax))
    })
  } else {
    await page.click(selector)
  }
  await randomDelay(preTypeDelayMin, preTypeDelayMax)

  // 获取 CDP session 用于 Input.insertText
  const cdp = await page.target().createCDPSession()

  // ── 自适应输入策略 ──
  // 根据内容长度选择不同输入模式，避免长文超时
  //   短文 (<200字): 全 IME 模拟（最安全、最像真人）
  //   中文 (200-800字): 混合模式（前3段 IME，其余快速输入）
  //   长文 (>800字): 分段快速输入 + 段间停顿（效率优先）
  const imeEnabled = cfg('keyboard.ime_enabled', true)
  const imeThresholdShort = cfg('keyboard.ime_threshold_short', 200)
  const imeThresholdLong = cfg('keyboard.ime_threshold_long', 800)
  const imeParagraphLimit = cfg('keyboard.ime_paragraph_limit', 3)
  const totalLen = text.length

  let mode = 'ime'       // 默认 IME 模拟
  if (totalLen > imeThresholdLong) {
    mode = 'fast'
    log.info(`长文模式（${totalLen}字 > ${imeThresholdLong}），使用分段快速输入`)
  } else if (totalLen > imeThresholdShort) {
    mode = 'hybrid'
    log.info(`混合模式（${totalLen}字），前${imeParagraphLimit}段 IME + 其余快速输入`)
  } else {
    log.info(`短文模式（${totalLen}字），完整 IME 模拟`)
  }

  const paragraphs = text.split('\n')

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]

    if (para.length > 0) {
      // 决定当前段落用哪种输入方式
      let useIME = false
      if (mode === 'ime') {
        useIME = imeEnabled && containsChinese(para)
      } else if (mode === 'hybrid') {
        useIME = imeEnabled && containsChinese(para) && i < imeParagraphLimit
      }
      // mode === 'fast' → useIME 始终 false

      if (useIME) {
        try {
          await simulateIMEText(cdp, para)
        } catch (imeErr) {
          // IME 输入失败时自动降级为 insertText
          log.warn(`IME 输入第${i+1}段失败（${imeErr.message}），降级为快速输入`)
          await cdp.send('Input.insertText', { text: para })
        }
      } else {
        // 快速输入模式：按句子分块输入，每块间加短停顿（更自然）
        const sentences = para.match(/[^。！？.!?\n]+[。！？.!?]?/g) || [para]
        for (let s = 0; s < sentences.length; s++) {
          await cdp.send('Input.insertText', { text: sentences[s] })
          // 句间短停顿（模拟打字节奏，但不是逐字输入那么慢）
          if (s < sentences.length - 1) {
            await randomDelay(150, 500)
          }
        }
      }
    }

    // 段落间按 Enter
    if (i < paragraphs.length - 1) {
      await randomDelay(200, 500)
      await page.keyboard.press('Enter')
    }

    // 段落间模拟思考停顿
    if (i < paragraphs.length - 1) {
      const pauseMin = mode === 'fast' ? 300 : 800
      const pauseMax = mode === 'fast' ? 1000 : 2000
      await randomDelay(pauseMin, pauseMax)
    }
  }

  await cdp.detach()
  log.info('CDP insertText 输入完成')
}

// ============================================================
// 滚动模拟 — 读取 config.scroll.*
// ============================================================

/**
 * 模拟真人随机滚动页面
 *
 * 配置项:
 *   scroll.times_min/max     — 滚动次数范围
 *   scroll.distance_min/max  — 滚动距离范围
 *   scroll.down_bias         — 向下滚动概率
 *   scroll.pause_min/max     — 滚动后停顿
 */
export async function humanScroll(page) {
  const log = getLogger()

  const timesMin    = cfg('scroll.times_min', 2)
  const timesMax    = cfg('scroll.times_max', 6)
  const distMin     = cfg('scroll.distance_min', 100)
  const distMax     = cfg('scroll.distance_max', 500)
  const downBias    = cfg('scroll.down_bias', 0.7)
  const pauseMin    = cfg('scroll.pause_min', 800)
  const pauseMax    = cfg('scroll.pause_max', 2500)

  const times = Math.floor(gaussianRandom(timesMin, timesMax))
  log.debug(`随机滚动 ${times} 次`)

  for (let i = 0; i < times; i++) {
    const direction = Math.random() < downBias ? 1 : -1
    const distance = Math.floor(gaussianRandom(distMin, distMax)) * direction
    await page.mouse.wheel({ deltaY: distance })
    await randomDelay(pauseMin, pauseMax)
  }
}

// ============================================================
// 综合行为模拟 — 读取 config.browse.*
// ============================================================

/**
 * 模拟人在浏览页面（用于填充操作间的空闲时间）
 *
 * 配置项:
 *   browse.mouse_move_chance       — 移动鼠标概率
 *   browse.scroll_chance           — 滚动概率
 *   browse.idle_chance             — 发呆概率
 *   browse.click_post_chance       — 点击帖子阅读概率（需传入 postSelector）
 *   browse.post_read_min/max       — 阅读帖子停留时间（ms）
 *   browse.scroll_distance_min/max — 浏览时滚动距离
 *   browse.action_interval_min/max — 动作间隔
 *   scroll.down_bias               — 滚动方向偏好
 *
 * @param {Page} page
 * @param {object} cursor - ghost-cursor 实例
 * @param {number} durationMs - 浏览总时长（ms）
 * @param {object} [options] - 可选参数
 * @param {string} [options.postSelector] - 帖子元素选择器，提供后启用点击帖子行为
 */
export async function simulateBrowsing(page, cursor, durationMs, options = {}) {
  const log = getLogger()
  const startTime = Date.now()
  log.info(`模拟浏览页面 ${(durationMs / 1000).toFixed(0)}s`)

  const rawMove        = cfg('browse.mouse_move_chance', 0.3)
  const rawScroll      = cfg('browse.scroll_chance', 0.3)
  const rawIdle        = cfg('browse.idle_chance', 0.4)
  const rawClickPost   = options.postSelector ? cfg('browse.click_post_chance', 0.15) : 0
  const total          = rawMove + rawScroll + rawIdle + rawClickPost
  const moveChance     = rawMove / total
  const scrollChance   = rawScroll / total
  const clickPostChance = rawClickPost / total
  const scrollDistMin  = cfg('browse.scroll_distance_min', 50)
  const scrollDistMax  = cfg('browse.scroll_distance_max', 300)
  const intervalMin    = cfg('browse.action_interval_min', 2000)
  const intervalMax    = cfg('browse.action_interval_max', 8000)
  const downBias       = cfg('scroll.down_bias', 0.7)
  const postReadMin    = cfg('browse.post_read_min', 3000)
  const postReadMax    = cfg('browse.post_read_max', 8000)

  while (Date.now() - startTime < durationMs) {
    const action = Math.random()

    if (action < moveChance) {
      await humanRandomMove(cursor, page)
    } else if (action < moveChance + scrollChance) {
      const direction = Math.random() < downBias ? 1 : -1
      const distance = Math.floor(gaussianRandom(scrollDistMin, scrollDistMax)) * direction
      await page.mouse.wheel({ deltaY: distance })
    } else if (clickPostChance > 0 && action < moveChance + scrollChance + clickPostChance) {
      // 点击帖子 → 阅读几秒 → 返回
      try {
        const posts = await page.$$(options.postSelector)
        if (posts.length > 0) {
          const idx = Math.floor(Math.random() * Math.min(posts.length, 5))
          log.debug(`[浏览] 点击第 ${idx + 1} 条帖子阅读`)
          await cursor.click(posts[idx], { paddingPercentage: 10 })
          await randomDelay(postReadMin, postReadMax)
          await page.goBack({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
          await randomDelay(1000, 2000)
        }
      } catch (e) {
        log.debug(`[浏览] 点击帖子失败，跳过: ${e.message}`)
      }
    }
    // else: idle — 什么都不做（真人最常见）

    await randomDelay(intervalMin, intervalMax)
  }

  log.info('浏览模拟结束')
}

// ============================================================
// 文件上传 — 读取 config.upload.*
// ============================================================

/**
 * 上传文件（图片等）
 *
 * 配置项:
 *   upload.wait_after_select_min/max — 选择文件后等待
 *   browser.element_timeout          — 元素等待超时
 */
export async function humanUploadFile(page, selector, filePaths) {
  const log = getLogger()
  log.info(`上传 ${filePaths.length} 个文件`)

  const elementTimeout = cfg('browser.element_timeout', 30000)
  const waitMin        = cfg('upload.wait_after_select_min', 2000)
  const waitMax        = cfg('upload.wait_after_select_max', 5000)

  const fileInput = await page.waitForSelector(selector, { timeout: elementTimeout })

  if (Array.isArray(filePaths)) {
    await fileInput.uploadFile(...filePaths)
  } else {
    await fileInput.uploadFile(filePaths)
  }

  await randomDelay(waitMin, waitMax)
  log.info('文件上传完成')
}

// ============================================================
// 总时长计算 — 读取 config.timing.*
// ============================================================

/**
 * 根据配置计算总时长的额外等待时间
 *
 * 配置项:
 *   timing.total_duration_min/max — 单次发帖目标总时长（秒）
 */
export function calculateRemainingWait(startTime) {
  const totalMin = cfg('timing.total_duration_min', 1800) * 1000
  const totalMax = cfg('timing.total_duration_max', 3600) * 1000
  const targetDuration = gaussianRandom(totalMin, totalMax)
  const elapsed = Date.now() - startTime
  const remaining = Math.max(0, targetDuration - elapsed)
  return Math.floor(remaining)
}

// ============================================================
// 进阶真人行为（Persona-aware）
// ============================================================

/**
 * 按 persona 调制后的等待
 * @param {number} baseMin
 * @param {number} baseMax
 */
export async function personaDelay(baseMin, baseMax) {
  const [min, max] = modulateRange(baseMin, baseMax, { factorPath: 'timing.actionFactor' })
  return randomDelay(min, max)
}

/**
 * 鼠标空闲微抖动：按 persona 半径在原点附近做 1-2 次微移动
 * 不带 page.viewport 时静默跳过
 */
export async function humanMouseJitter(page, cursor) {
  if (!cursor || !page) return
  const radius = Number(personaParam('mouse.jitterRadius', 3))
  if (radius <= 0) return
  try {
    const viewport = page.viewport?.()
    if (!viewport) return
    const cx = Math.floor(viewport.width / 2)
    const cy = Math.floor(viewport.height / 2)
    const times = 1 + Math.floor(Math.random() * 2)
    for (let i = 0; i < times; i++) {
      const dx = Math.floor((Math.random() * 2 - 1) * radius)
      const dy = Math.floor((Math.random() * 2 - 1) * radius)
      await cursor.moveTo({ x: cx + dx, y: cy + dy })
      await sleep(60 + Math.floor(Math.random() * 120))
    }
  } catch { /* ignore */ }
}

/**
 * 犹豫点击：hover → 移开 → 再 hover → 点击
 * 仅在 persona 命中犹豫概率时触发；否则退化为普通 humanClick
 *
 * 配置项:
 *   mouse.click_offset_percent
 *   mouse.click_wait_min/max
 */
export async function humanHesitateClick(cursor, selector, page, options = {}) {
  const log = getLogger()
  const force = options.force === true
  const hesitate = force || shouldDo('click.hesitationChance')

  if (!hesitate) {
    return humanClick(cursor, selector, page)
  }

  const elementTimeout = cfg('browser.element_timeout', 30000)
  const clickOffset    = cfg('mouse.click_offset_percent', 10)
  const clickWaitMin   = cfg('mouse.click_wait_min', 50)
  const clickWaitMax   = cfg('mouse.click_wait_max', 200)
  const preHoverMs     = Number(personaParam('click.preHoverMs', 250))

  log.debug(`犹豫点击: ${selector}`)
  await page.waitForSelector(selector, { visible: true, timeout: elementTimeout })

  // 先 hover 看一眼
  try { await cursor.move(selector, { paddingPercentage: clickOffset }) } catch { /* ignore */ }
  await sleep(Math.floor(gaussianRandom(preHoverMs * 0.6, preHoverMs * 1.4)))

  // 移开（轻微，不要离太远）
  try {
    const viewport = page.viewport?.()
    if (viewport) {
      const dx = Math.floor((Math.random() * 60 + 30) * (Math.random() < 0.5 ? -1 : 1))
      const dy = Math.floor((Math.random() * 40 + 20) * (Math.random() < 0.5 ? -1 : 1))
      await cursor.moveTo({
        x: Math.max(20, Math.min(viewport.width - 20, viewport.width / 2 + dx)),
        y: Math.max(20, Math.min(viewport.height - 20, viewport.height / 2 + dy))
      })
    }
  } catch { /* ignore */ }
  await sleep(Math.floor(gaussianRandom(preHoverMs * 0.8, preHoverMs * 2.2)))

  // 再回来 hover 一下，正式 click
  try { await cursor.move(selector, { paddingPercentage: clickOffset }) } catch { /* ignore */ }
  await sleep(Math.floor(gaussianRandom(preHoverMs * 0.4, preHoverMs * 1.0)))

  await cursor.click(selector, {
    paddingPercentage: clickOffset,
    waitForClick: Math.floor(gaussianRandom(clickWaitMin, clickWaitMax))
  })
  log.debug(`犹豫点击完成: ${selector}`)
}

/**
 * 通读检查：写完后滚到顶看标题、慢速滚到底、偶发回滚、偶发 hover 段落
 * 不修改页面内容，仅滚动 + 鼠标轨迹
 *
 * @param {Page} page
 * @param {object} cursor
 * @param {object} [options]
 * @param {number} [options.passes] - 自定义遍数；不传则按 persona
 */
export async function humanReviewContent(page, cursor, options = {}) {
  const log = getLogger()
  const passesMin = Number(personaParam('scroll.passesMin', 1))
  const passesMax = Number(personaParam('scroll.passesMax', 3))
  const dwell = Number(personaParam('review.dwellMs', 2000))
  const scrollBackChance = Number(personaParam('review.scrollBackChance', 0.4))
  const inertia = Number(personaParam('scroll.inertiaFactor', 1.0))
  const passes = options.passes ?? Math.max(1, Math.floor(gaussianRandom(passesMin, passesMax)))

  log.info(`[通读检查] 滚动 ${passes} 遍，停留 ~${dwell}ms`)

  for (let i = 0; i < passes; i++) {
    // 1) 滚到顶部看标题
    try { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })) } catch { /* ignore */ }
    await sleep(Math.floor(gaussianRandom(dwell * 0.5, dwell * 1.2)))
    await humanMouseJitter(page, cursor)

    // 2) 慢速分段滚到底
    const totalSegments = 3 + Math.floor(Math.random() * 3)
    for (let s = 0; s < totalSegments; s++) {
      const distance = Math.floor(gaussianRandom(180, 380) * inertia)
      try { await page.mouse.wheel({ deltaY: distance }) } catch { /* ignore */ }
      await randomDelay(700, 1600)

      // 3) 偶发在中段回滚
      if (Math.random() < scrollBackChance && s > 0 && s < totalSegments - 1) {
        const back = Math.floor(gaussianRandom(120, 260))
        try { await page.mouse.wheel({ deltaY: -back }) } catch { /* ignore */ }
        await randomDelay(600, 1400)
      }
    }

    // 4) 在底部停一下
    await sleep(Math.floor(gaussianRandom(dwell * 0.4, dwell * 1.0)))
  }

  // 5) 最终回到顶部
  try { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })) } catch { /* ignore */ }
  await randomDelay(400, 900)
  log.info('[通读检查] 完成')
}

/**
 * 真实 paste 事件（替代 Input.insertText）
 *
 * 通过在目标元素 dispatchEvent 一个带 DataTransfer 的 ClipboardEvent，
 * 触发平台前端 onPaste 监听器，得到 trusted-like paste 行为。
 * 默认行为未被阻止时，再用 execCommand insertText 兜底插入文字。
 *
 * 注意：本函数不依赖 navigator.clipboard 权限，不会污染系统剪贴板。
 *
 * @param {Page} page
 * @param {string} selector
 * @param {string} text
 */
export async function humanPasteViaClipboard(page, selector, text) {
  const log = getLogger()
  const elementTimeout = cfg('browser.element_timeout', 30000)
  await page.waitForSelector(selector, { visible: true, timeout: elementTimeout })

  // 先 focus 到目标
  await page.focus(selector).catch(() => {})
  await randomDelay(120, 320)

  await page.evaluate(({ sel, value }) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error('paste target not found: ' + sel)
    el.focus?.()
    let dt
    try {
      dt = new DataTransfer()
      dt.setData('text/plain', value)
    } catch (e) {
      dt = null
    }
    let dispatched = false
    if (dt) {
      try {
        const evt = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        })
        // 部分浏览器 ClipboardEvent 构造时不支持 clipboardData，需要 defineProperty
        if (!evt.clipboardData) {
          Object.defineProperty(evt, 'clipboardData', { value: dt })
        }
        dispatched = el.dispatchEvent(evt)
      } catch { dispatched = false }
    }
    // 默认未被前端阻止 → 真正写入文本
    if (dispatched !== false) {
      try {
        document.execCommand('insertText', false, value)
      } catch { /* ignore */ }
    }
  }, { sel: selector, value: text })

  await randomDelay(300, 700)
  log.info(`[真实粘贴] 已派发 paste 事件（${text.length} 字符）`)
}

/**
 * 人化错误恢复：报错后先停顿读、再轻微滚动、再可选保存草稿、最后由调用方决定是否重试
 *
 * @param {Page} page
 * @param {object} cursor
 * @param {object} options
 * @param {Function} [options.saveDraft] - 可选的保存草稿回调
 */
export async function humanRecoverPause(page, cursor, options = {}) {
  const log = getLogger()
  const readPause = Number(personaParam('recovery.readPauseMs', 2400))
  const driftMin = Math.floor(readPause * 0.7)
  const driftMax = Math.floor(readPause * 1.4)
  log.info(`[人化恢复] 先停顿 ${driftMin}-${driftMax}ms 读错误信息`)
  await randomDelay(driftMin, driftMax)
  await humanMouseJitter(page, cursor)

  // 轻微上下滚动确认上下文
  try {
    await page.mouse.wheel({ deltaY: -120 })
    await randomDelay(500, 1100)
    await page.mouse.wheel({ deltaY: 80 })
    await randomDelay(400, 900)
  } catch { /* ignore */ }

  if (typeof options.saveDraft === 'function' && shouldDo('draft.saveChance')) {
    try {
      log.info('[人化恢复] persona 命中草稿保存')
      await options.saveDraft()
      await randomDelay(800, 1800)
    } catch (err) {
      log.debug(`[人化恢复] 草稿保存跳过: ${err.message}`)
    }
  }
}

/**
 * 在标题/正文写完后，按 persona 概率回头微改一两处
 * （随机选一个文本节点，删一个字再加一个空格，或纯粹再点一次定位）
 *
 * 这是高风险细微动作，默认仅在 persona 命中且调用方显式开启时执行。
 *
 * @param {Page} page
 * @param {string} selector - 目标可编辑元素
 */
export async function humanMicroRevise(page, selector) {
  if (!shouldDo('typing.reviseChance')) return false
  try {
    await page.focus(selector)
    await randomDelay(400, 900)
    // 移到末尾，删一个字再补一个相同字符（最小可逆扰动）
    await page.keyboard.press('End').catch(() => {})
    await randomDelay(200, 500)
    await page.keyboard.press('Backspace').catch(() => {})
    await randomDelay(300, 700)
    await page.keyboard.type(' ').catch(() => {})
    await page.keyboard.press('Backspace').catch(() => {})
    await randomDelay(200, 500)
    return true
  } catch {
    return false
  }
}
