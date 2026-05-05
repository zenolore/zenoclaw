/**
 * 验证码识别接口（Captcha Solver）
 *
 * 实现方式：
 * - manual.js: 暂停等待用户手动处理（默认）
 * - twocaptcha.js: 对接 2Captcha 服务（示例）
 * - 用户自定义：实现此接口对接任何验证码服务
 */
export class CaptchaSolver {
  /**
   * 检测页面是否出现验证码
   * @param {Object} page - Puppeteer page 对象
   * @returns {Promise<{ detected: boolean, type: string|null }>}
   *   type: 'image' | 'slider' | 'click' | 'recaptcha' | null
   */
  async detect(page) {
    throw new Error('CaptchaSolver.detect() not implemented')
  }

  /**
   * 识别并解决验证码
   * @param {Object} context
   * @param {string} context.type - 验证码类型
   * @param {string} [context.imageBase64] - 验证码图片 base64
   * @param {string} [context.pageUrl] - 当前页面 URL
   * @param {Object} [context.page] - Puppeteer page 对象
   * @returns {Promise<{ solved: boolean, solution: any, error: string|null }>}
   */
  async solve(context) {
    throw new Error('CaptchaSolver.solve() not implemented')
  }
}
