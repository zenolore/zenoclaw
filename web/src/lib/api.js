/**
 * Web UI API Client — 与 ZenoClaw API Server 通信
 *
 * 安全策略:
 *   - API Key 存储在 sessionStorage（标签页关闭即清除，不跨标签共享）
 *   - 自动迁移 localStorage 中的旧数据到 sessionStorage 后清除
 *   - 提供 validateApiKey() 用于保存前验证
 */
const BASE = '/api'

// 启动时自动迁移旧 localStorage 数据
;(() => {
  const oldKey = localStorage.getItem('zenoclaw_api_key')
  if (oldKey) {
    sessionStorage.setItem('zenoclaw_api_key', oldKey)
    localStorage.removeItem('zenoclaw_api_key')
  }
})()

async function request(method, path, body = null, query = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }

  const apiKey = sessionStorage.getItem('zenoclaw_api_key')
  if (apiKey) opts.headers['X-API-Key'] = apiKey

  if (body && method !== 'GET') opts.body = JSON.stringify(body)

  const res = await fetch(url.toString(), opts)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`)
  return data
}

/**
 * 验证 API Key 是否有效（向服务端发起一个轻量请求）
 * @param {string} key
 * @returns {Promise<{valid: boolean, message: string}>}
 */
async function validateApiKey(key) {
  try {
    const url = new URL(`${BASE}/health`, window.location.origin)
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': key },
    })
    if (res.ok) return { valid: true, message: 'API Key 验证通过' }
    if (res.status === 403) return { valid: false, message: 'API Key 无效' }
    if (res.status === 503) return { valid: false, message: '服务端未配置 API Key' }
    return { valid: false, message: `验证失败: HTTP ${res.status}` }
  } catch (err) {
    return { valid: false, message: `连接失败: ${err.message}` }
  }
}

export const api = {
  get: (path, query) => request('GET', path, null, query),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  validateApiKey,
  /** 获取当前存储的 API Key */
  getStoredKey: () => sessionStorage.getItem('zenoclaw_api_key') || '',
  /** 安全保存 API Key */
  setStoredKey: (key) => {
    if (key) {
      sessionStorage.setItem('zenoclaw_api_key', key)
    } else {
      sessionStorage.removeItem('zenoclaw_api_key')
    }
  },
}
