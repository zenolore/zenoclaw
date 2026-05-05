/**
 * 手动验证码处理 — 暂停任务等待用户手动完成
 */
import { CaptchaSolver } from './interface.js'

const CAPTCHA_INDICATORS = [
  'captcha', 'verify', 'verification', 'slider', 'puzzle',
  '验证', '滑块', '拼图', '安全检测', '人机验证'
]

export class ManualCaptchaSolver extends CaptchaSolver {
  constructor(options = {}) {
    super()
    this.waitTimeout = options.waitTimeout || 120000 // 默认等 2 分钟
    this.pollInterval = options.pollInterval || 3000
  }

  async detect(page) {
    try {
      const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase())
      const bodyHtml = await page.evaluate(() => document.body.innerHTML.toLowerCase())

      for (const keyword of CAPTCHA_INDICATORS) {
        if (bodyText.includes(keyword) || bodyHtml.includes(keyword)) {
          const type = keyword.includes('slider') || keyword.includes('滑块') ? 'slider'
            : keyword.includes('puzzle') || keyword.includes('拼图') ? 'click'
            : 'image'
          return { detected: true, type }
        }
      }
      return { detected: false, type: null }
    } catch {
      return { detected: false, type: null }
    }
  }

  async solve(context) {
    const { page } = context
    if (!page) return { solved: false, solution: null, error: 'No page provided' }

    console.log('\n⚠️  检测到验证码，请在浏览器中手动完成验证...')
    console.log(`   类型: ${context.type || '未知'}`)
    console.log(`   超时: ${this.waitTimeout / 1000} 秒\n`)

    const startTime = Date.now()
    while (Date.now() - startTime < this.waitTimeout) {
      await new Promise(r => setTimeout(r, this.pollInterval))
      const check = await this.detect(page)
      if (!check.detected) {
        console.log('✅  验证码已完成')
        return { solved: true, solution: 'manual', error: null }
      }
    }

    return { solved: false, solution: null, error: `手动验证超时 (${this.waitTimeout / 1000}s)` }
  }
}
