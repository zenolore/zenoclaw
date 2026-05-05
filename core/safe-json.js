/**
 * 安全 JSON 文件读写
 *
 * 提供 per-file 写锁 + 原子写入，防止并发读写导致数据丢失。
 * 适用于 interact_history, browse_history, accounts, schedules 等。
 *
 * 用法:
 *   import { safeReadJson, safeWriteJson } from './safe-json.js'
 *   const data = safeReadJson('./data/accounts.json', [])
 *   data.push(newItem)
 *   await safeWriteJson('./data/accounts.json', data)
 */
import fs from 'fs'
import path from 'path'

// per-file 写锁队列
const _fileLocks = new Map()

/**
 * 同步读取 JSON 文件，失败时返回默认值
 * @param {string} filePath - 相对或绝对路径
 * @param {*} defaultValue - 读取失败时的默认值
 * @returns {*}
 */
export function safeReadJson(filePath, defaultValue = []) {
  const resolved = path.resolve(filePath)
  try {
    if (!fs.existsSync(resolved)) return defaultValue
    return JSON.parse(fs.readFileSync(resolved, 'utf-8'))
  } catch {
    return defaultValue
  }
}

/**
 * 安全写入 JSON 文件（原子写入 + per-file 串行化）
 * @param {string} filePath - 相对或绝对路径
 * @param {*} data - 要写入的数据
 * @returns {Promise<void>}
 */
export async function safeWriteJson(filePath, data) {
  const resolved = path.resolve(filePath)

  // 获取该文件的写锁
  if (!_fileLocks.has(resolved)) {
    _fileLocks.set(resolved, Promise.resolve())
  }

  const prev = _fileLocks.get(resolved)
  let releaseFn
  const lock = new Promise(resolve => { releaseFn = resolve })
  _fileLocks.set(resolved, prev.then(() => lock))

  await prev

  try {
    const dir = path.dirname(resolved)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const tmpPath = resolved + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, resolved)
  } finally {
    releaseFn()
  }
}
