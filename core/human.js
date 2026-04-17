import { createCursor } from 'ghost-cursor'
import { getLogger } from './logger.js'
import { cfg } from './config.js'
import { simulateIMEText, containsChinese } from './ime-simulator.js'

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
