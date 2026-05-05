/**
 * 通知接口（Notifier）
 *
 * 实现方式：
 * - console.js: 控制台输出（默认）
 * - webhook.js: Webhook 通知（HTTP POST）
 * - 用户自定义：实现此接口对接微信/钉钉/Slack 等
 */
export class Notifier {
  /**
   * 发送通知
   * @param {Object} event
   * @param {string} event.type - 事件类型:
   *   'publish_success' | 'publish_fail' | 'captcha_detected' |
   *   'stats_alert' | 'task_start' | 'task_complete' | 'error'
   * @param {string} event.title - 通知标题
   * @param {string} event.message - 通知正文
   * @param {Object} [event.data] - 附加数据
   * @returns {Promise<void>}
   */
  async notify(event) {
    throw new Error('Notifier.notify() not implemented')
  }
}
