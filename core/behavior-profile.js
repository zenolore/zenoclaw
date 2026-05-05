/**
 * 行为特征加载器
 *
 * 加载录制的行为特征数据，提供基于真实数据的随机值生成器
 * 替换硬编码的 randomDelay / 鼠标参数 / 打字速度
 *
 * 用法:
 *   import { loadBehaviorProfile, bp } from './behavior-profile.js'
 *   loadBehaviorProfile()  // 启动时调用一次
 *   bp('keyboard.delay_min')  // 读取录制参数（无数据时返回 undefined）
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getLogger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let _profile = null
let _configParams = null

/**
 * 加载行为特征文件
 * @param {string} [profilePath] - 自定义路径，默认 zenoclaw/data/behavior-profile.json
 */
export function loadBehaviorProfile(profilePath) {
  const log = getLogger()
  const filePath = profilePath
    || path.resolve(__dirname, '..', 'data', 'behavior-profile.json')

  try {
    if (!fs.existsSync(filePath)) {
      log.debug('[行为特征] 未找到录制数据，使用默认参数')
      return false
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    _profile = raw.profile || null
    _configParams = raw.configParams || null

    if (_configParams) {
      log.info(`[行为特征] 已加载录制数据 (${raw.rawEventCount} 事件)`)
      return true
    }
    return false
  } catch (err) {
    log.warn(`[行为特征] 加载失败: ${err.message}`)
    return false
  }
}

/**
 * 读取录制的配置参数（点号路径）
 * 返回 undefined 表示无数据，调用方应 fallback 到默认值
 *
 * @param {string} dotPath - 如 'keyboard.delay_min'
 * @returns {number|undefined}
 */
export function bp(dotPath) {
  if (!_configParams) return undefined
  const keys = dotPath.split('.')
  let value = _configParams
  for (const key of keys) {
    if (value == null || typeof value !== 'object') return undefined
    value = value[key]
  }
  return value !== undefined && value !== null ? value : undefined
}

/**
 * 获取完整的录制 profile
 */
export function getBehaviorProfile() {
  return _profile
}

/**
 * 获取完整的配置参数映射
 */
export function getBehaviorConfigParams() {
  return _configParams
}

/**
 * 基于高斯分布生成随机值（比均匀分布更像真人）
 * @param {number} mean - 均值
 * @param {number} std - 标准差
 * @param {number} [min] - 最小值裁剪
 * @param {number} [max] - 最大值裁剪
 */
export function gaussianRandom(mean, std, min, max) {
  // Box-Muller 变换
  let u1 = Math.random()
  let u2 = Math.random()
  while (u1 === 0) u1 = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  let value = mean + z * std

  if (min !== undefined) value = Math.max(value, min)
  if (max !== undefined) value = Math.min(value, max)
  return Math.round(value)
}

/**
 * 基于录制数据生成打字间隔
 * 有录制数据用高斯分布，无数据 fallback 到均匀随机
 */
export function realisticTypeDelay() {
  const mean = bp('keyboard.delay_mean')
  const std = bp('keyboard.delay_std')
  if (mean && std) {
    return gaussianRandom(mean, std, 30, 2000)
  }
  return undefined  // 调用方用默认逻辑
}

/**
 * 基于录制数据生成操作间隔
 */
export function realisticActionDelay() {
  const min = bp('timing.action_delay_min')
  const max = bp('timing.action_delay_max')
  if (min && max) {
    const mean = (min + max) / 2
    const std = (max - min) / 4
    return gaussianRandom(mean, std, min * 0.5, max * 2)
  }
  return undefined
}

/**
 * 基于录制数据生成点击按住时长
 */
export function realisticClickHold() {
  const mean = bp('mouse.click_hold_mean')
  const std = bp('mouse.click_hold_std')
  if (mean && std) {
    return gaussianRandom(mean, std, 20, 500)
  }
  return undefined
}
