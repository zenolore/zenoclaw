/**
 * 指纹一致性启动门禁 (Fingerprint Audit)
 *
 * 启动后立刻在目标 page 上自检关键反检测点。
 * 目的：避免你以为 stealth 生效但其实没生效就直接拿去发布。
 *
 * 检查项（按风险等级分组）：
 *   critical - 会让平台立刻识别为 bot
 *     - navigator.webdriver 必须 false
 *     - userAgent 不能含 HeadlessChrome
 *     - window.chrome 必须存在
 *
 *   important - 大概率被风控放入观察名单
 *     - navigator.languages.length > 0
 *     - navigator.plugins.length > 0
 *     - Intl.DateTimeFormat().resolvedOptions().timeZone 不为空
 *     - WebGL UNMASKED_VENDOR / UNMASKED_RENDERER 不为空
 *     - Canvas 指纹存在且非全空
 *
 *   advisory - 加分项；缺失不阻断
 *     - permissions API 行为正常
 *     - AudioContext 指纹存在
 *     - hardwareConcurrency / deviceMemory > 0
 *
 * 用法：
 *   import { auditFingerprint, requireHealthyFingerprint } from './fingerprint-audit.js'
 *   const report = await auditFingerprint(page)
 *   await requireHealthyFingerprint(page, { mode: 'warn' | 'block' })
 *
 * 不修改页面，只读取 navigator/window/Intl/WebGL/Canvas 等只读字段。
 */

import { getLogger } from './logger.js'
import { cfg } from './config.js'

// ============================================================
// 在页面内执行的探针
// ============================================================

const PROBE_SCRIPT = `(() => {
  const result = {
    webdriver: undefined,
    userAgent: navigator.userAgent || '',
    languages: navigator.languages ? Array.from(navigator.languages) : [],
    plugins: navigator.plugins ? navigator.plugins.length : 0,
    chromeRuntime: !!(window.chrome && window.chrome.runtime),
    timezone: '',
    locale: '',
    screen: {
      width: screen.width || 0,
      height: screen.height || 0,
      colorDepth: screen.colorDepth || 0,
      devicePixelRatio: window.devicePixelRatio || 0
    },
    innerWidth: window.innerWidth || 0,
    innerHeight: window.innerHeight || 0,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    permissionsAvailable: !!(navigator.permissions && typeof navigator.permissions.query === 'function'),
    webgl: { vendor: '', renderer: '', error: null },
    canvasHash: null,
    audioFingerprint: null,
    webdriverGetterToString: null,
    issues: []
  }

  // navigator.webdriver
  try {
    result.webdriver = navigator.webdriver
  } catch (e) {
    result.issues.push('webdriver-throws:' + e.message)
  }

  // 检测 webdriver getter 是否 native（stealth 是否被反爬识破）
  try {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')
      || Object.getOwnPropertyDescriptor(navigator, 'webdriver')
    if (desc && desc.get) {
      result.webdriverGetterToString = String(desc.get.toString()).slice(0, 200)
    }
  } catch (e) {
    // ignore
  }

  // 时区 / locale
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions()
    result.timezone = opts.timeZone || ''
    result.locale = opts.locale || ''
  } catch (e) {
    result.issues.push('intl-throws:' + e.message)
  }

  // WebGL
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      if (dbg) {
        result.webgl.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '')
        result.webgl.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
      }
    } else {
      result.webgl.error = 'no-webgl-context'
    }
  } catch (e) {
    result.webgl.error = e.message
  }

  // Canvas 指纹
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 200; canvas.height = 60
    const ctx = canvas.getContext('2d')
    ctx.textBaseline = 'top'
    ctx.font = '14px Arial'
    ctx.fillStyle = '#069'
    ctx.fillText('zenoclaw fingerprint probe 你好', 2, 2)
    ctx.fillStyle = 'rgba(102, 200, 0, 0.7)'
    ctx.fillText('zenoclaw fingerprint probe 你好', 4, 4)
    const dataUrl = canvas.toDataURL()
    let hash = 0
    for (let i = 0; i < dataUrl.length; i++) {
      hash = ((hash << 5) - hash) + dataUrl.charCodeAt(i)
      hash |= 0
    }
    result.canvasHash = String(hash)
  } catch (e) {
    result.issues.push('canvas-throws:' + e.message)
  }

  // AudioContext 指纹（只取一次 sampleRate / state，不真正生成音频）
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
    if (Ctx) {
      const ac = new Ctx(1, 1, 22050)
      result.audioFingerprint = ac.sampleRate + ':' + ac.length
    }
  } catch (e) {
    result.issues.push('audio-throws:' + e.message)
  }

  return result
})()`

// ============================================================
// 评估
// ============================================================

const SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  IMPORTANT: 'important',
  ADVISORY: 'advisory'
})

function evaluateProbe(probe) {
  const failures = []

  // critical
  if (probe.webdriver !== false) {
    failures.push({ severity: SEVERITY.CRITICAL, key: 'navigator.webdriver', expected: false, got: probe.webdriver })
  }
  if (typeof probe.userAgent === 'string' && /HeadlessChrome/i.test(probe.userAgent)) {
    failures.push({ severity: SEVERITY.CRITICAL, key: 'userAgent.headless', got: probe.userAgent })
  }
  if (!probe.chromeRuntime) {
    failures.push({ severity: SEVERITY.CRITICAL, key: 'window.chrome.runtime', got: false })
  }

  // important
  if (!Array.isArray(probe.languages) || probe.languages.length === 0) {
    failures.push({ severity: SEVERITY.IMPORTANT, key: 'navigator.languages', got: probe.languages })
  }
  if (!probe.plugins || probe.plugins === 0) {
    failures.push({ severity: SEVERITY.IMPORTANT, key: 'navigator.plugins.length', got: probe.plugins })
  }
  if (!probe.timezone) {
    failures.push({ severity: SEVERITY.IMPORTANT, key: 'Intl.timezone', got: probe.timezone })
  }
  if (!probe.screen?.width || !probe.screen?.height) {
    failures.push({ severity: SEVERITY.IMPORTANT, key: 'screen.dimensions', got: probe.screen })
  }
  if (probe.webgl?.error || (!probe.webgl?.vendor && !probe.webgl?.renderer)) {
    failures.push({ severity: SEVERITY.IMPORTANT, key: 'webgl.unmasked', got: probe.webgl })
  }
  if (!probe.canvasHash) {
    failures.push({ severity: SEVERITY.IMPORTANT, key: 'canvas.hash', got: probe.canvasHash })
  }

  // advisory
  if (!probe.permissionsAvailable) {
    failures.push({ severity: SEVERITY.ADVISORY, key: 'navigator.permissions', got: false })
  }
  if (!probe.audioFingerprint) {
    failures.push({ severity: SEVERITY.ADVISORY, key: 'audioContext.fingerprint', got: probe.audioFingerprint })
  }
  if (!probe.hardwareConcurrency) {
    failures.push({ severity: SEVERITY.ADVISORY, key: 'navigator.hardwareConcurrency', got: probe.hardwareConcurrency })
  }

  // stealth 函数被识破：webdriver getter 不再是 native code
  if (probe.webdriverGetterToString && !/\[native code\]/.test(probe.webdriverGetterToString)) {
    failures.push({
      severity: SEVERITY.IMPORTANT,
      key: 'stealth.toString.detectable',
      got: probe.webdriverGetterToString
    })
  }

  // 评分（critical 0 通过、important 0 通过算 healthy）
  const counts = { critical: 0, important: 0, advisory: 0 }
  for (const f of failures) counts[f.severity] = (counts[f.severity] || 0) + 1

  let status = 'healthy'
  if (counts.critical > 0) status = 'critical'
  else if (counts.important > 0) status = 'degraded'
  else if (counts.advisory > 0) status = 'advisory'

  return { failures, counts, status }
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 在 page 上执行指纹自检
 * @param {Page} page - puppeteer page
 * @returns {Promise<{status, counts, failures, probe}>}
 */
export async function auditFingerprint(page) {
  if (!page) throw new Error('auditFingerprint: page is required')
  const probe = await page.evaluate(PROBE_SCRIPT)
  const evaluation = evaluateProbe(probe)
  return { ...evaluation, probe }
}

/**
 * 启动门禁：在 browser.js 创建完 page 后调用
 *
 * 配置项（zenoclaw.config.yaml）:
 *   stealth.audit.enabled    - 默认 true
 *   stealth.audit.mode       - 'warn' | 'block'，默认 'warn'
 *   stealth.audit.blockOn    - 'critical' | 'degraded'，默认 'critical'
 *
 * @param {Page} page
 * @param {object} [options]
 * @param {string} [options.mode] - 覆盖配置 mode
 * @param {string} [options.blockOn] - 覆盖配置 blockOn
 */
export async function requireHealthyFingerprint(page, options = {}) {
  const log = getLogger()
  const enabled = cfg('stealth.audit.enabled', true)
  if (enabled === false) {
    log.debug('[FingerprintAudit] 已禁用，跳过')
    return { status: 'skipped' }
  }

  const mode = options.mode || cfg('stealth.audit.mode', 'warn')
  const blockOn = options.blockOn || cfg('stealth.audit.blockOn', 'critical')

  let report
  try {
    report = await auditFingerprint(page)
  } catch (err) {
    log.warn(`[FingerprintAudit] 自检执行失败: ${err.message}`)
    return { status: 'error', error: err.message }
  }

  const summary = `[FingerprintAudit] status=${report.status} critical=${report.counts.critical} important=${report.counts.important} advisory=${report.counts.advisory}`
  if (report.status === 'healthy') {
    log.info(summary)
  } else {
    log.warn(summary)
    for (const f of report.failures) {
      log.warn(`  - [${f.severity}] ${f.key}: got=${JSON.stringify(f.got)?.slice(0, 200)}`)
    }
  }

  // 决策
  const shouldBlock = mode === 'block' && (
    (blockOn === 'critical' && report.status === 'critical') ||
    (blockOn === 'degraded' && (report.status === 'critical' || report.status === 'degraded'))
  )

  if (shouldBlock) {
    const err = new Error(`[FingerprintAudit] 指纹自检不通过（${report.status}），按配置 mode=block 拒绝启动`)
    err.report = report
    throw err
  }

  return report
}

export const __test__ = { evaluateProbe, PROBE_SCRIPT }
