import { pinyin } from 'pinyin-pro'
import { getLogger } from './logger.js'
import { cfg } from './config.js'
import { gaussianRandom, sleep } from './human.js'

/**
 * 中文 IME 输入事件模拟器
 *
 * 通过 CDP Input.imeSetComposition + Input.insertText 构造真实的 IME 输入事件链，
 * 让平台检测到完整的 compositionstart → compositionupdate → compositionend 事件序列。
 *
 * 原理：
 *   真人用拼音输入法打「你好」时，浏览器事件序列为：
 *     compositionstart → compositionupdate("n") → compositionupdate("ni")
 *     → compositionupdate("nih") → compositionupdate("niha") → compositionupdate("nihao")
 *     → compositionend("你好") → input("你好")
 *
 *   CDP 的 Input.imeSetComposition 会触发可信的 composition 事件（isTrusted=true），
 *   Input.insertText 会触发 compositionend 并插入最终文字。
 *
 * 配置项:
 *   keyboard.ime_enabled          — 是否启用 IME 模拟（默认 true）
 *   keyboard.ime_key_delay_min/max — 拼音字母间延迟（毫秒）
 *   keyboard.ime_select_delay_min/max — 选词延迟（毫秒）
 *   keyboard.ime_chunk_min/max    — 每次 IME 输入的字符数（模拟词组输入）
 */

// 判断字符是否为中文
function isChinese(char) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)
}

/**
 * 将文本按「中文」和「非中文」分段
 * 例: "Hello你好World世界" → [{type:'other',text:'Hello'}, {type:'chinese',text:'你好'}, ...]
 */
function segmentText(text) {
  const segments = []
  let currentType = null
  let currentText = ''

  for (const char of text) {
    const type = isChinese(char) ? 'chinese' : 'other'
    if (type !== currentType && currentText) {
      segments.push({ type: currentType, text: currentText })
      currentText = ''
    }
    currentType = type
    currentText += char
  }
  if (currentText) segments.push({ type: currentType, text: currentText })
  return segments
}

/**
 * 将连续中文字符分成 1-3 字的词组（模拟真人词组输入）
 * 例: "你好世界欢迎" → ["你好", "世界", "欢迎"] 或 ["你好世", "界欢", "迎"]
 */
function chunkChinese(text) {
  const chars = [...text]
  const chunks = []
  let i = 0

  while (i < chars.length) {
    // 每次取 1-3 个字符，偏好 2 字词组
    const maxSize = Math.min(3, chars.length - i)
    const size = maxSize <= 1 ? 1 : Math.floor(gaussianRandom(1.5, Math.min(3.5, maxSize + 0.5)))
    const chunkSize = Math.max(1, Math.min(maxSize, size))
    chunks.push(chars.slice(i, i + chunkSize).join(''))
    i += chunkSize
  }

  return chunks
}

/**
 * 通过 CDP 模拟 IME 输入一个中文词组
 *
 * @param {CDPSession} cdp - CDP 会话
 * @param {string} word - 中文词组（如 "你好"）
 * @param {object} log - 日志实例
 */
async function typeWordWithIME(cdp, word, log) {
  // 获取词组的拼音（不带声调）
  const pinyinArr = pinyin(word, { toneType: 'none', type: 'array' })
  // 拼接完整拼音串（如 "nihao"）
  const fullPinyin = pinyinArr.join('')

  const keyDelayMin = cfg('keyboard.ime_key_delay_min', 50)
  const keyDelayMax = cfg('keyboard.ime_key_delay_max', 150)
  const selectDelayMin = cfg('keyboard.ime_select_delay_min', 200)
  const selectDelayMax = cfg('keyboard.ime_select_delay_max', 800)

  // 逐字母输入拼音 → 触发 compositionstart / compositionupdate
  let accumulated = ''
  for (const letter of fullPinyin) {
    accumulated += letter
    await cdp.send('Input.imeSetComposition', {
      text: accumulated,
      selectionStart: accumulated.length,
      selectionEnd: accumulated.length,
    })
    await sleep(Math.floor(gaussianRandom(keyDelayMin, keyDelayMax)))
  }

  // 选词延迟（模拟看候选词列表）
  await sleep(Math.floor(gaussianRandom(selectDelayMin, selectDelayMax)))

  // 确认输入 → 触发 compositionend + 文字插入
  await cdp.send('Input.insertText', { text: word })

  log.debug(`IME 输入: "${word}" (${fullPinyin})`)
}

/**
 * 模拟 IME 输入完整文本（中文走 composition 事件链，非中文走 insertText）
 *
 * @param {CDPSession} cdp - CDP 会话
 * @param {string} text - 要输入的文本（可混合中英文）
 * @returns {Promise<void>}
 */
export async function simulateIMEText(cdp, text) {
  const log = getLogger()
  const charDelayMin = cfg('keyboard.delay_min', 100)
  const charDelayMax = cfg('keyboard.delay_max', 300)

  const segments = segmentText(text)

  for (const segment of segments) {
    if (segment.type === 'chinese') {
      // 中文：分词组逐组 IME 输入
      const chunks = chunkChinese(segment.text)
      for (const chunk of chunks) {
        await typeWordWithIME(cdp, chunk, log)
        // 词组间延迟
        await sleep(Math.floor(gaussianRandom(charDelayMin, charDelayMax)))
      }
    } else {
      // 非中文：直接 insertText（英文、标点、数字等）
      await cdp.send('Input.insertText', { text: segment.text })
      await sleep(Math.floor(gaussianRandom(charDelayMin, charDelayMax)))
    }
  }
}

/**
 * 判断文本是否包含中文字符
 */
export function containsChinese(text) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)
}
