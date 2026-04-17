/**
 * 发布状态浮窗 — 页面顶部居中显示当前操作步骤
 *
 * 反检测设计:
 *   - 使用 Shadow DOM 隔离，平台 JS 无法 querySelector 到内部元素
 *   - 宿主元素用随机属性名，不带任何 class/id
 *   - pointer-events: none，不影响页面交互
 *   - 通过 CDP 在隔离 world 中执行，与页面 JS 上下文隔离
 *
 * 用法:
 *   import { injectOverlay, updateOverlay, removeOverlay } from './status-overlay.js'
 *   await injectOverlay(page)
 *   await updateOverlay(page, '正在输入标题...')
 *   await removeOverlay(page)
 */

// 随机生成 8 位属性名，每次运行都不同
const ATTR_KEY = '_z' + Math.random().toString(36).slice(2, 10)

/**
 * 注入状态浮窗到页面
 */
export async function injectOverlay(page) {
  try {
    await page.evaluate((attrKey) => {
      // 防止重复注入
      if (document.querySelector('[' + attrKey + ']')) return

      const host = document.createElement('div')
      host.setAttribute(attrKey, '1')
      host.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:2147483647;'
        + 'pointer-events:none;display:flex;justify-content:center;padding:8px 0;'

      const shadow = host.attachShadow({ mode: 'closed' })

      shadow.innerHTML = [
        '<style>',
        '  @keyframes _zp{0%,100%{opacity:1}50%{opacity:0.2}}',
        '  .w{display:flex;align-items:center;gap:8px;',
        '     background:rgba(15,23,42,0.88);color:#e2e8f0;',
        '     padding:6px 18px;border-radius:0 0 12px 12px;',
        '     font:600 13px/1.4 system-ui,-apple-system,sans-serif;',
        '     box-shadow:0 2px 12px rgba(0,0,0,0.25);',
        '     backdrop-filter:blur(8px);max-width:480px}',
        '  .d{width:7px;height:7px;background:#22d3ee;border-radius:50%;',
        '     animation:_zp 1.2s ease-in-out infinite;flex-shrink:0}',
        '  .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '</style>',
        '<div class="w">',
        '  <span class="d"></span>',
        '  <span class="t" id="zt">自动发布操作中</span>',
        '</div>',
      ].join('')

      document.documentElement.appendChild(host)

      // 把引用存到一个不可枚举属性上，便于后续更新
      Object.defineProperty(window, '_' + attrKey, {
        value: shadow, configurable: true, enumerable: false
      })
    }, ATTR_KEY)
  } catch {
    // 页面可能已关闭，忽略
  }
}

/**
 * 更新浮窗文字
 * @param {import('puppeteer-core').Page} page
 * @param {string} text - 显示文字，如 "正在输入标题..."
 */
export async function updateOverlay(page, text) {
  try {
    await page.evaluate((attrKey, msg) => {
      const shadow = window['_' + attrKey]
      if (!shadow) return
      const el = shadow.getElementById('zt')
      if (el) el.textContent = msg
    }, ATTR_KEY, text)
  } catch {
    // 忽略
  }
}

/**
 * 移除浮窗
 */
export async function removeOverlay(page) {
  try {
    await page.evaluate((attrKey) => {
      const host = document.querySelector('[' + attrKey + ']')
      if (host) host.remove()
      delete window['_' + attrKey]
    }, ATTR_KEY)
  } catch {
    // 忽略
  }
}
