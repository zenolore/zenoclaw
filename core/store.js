/**
 * JSON 文件持久化存储
 *
 * 为 API 路由提供统一的 JSON 文件读写接口，
 * 内存缓存 + 文件持久化，重启后自动恢复。
 *
 * 用法:
 *   const store = new JsonStore('./data/tasks.json')
 *   store.set('task_123', { ... })
 *   store.get('task_123')
 *   store.delete('task_123')
 *   store.values()
 */
import fs from 'fs'
import path from 'path'

export class JsonStore {
  /**
   * @param {string} filePath - JSON 文件路径（相对于 cwd）
   * @param {object} options
   * @param {number} options.maxItems - 最大保留条数（0=不限）
   * @param {boolean} options.lazyWrite - 是否延迟写入（批量场景）
   */
  constructor(filePath, options = {}) {
    this._filePath = path.resolve(filePath)
    this._maxItems = options.maxItems || 0
    this._data = new Map()
    this._dirty = false
    this._writeTimer = null
    this._load()
  }

  // --- 公共 API ---

  get(key) {
    return this._data.get(key) || null
  }

  set(key, value) {
    this._data.set(key, value)
    this._scheduleSave()
  }

  delete(key) {
    this._data.delete(key)
    this._scheduleSave()
  }

  has(key) {
    return this._data.has(key)
  }

  values(filter) {
    let list = Array.from(this._data.values())
    if (typeof filter === 'function') {
      list = list.filter(filter)
    }
    return list
  }

  size() {
    return this._data.size
  }

  // --- 内部实现 ---

  _load() {
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = JSON.parse(fs.readFileSync(this._filePath, 'utf-8'))
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const key = item._store_key || item.task_id || item.id
            if (key) this._data.set(key, item)
          }
        }
      }
    } catch {
      // 文件损坏或不存在，从空开始
    }
  }

  _scheduleSave() {
    if (this._writeTimer) return
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null
      this._save()
    }, 100)
  }

  _save() {
    try {
      const dir = path.dirname(this._filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      let items = Array.from(this._data.values())

      // 超过最大条数时，移除最旧的
      if (this._maxItems > 0 && items.length > this._maxItems) {
        items.sort((a, b) =>
          new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        )
        const toRemove = items.slice(0, items.length - this._maxItems)
        for (const item of toRemove) {
          const key = item._store_key || item.task_id || item.id
          if (key) this._data.delete(key)
        }
        items = items.slice(items.length - this._maxItems)
      }

      // 原子写入：先写临时文件再 rename
      const tmpPath = this._filePath + '.tmp'
      fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), 'utf-8')
      fs.renameSync(tmpPath, this._filePath)
    } catch (err) {
      console.error(`[JsonStore] 写入失败 ${this._filePath}: ${err.message}`)
    }
  }

  /** 立即刷写（用于优雅退出） */
  flush() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer)
      this._writeTimer = null
    }
    this._save()
  }
}
