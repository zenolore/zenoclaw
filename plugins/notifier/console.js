/**
 * 控制台通知 — 默认实现，输出到 stdout
 */
import { Notifier } from './interface.js'

const ICONS = {
  publish_success: '✅',
  publish_fail: '❌',
  captcha_detected: '⚠️',
  stats_alert: '📊',
  task_start: '🚀',
  task_complete: '🏁',
  error: '💥',
}

export class ConsoleNotifier extends Notifier {
  async notify(event) {
    const icon = ICONS[event.type] || 'ℹ️'
    const time = new Date().toLocaleTimeString()
    console.log(`${icon} [${time}] ${event.title || event.type}`)
    if (event.message) console.log(`   ${event.message}`)
  }
}
