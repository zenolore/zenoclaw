/**
 * 配置管理模块（单例）
 *
 * 提供全局配置访问，每个模块通过 getConfig() 获取完整配置，
 * 通过 cfg('mouse.click_wait_min', 50) 获取单个值（带默认值）。
 */

import { bp as _bp, loadBehaviorProfile } from './behavior-profile.js'

let _config = null

/**
 * 初始化配置（程序启动时调用一次）
 */
export function initConfig(config) {
  _config = config || {}
  // 自动加载行为特征录制数据（如果存在）
  loadBehaviorProfile()
}

/**
 * 获取完整配置对象
 */
export function getConfig() {
  return _config || {}
}

/**
 * 快捷读取配置值（支持点号路径 + 默认值）
 *
 * 用法:
 *   cfg('mouse.click_wait_min', 50)
 *   cfg('keyboard.delay_min', 100)
 *   cfg('browser.navigation_timeout', 60000)
 */
export function cfg(path, defaultValue) {
  // 优先级: 用户 yaml 配置 > 录制行为特征 > 硬编码默认值
  const config = _config || {}
  const keys = path.split('.')
  let value = config
  for (const key of keys) {
    if (value == null || typeof value !== 'object') {
      value = undefined
      break
    }
    value = value[key]
  }
  if (value !== undefined && value !== null && value !== '') return value

  // 用户未配置 → 查录制行为特征
  const bpValue = _bp(path)
  if (bpValue !== undefined) return bpValue

  return defaultValue
}

// ============================================================
// 预定义的默认值（与 config.example.yaml 一一对应）
// 所有模块的 fallback 值集中管理
// ============================================================
export const DEFAULTS = {
  // --- browser ---
  browser: {
    debug_port: 9222,
    startup_timeout: 30000,
    navigation_timeout: 60000,
    element_timeout: 30000,
    profile: 'Default',
  },

  // --- stealth ---
  stealth: {
    random_viewport: true,
    viewport_width_min: 1200,
    viewport_width_max: 1920,
    viewport_height_min: 800,
    viewport_height_max: 1080,
    disable_webrtc: true,
  },

  // --- tab ---
  tab: {
    close_after_operation: true,
    close_delay_min: 3000,
    close_delay_max: 15000,
    post_publish_browse_min: 30,
    post_publish_browse_max: 120,
  },

  // --- mouse ---
  mouse: {
    click_offset_percent: 10,
    click_wait_min: 50,
    click_wait_max: 200,
    move_offset_percent: 15,
    move_area_margin: 0.1,
    move_speed: 1.0,
  },

  // --- keyboard ---
  keyboard: {
    delay_min: 100,
    delay_max: 300,
    pause_chance: 0.1,
    pause_min: 2000,
    pause_max: 5000,
    look_interval_min: 10,
    look_interval_max: 20,
    look_delay_min: 500,
    look_delay_max: 1500,
    enter_delay_factor: 2.0,
    pre_type_delay_min: 300,
    pre_type_delay_max: 800,
    typo_enabled: false,
    typo_chance: 0.02,
    typo_correct_delay_min: 300,
    typo_correct_delay_max: 1000,
    typo_backspace_delay_min: 50,
    typo_backspace_delay_max: 150,
  },

  // --- scroll ---
  scroll: {
    times_min: 2,
    times_max: 6,
    distance_min: 100,
    distance_max: 500,
    down_bias: 0.7,
    pause_min: 800,
    pause_max: 2500,
  },

  // --- browse ---
  browse: {
    mouse_move_chance: 0.3,
    scroll_chance: 0.3,
    idle_chance: 0.4,
    scroll_distance_min: 50,
    scroll_distance_max: 300,
    action_interval_min: 2000,
    action_interval_max: 8000,
  },

  // --- timing ---
  timing: {
    action_delay_min: 3000,
    action_delay_max: 15000,
    post_navigation_delay_min: 2000,
    post_navigation_delay_max: 4000,
    total_duration_min: 1800,
    total_duration_max: 3600,
  },

  // --- upload ---
  upload: {
    wait_after_select_min: 2000,
    wait_after_select_max: 5000,
    processing_poll_interval: 5000,
    processing_poll_max_attempts: 12,
  },

  // --- screenshot ---
  screenshot: {
    on_each_step: false,
    on_error: true,
    on_before_publish: true,
    on_after_publish: true,
    full_page: false,
    save_dir: './logs/screenshots',
  },

  // --- steps ---
  steps: {
    open_page:      { browse_min: 60,  browse_max: 180 },
    upload_images:  { browse_min: 120, browse_max: 300 },
    input_title:    { browse_min: 60,  browse_max: 180 },
    input_content:  { browse_min: 120, browse_max: 300 },
    add_tags:       { browse_min: 60,  browse_max: 120, search_delay_min: 1000, search_delay_max: 2000, select_delay_min: 2000, select_delay_max: 4000 },
    publish:        { browse_min: 0,   browse_max: 0,   review_delay_min: 3000, review_delay_max: 8000, wait_after_min: 5000, wait_after_max: 15000 },
  },

  // --- retry ---
  retry: {
    enabled: true,
    max_attempts: 2,
    delay_min: 60000,
    delay_max: 300000,
  },

  // --- midscene（AI 视觉状态机）---
  midscene: {
    enabled: false,                // 是否启用 Midscene 视觉验证/操作
    model_name: 'glm-4v-flash',   // 视觉模型名称
    model_family: 'glm-v',        // 模型族（Midscene 合法值: glm-v, doubao-vision, qwen3-vl, gemini 等）
    base_url: 'https://open.bigmodel.cn/api/paas/v4',  // 不含 /chat/completions（SDK 自动追加）
    api_key: '',                   // 也可通过 MIDSCENE_MODEL_API_KEY 环境变量设置
    timeout: 30000,                // 单次 AI 调用超时
    verify_after_step: true,       // 关键步骤后是否 AI 验证
    fallback_on_selector_miss: true, // 选择器未命中时是否降级到 AI 操作
    auto_dismiss_popup: true,      // 是否自动用 AI 处理意外弹窗
  },
}
