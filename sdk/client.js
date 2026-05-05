/**
 * ZenoClaw HTTP Client — 底层 HTTP 请求封装
 */
export class ZenoClawClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || 'http://localhost:3200').replace(/\/$/, '')
    this.apiKey = options.apiKey || ''
    this.timeout = options.timeout || 30000
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' }
    if (this.apiKey) h['X-API-Key'] = this.apiKey
    return h
  }

  _buildUrl(path, query = {}) {
    const url = new URL(path, this.baseUrl)
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
    return url.toString()
  }

  async _request(method, path, body = null, query = {}) {
    const url = this._buildUrl(path, query)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const options = {
        method,
        headers: this._headers(),
        signal: controller.signal,
      }
      if (body && method !== 'GET') {
        options.body = JSON.stringify(body)
      }

      const res = await fetch(url, options)
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        const err = new Error(data?.message || `HTTP ${res.status}`)
        err.status = res.status
        err.data = data
        throw err
      }
      return data
    } finally {
      clearTimeout(timer)
    }
  }

  async get(path, query = {}) { return this._request('GET', path, null, query) }
  async post(path, body = {}) { return this._request('POST', path, body) }
  async put(path, body = {}) { return this._request('PUT', path, body) }
  async patch(path, body = {}) { return this._request('PATCH', path, body) }
  async delete(path) { return this._request('DELETE', path) }
}
