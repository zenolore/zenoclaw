/**
 * Webhook 通知 — 通过 HTTP POST 发送通知
 */
import { Notifier } from './interface.js'

export class WebhookNotifier extends Notifier {
  constructor(options = {}) {
    super()
    this.url = options.url || ''
    this.headers = options.headers || { 'Content-Type': 'application/json' }
    this.timeout = options.timeout || 10000
  }

  async notify(event) {
    if (!this.url) return
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeout)
      await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          ...event,
          timestamp: new Date().toISOString(),
          source: 'zenoclaw',
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)
    } catch (err) {
      console.error(`[WebhookNotifier] 发送失败: ${err.message}`)
    }
  }
}
