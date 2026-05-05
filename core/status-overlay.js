/**
 * 发布状态浮窗 — 页面顶部居中显示当前操作步骤
 *
 * 视觉设计:
 *   - 橙色渐变底色（操作中）/ 绿色（完成）/ 红色（出错）
 *   - 绿色脉冲指示灯 + 发光效果
 *   - 双行布局：任务标签 + 当前步骤/下一步预告
 *   - 步骤计数器 [3/8]
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
 *   // 新格式（推荐）
 *   await updateOverlay(page, {
 *     label: '头条号 · 文章发布任务执行中',
 *     current: '正在输入标题',
 *     next: '输入正文',
 *     step: 3,
 *     total: 8
 *   })
 *   // 旧格式（向后兼容）
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
        + 'pointer-events:none;display:flex;justify-content:center;'

      const shadow = host.attachShadow({ mode: 'closed' })

      shadow.innerHTML = [
        '<style>',
        '  @keyframes _zp{0%,100%{opacity:1;box-shadow:0 0 6px 2px rgba(34,197,94,0.6)}50%{opacity:0.3;box-shadow:0 0 2px 1px rgba(34,197,94,0.2)}}',
        '  @keyframes _zp_done{0%,100%{box-shadow:0 0 8px 3px rgba(34,197,94,0.7)}50%{box-shadow:0 0 4px 2px rgba(34,197,94,0.3)}}',
        '  .w{display:flex;flex-direction:column;gap:4px;',
        '     background:linear-gradient(135deg,#ea580c,#f59e0b);color:#fff;',
        '     padding:10px 24px;border-radius:0 0 14px 14px;',
        '     font:600 13px/1.4 system-ui,-apple-system,"Microsoft YaHei",sans-serif;',
        '     box-shadow:0 4px 20px rgba(0,0,0,0.3);',
        '     min-width:360px;max-width:720px}',
        '  .w.done{background:linear-gradient(135deg,#16a34a,#22c55e)}',
        '  .w.err{background:linear-gradient(135deg,#dc2626,#ef4444)}',
        '  .hd{display:flex;align-items:center;gap:8px}',
        '  .d{width:10px;height:10px;background:#22c55e;border-radius:50%;flex-shrink:0;',
        '     animation:_zp 1.2s ease-in-out infinite}',
        '  .w.done .d{animation:_zp_done 2s ease-in-out infinite;background:#fff}',
        '  .w.err .d{background:#fca5a5;animation:_zp 0.8s ease-in-out infinite}',
        '  .lb{font-size:14px;font-weight:700;letter-spacing:0.5px;',
        '      text-shadow:0 1px 2px rgba(0,0,0,0.2)}',
        '  .bd{display:flex;align-items:center;gap:8px;margin-left:18px}',
        '  .pg{font-size:12px;opacity:0.85;font-weight:700;',
        '      background:rgba(255,255,255,0.2);padding:1px 8px;border-radius:10px}',
        '  .ct{font-size:13px;font-weight:600}',
        '  .nx{font-size:12px;opacity:0.75;margin-left:4px}',
        '</style>',
        '<div class="w" id="zw">',
        '  <div class="hd">',
        '    <span class="d" id="zd"></span>',
        '    <span class="lb" id="zlb">任务执行中</span>',
        '  </div>',
        '  <div class="bd">',
        '    <span class="pg" id="zpg"></span>',
        '    <span class="ct" id="zct">准备中…</span>',
        '    <span class="nx" id="znx"></span>',
        '  </div>',
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
 * 更新浮窗内容
 * @param {import('puppeteer-core').Page} page
 * @param {string|object} msgOrOpts
 *   - string: 向后兼容，仅更新当前步骤文字
 *   - object: { label, current, next, step, total, done, error }
 */
export async function updateOverlay(page, msgOrOpts) {
  try {
    await page.evaluate((attrKey, payload) => {
      const shadow = window['_' + attrKey]
      if (!shadow) return

      // 向后兼容：纯字符串
      if (typeof payload === 'string') {
        const ct = shadow.getElementById('zct')
        if (ct) ct.textContent = payload
        return
      }

      // 结构化更新
      const { label, current, next, step, total, done, error } = payload
      const wrap = shadow.getElementById('zw')
      const lb = shadow.getElementById('zlb')
      const pg = shadow.getElementById('zpg')
      const ct = shadow.getElementById('zct')
      const nx = shadow.getElementById('znx')

      if (wrap) {
        wrap.className = 'w' + (done ? ' done' : '') + (error ? ' err' : '')
      }
      if (lb && label) lb.textContent = label
      if (pg) {
        if (step && total) {
          pg.textContent = '[' + step + '/' + total + ']'
          pg.style.display = ''
        } else {
          pg.style.display = 'none'
        }
      }
      if (ct) ct.textContent = current || ''
      if (nx) {
        if (next && !done && !error) {
          nx.textContent = '→ 下一步：' + next
          nx.style.display = ''
        } else {
          nx.style.display = 'none'
        }
      }
    }, ATTR_KEY, msgOrOpts)
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
