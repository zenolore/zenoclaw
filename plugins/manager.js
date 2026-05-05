/**
 * 插件管理器 — 加载和管理所有可插拔组件
 *
 * 配置示例 (zenoclaw.config.yaml):
 *   plugins:
 *     content_provider: "default"                    # 内置
 *     captcha_solver: "manual"                       # 内置
 *     analytics_engine: "default"                    # 内置
 *     notifier: "console"                            # 内置
 *     notifier: "./my-plugins/slack-notifier.js"     # 自定义路径
 *     notifier_options:
 *       url: "https://your-webhook.com/notify"
 *
 * 自定义插件约定:
 *   - 文件路径以 ./ 或 / 开头，支持绝对路径和相对路径
 *   - 模块须 default export 一个类，构造函数接受 options 对象
 */
import path from 'path'
import { pathToFileURL } from 'url'
import { DefaultContentProvider } from './content-provider/default.js'
import { ManualCaptchaSolver } from './captcha-solver/manual.js'
import { DefaultAnalyticsEngine } from './analytics-engine/default.js'
import { ConsoleNotifier } from './notifier/console.js'
import { WebhookNotifier } from './notifier/webhook.js'

let _plugins = null

/**
 * 从自定义路径动态加载插件类
 * @param {string} modulePath - 插件文件路径（相对于 cwd 或绝对路径）
 * @returns {Promise<Function>} 插件类
 */
async function loadCustomPlugin(modulePath) {
  const resolved = path.resolve(modulePath)
  const mod = await import(pathToFileURL(resolved).href)
  const PluginClass = mod.default || Object.values(mod).find(v => typeof v === 'function')
  if (!PluginClass) {
    throw new Error(`插件 ${modulePath} 未导出有效的类`)
  }
  return PluginClass
}

/**
 * 判断是否为自定义路径（以 ./ 或 / 或盘符开头）
 */
function isCustomPath(type) {
  return type.startsWith('./') || type.startsWith('/') || /^[A-Za-z]:[\\/]/.test(type) || type.startsWith('../')
}

/**
 * 初始化插件系统（异步，支持自定义路径 import()）
 * @param {Object} config - 完整配置对象
 */
export async function initPlugins(config = {}) {
  const pluginConfig = config.plugins || {}

  _plugins = {
    contentProvider: await createContentProvider(pluginConfig, config),
    captchaSolver: await createCaptchaSolver(pluginConfig),
    analyticsEngine: await createAnalyticsEngine(pluginConfig),
    notifier: await createNotifier(pluginConfig),
  }

  return _plugins
}

/**
 * 获取插件实例
 */
export function getPlugins() {
  if (!_plugins) {
    _plugins = {
      contentProvider: new DefaultContentProvider(),
      captchaSolver: new ManualCaptchaSolver(),
      analyticsEngine: new DefaultAnalyticsEngine(),
      notifier: new ConsoleNotifier(),
    }
  }
  return _plugins
}

export function getContentProvider() { return getPlugins().contentProvider }
export function getCaptchaSolver() { return getPlugins().captchaSolver }
export function getAnalyticsEngine() { return getPlugins().analyticsEngine }
export function getNotifier() { return getPlugins().notifier }

// --- 工厂函数 ---

async function createContentProvider(pluginConfig, fullConfig) {
  const type = pluginConfig.content_provider || 'default'
  if (type === 'default') {
    const contentFile = pluginConfig.content_file || './data/posts.json'
    return new DefaultContentProvider(contentFile)
  }
  if (isCustomPath(type)) {
    try {
      const CustomClass = await loadCustomPlugin(type)
      return new CustomClass(pluginConfig.content_provider_options || {})
    } catch (err) {
      console.error(`[PluginManager] 加载自定义 content_provider 失败: ${err.message}，回退到默认`)
      return new DefaultContentProvider()
    }
  }
  console.warn(`[PluginManager] 未知 content_provider "${type}"，使用默认`)
  return new DefaultContentProvider()
}

async function createCaptchaSolver(pluginConfig) {
  const type = pluginConfig.captcha_solver || 'manual'
  if (type === 'manual') {
    return new ManualCaptchaSolver(pluginConfig.captcha_options || {})
  }
  if (isCustomPath(type)) {
    try {
      const CustomClass = await loadCustomPlugin(type)
      return new CustomClass(pluginConfig.captcha_options || {})
    } catch (err) {
      console.error(`[PluginManager] 加载自定义 captcha_solver 失败: ${err.message}，回退到手动`)
      return new ManualCaptchaSolver()
    }
  }
  console.warn(`[PluginManager] 未知 captcha_solver "${type}"，使用手动`)
  return new ManualCaptchaSolver()
}

async function createAnalyticsEngine(pluginConfig) {
  const type = pluginConfig.analytics_engine || 'default'
  if (type === 'default') {
    return new DefaultAnalyticsEngine(pluginConfig.stats_dir || './data/stats')
  }
  if (isCustomPath(type)) {
    try {
      const CustomClass = await loadCustomPlugin(type)
      return new CustomClass(pluginConfig.analytics_engine_options || {})
    } catch (err) {
      console.error(`[PluginManager] 加载自定义 analytics_engine 失败: ${err.message}，回退到默认`)
      return new DefaultAnalyticsEngine()
    }
  }
  console.warn(`[PluginManager] 未知 analytics_engine "${type}"，使用默认`)
  return new DefaultAnalyticsEngine()
}

async function createNotifier(pluginConfig) {
  const type = pluginConfig.notifier || 'console'
  if (type === 'console') return new ConsoleNotifier()
  if (type === 'webhook') return new WebhookNotifier(pluginConfig.notifier_options || {})
  if (isCustomPath(type)) {
    try {
      const CustomClass = await loadCustomPlugin(type)
      return new CustomClass(pluginConfig.notifier_options || {})
    } catch (err) {
      console.error(`[PluginManager] 加载自定义 notifier 失败: ${err.message}，回退到控制台`)
      return new ConsoleNotifier()
    }
  }
  console.warn(`[PluginManager] 未知 notifier "${type}"，使用控制台`)
  return new ConsoleNotifier()
}
