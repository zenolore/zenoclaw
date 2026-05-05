/**
 * 动态平台适配器/读取器加载器
 *
 * 根据 platforms/<name>/publisher.js 和 platforms/<name>/reader.js 的约定，
 * 自动发现并加载平台模块，无需在路由中硬编码注册表。
 *
 * 约定:
 *   - publisher 导出名: <Name>Adapter (如 XiaohongshuAdapter)
 *   - reader 导出名:    <Name>Reader  (如 XiaohongshuReader)
 *   - 首字母大写的驼峰命名
 *
 * 用法:
 *   import { loadAdapter, loadReader, listPlatforms } from '../platforms/loader.js'
 *   const AdapterClass = await loadAdapter('xiaohongshu')
 *   const ReaderClass  = await loadReader('xiaohongshu')
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 将平台名转为 PascalCase（xiaohongshu → Xiaohongshu）
 */
function toPascalCase(str) {
  return str.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase())
}

/**
 * 扫描 platforms 目录，返回所有可用平台名
 * @returns {string[]}
 */
export function listPlatforms() {
  return fs.readdirSync(__dirname)
    .filter(name => {
      if (name.startsWith('.') || name === 'base.js' || name === 'loader.js') return false
      const stat = fs.statSync(path.join(__dirname, name))
      return stat.isDirectory()
    })
}

/**
 * 动态加载平台发布适配器
 * @param {string} platform - 平台名（目录名，如 'xiaohongshu'）
 * @returns {Promise<typeof import('./base.js').BasePlatformAdapter>}
 */
export async function loadAdapter(platform) {
  const modulePath = path.join(__dirname, platform, 'publisher.js')
  if (!fs.existsSync(modulePath)) {
    const available = listPlatforms().filter(p =>
      fs.existsSync(path.join(__dirname, p, 'publisher.js'))
    )
    throw new Error(
      `不支持的平台: ${platform}，可用发布适配器: ${available.join(', ') || '(无)'}`
    )
  }

  const mod = await import(pathToFileURL(modulePath).href)
  const className = `${toPascalCase(platform)}Adapter`

  // 优先按约定名查找，fallback 到模块的第一个导出类
  const AdapterClass = mod[className] || mod.default || Object.values(mod).find(v => typeof v === 'function')
  if (!AdapterClass) {
    throw new Error(`平台 ${platform} 的 publisher.js 未导出有效的适配器类`)
  }
  return AdapterClass
}

/**
 * 动态加载平台数据读取器
 * @param {string} platform - 平台名（目录名，如 'xiaohongshu'）
 * @returns {Promise<Function>}
 */
export async function loadReader(platform) {
  const modulePath = path.join(__dirname, platform, 'reader.js')
  if (!fs.existsSync(modulePath)) {
    const available = listPlatforms().filter(p =>
      fs.existsSync(path.join(__dirname, p, 'reader.js'))
    )
    throw new Error(
      `不支持的平台读取器: ${platform}，可用读取器: ${available.join(', ') || '(无)'}`
    )
  }

  const mod = await import(pathToFileURL(modulePath).href)
  const className = `${toPascalCase(platform)}Reader`

  const ReaderClass = mod[className] || mod.default || Object.values(mod).find(v => typeof v === 'function')
  if (!ReaderClass) {
    throw new Error(`平台 ${platform} 的 reader.js 未导出有效的读取器类`)
  }
  return ReaderClass
}

/**
 * 动态加载平台浏览/养号执行器（platforms/<name>/browse.js）
 * 若平台没有专用 browse.js 则抛出错误，调用方应降级到 publisher adapter
 * @param {string} platform
 * @returns {Promise<Function>}
 */
export async function loadBrowser(platform) {
  const modulePath = path.join(__dirname, platform, 'browse.js')
  if (!fs.existsSync(modulePath)) {
    throw new Error(`平台 ${platform} 无专用 browse.js`)
  }

  const mod = await import(pathToFileURL(modulePath).href)
  const className = `${toPascalCase(platform)}Browser`

  const BrowserClass = mod[className] || mod.default || Object.values(mod).find(v => typeof v === 'function')
  if (!BrowserClass) {
    throw new Error(`平台 ${platform} 的 browse.js 未导出有效的浏览器类`)
  }
  return BrowserClass
}

/**
 * 获取平台元数据（homeUrl, loginUrl, interactSelectors）
 * 通过实例化适配器（不传 page）来读取静态元数据
 * @param {string} platform
 * @returns {Promise<{homeUrl: string|null, loginUrl: string|null, interactSelectors: object|null}>}
 */
export async function getPlatformMeta(platform) {
  try {
    const AdapterClass = await loadAdapter(platform)
    // 用 null page 创建临时实例仅用于读取元数据
    const tmp = new AdapterClass(null)
    return {
      homeUrl: tmp.getHomeUrl?.() || null,
      loginUrl: tmp.getLoginUrl?.() || null,
      interactSelectors: tmp.getInteractSelectors?.() || null,
    }
  } catch {
    return { homeUrl: null, loginUrl: null, interactSelectors: null }
  }
}
