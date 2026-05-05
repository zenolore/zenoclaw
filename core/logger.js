import winston from 'winston'
import fs from 'fs'
import path from 'path'

let logger = null
let _screenshotDir = './logs/screenshots'

export function initLogger(config) {
  const logDir = path.dirname(config?.log?.file || './logs/zenoclaw.log')
  _screenshotDir = config?.log?.screenshot_dir || './logs/screenshots'

  for (const dir of [logDir, _screenshotDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  // 结构化 JSON 格式（文件输出，便于日志分析）
  const jsonFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.json()
  )

  // 人类可读格式（控制台输出）
  const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, taskId, step, platform, screenshot, ...rest }) => {
      let prefix = `[${timestamp}] ${level}`
      if (taskId) prefix += ` [${taskId}]`
      if (platform) prefix += ` [${platform}]`
      if (step) prefix += ` [step:${step}]`
      let line = `${prefix} ${message}`
      if (screenshot) line += ` 📸 ${screenshot}`
      return line
    })
  )

  logger = winston.createLogger({
    level: config?.log?.level || 'info',
    defaultMeta: {},
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}`
      })
    ),
    transports: [
      new winston.transports.Console({ format: consoleFormat }),
      new winston.transports.File({
        filename: config?.log?.file || './logs/zenoclaw.log',
        maxsize: 5 * 1024 * 1024, // 5MB
        maxFiles: 3
      }),
      // 结构化 JSON 日志（供日志分析系统消费）
      new winston.transports.File({
        filename: path.join(path.dirname(config?.log?.file || './logs/zenoclaw.log'), 'zenoclaw-structured.jsonl'),
        format: jsonFormat,
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
      })
    ]
  })

  return logger
}

export function getLogger() {
  if (!logger) {
    return initLogger({})
  }
  return logger
}

/**
 * 创建任务级子日志器，自动附加 taskId / platform / step 等上下文
 * @param {object} ctx - { taskId, platform }
 * @returns {object} - 带 step() 和 screenshot() 方法的日志对象
 */
export function createTaskLogger(ctx = {}) {
  const log = getLogger()
  const meta = { taskId: ctx.taskId || 'unknown', platform: ctx.platform || '' }

  return {
    /** 记录步骤开始 */
    step(stepName, message) {
      log.info(message, { ...meta, step: stepName })
    },
    /** 记录步骤成功 */
    stepDone(stepName, message) {
      log.info(`✓ ${message}`, { ...meta, step: stepName })
    },
    /** 记录步骤失败 */
    stepFail(stepName, message, error) {
      log.error(`✗ ${message}${error ? ': ' + error : ''}`, { ...meta, step: stepName })
    },
    info(msg) { log.info(msg, meta) },
    warn(msg) { log.warn(msg, meta) },
    error(msg) { log.error(msg, meta) },
    debug(msg) { log.debug(msg, meta) },

    /**
     * 保存失败截图并关联到日志
     * @param {import('puppeteer').Page} page - Puppeteer 页面实例
     * @param {string} stepName - 步骤名
     * @returns {Promise<string|null>} 截图文件路径
     */
    async captureFailureScreenshot(page, stepName) {
      if (!page) return null
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `fail_${meta.taskId}_${stepName}_${ts}.png`
        const filepath = path.resolve(_screenshotDir, filename)
        await page.screenshot({ path: filepath, fullPage: false })
        log.error(`失败截图已保存`, { ...meta, step: stepName, screenshot: filepath })
        return filepath
      } catch (err) {
        log.warn(`截图失败: ${err.message}`, meta)
        return null
      }
    }
  }
}
