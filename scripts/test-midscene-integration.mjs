/**
 * Midscene.js 集成测试脚本
 *
 * 测试内容：
 *   1. 模块加载验证（import 正常）
 *   2. 配置桥接验证（config → env 变量）
 *   3. agent 未启用时的容错（enabled=false）
 *   4. BasePlatformAdapter 新方法存在性
 *   5. safeMidsceneCall 容错（agent=null 时不崩溃）
 *   6. agent 已启用但无 API Key 时的容错
 *
 * 运行方式：node scripts/test-midscene-integration.mjs
 */

import { initConfig, cfg, DEFAULTS } from '../core/config.js'
import { createMidsceneAgent, safeMidsceneCall, isMidsceneAvailable } from '../core/midscene-agent.js'
import { BasePlatformAdapter, ERROR_CODES } from '../platforms/base.js'

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}`)
    failed++
  }
}

// ============================================================
// Test 1: 模块加载
// ============================================================
console.log('\n🔹 Test 1: 模块加载')
assert(typeof createMidsceneAgent === 'function', 'createMidsceneAgent 是函数')
assert(typeof safeMidsceneCall === 'function', 'safeMidsceneCall 是函数')
assert(typeof isMidsceneAvailable === 'function', 'isMidsceneAvailable 是函数')

// ============================================================
// Test 2: 配置默认值
// ============================================================
console.log('\n🔹 Test 2: 配置默认值')
assert(DEFAULTS.midscene !== undefined, 'DEFAULTS.midscene 存在')
assert(DEFAULTS.midscene.enabled === false, 'midscene.enabled 默认 false')
assert(DEFAULTS.midscene.model_name === 'glm-4v-flash', 'midscene.model_name 默认 glm-4v-flash')
assert(DEFAULTS.midscene.model_family === 'zhipu-glm', 'midscene.model_family 默认 zhipu-glm')
assert(DEFAULTS.midscene.verify_after_step === true, 'midscene.verify_after_step 默认 true')
assert(DEFAULTS.midscene.fallback_on_selector_miss === true, 'midscene.fallback_on_selector_miss 默认 true')
assert(DEFAULTS.midscene.auto_dismiss_popup === true, 'midscene.auto_dismiss_popup 默认 true')

// ============================================================
// Test 3: cfg() 读取 midscene 配置
// ============================================================
console.log('\n🔹 Test 3: cfg() 读取 midscene 配置')
initConfig({})  // 空配置，应该走默认值
assert(cfg('midscene.enabled', false) === false, 'cfg midscene.enabled = false')
assert(cfg('midscene.model_name', 'glm-4v-flash') === 'glm-4v-flash', 'cfg midscene.model_name')

initConfig({ midscene: { enabled: true, api_key: 'test-key-123' } })
assert(cfg('midscene.enabled', false) === true, 'cfg midscene.enabled = true（覆盖后）')
assert(cfg('midscene.api_key', '') === 'test-key-123', 'cfg midscene.api_key 读取正确')

// ============================================================
// Test 4: agent 未启用时返回 null
// ============================================================
console.log('\n🔹 Test 4: agent 未启用时的容错')
initConfig({})  // enabled = false
const agentDisabled = await createMidsceneAgent(null)
assert(agentDisabled === null, 'enabled=false 时 createMidsceneAgent 返回 null')

const available = await isMidsceneAvailable()
assert(available === false, 'enabled=false 时 isMidsceneAvailable 返回 false')

// ============================================================
// Test 5: safeMidsceneCall 容错（agent=null）
// ============================================================
console.log('\n🔹 Test 5: safeMidsceneCall 容错')
const r1 = await safeMidsceneCall(null, 'aiAssert', '测试')
assert(r1.success === false, 'agent=null 时 safeMidsceneCall 返回 success=false')
assert(r1.error === 'agent_not_available', 'agent=null 时 error = agent_not_available')

const r2 = await safeMidsceneCall(null, 'aiAct', '测试')
assert(r2.success === false, 'aiAct agent=null 也返回 false')

const r3 = await safeMidsceneCall(null, 'aiQuery', '测试')
assert(r3.success === false, 'aiQuery agent=null 也返回 false')

// ============================================================
// Test 6: BasePlatformAdapter 新方法存在
// ============================================================
console.log('\n🔹 Test 6: BasePlatformAdapter 新方法')
const proto = BasePlatformAdapter.prototype
assert(typeof proto.aiVerify === 'function', 'aiVerify 方法存在')
assert(typeof proto.aiOperate === 'function', 'aiOperate 方法存在')
assert(typeof proto.aiExtract === 'function', 'aiExtract 方法存在')
assert(typeof proto.smartClick === 'function', 'smartClick 方法存在')
assert(typeof proto.smartFindAndClick === 'function', 'smartFindAndClick 方法存在')
assert(typeof proto.checkForPopup === 'function', 'checkForPopup 方法存在')

// ============================================================
// Test 7: 现有方法未被破坏
// ============================================================
console.log('\n🔹 Test 7: 现有方法完整性')
const existingMethods = [
  'init', 'runStep', 'buildResult', 'navigateTo', 'browseAround',
  'browseForStep', 'actionPause', 'fillRemainingTime', 'warmupBrowse',
  'postPublishBrowse', 'takeScreenshot', 'click', 'type', 'paste',
  'scroll', 'uploadFile', 'findSelector', 'findElement', 'findByText',
  'clickElement', 'clickByText', 'humanTypeInElement', 'verifyBeforePublish',
  'waitForAny', 'waitForEditorReady', 'waitForUrlContains',
  'assertInputValue', 'assertRichTextContent', 'assertElementExists',
  'waitForElementGone', 'waitForPublishResult'
]
let existingOk = true
for (const m of existingMethods) {
  if (typeof proto[m] !== 'function') {
    console.log(`  ❌ 缺失方法: ${m}`)
    existingOk = false
    failed++
  }
}
if (existingOk) {
  assert(true, `全部 ${existingMethods.length} 个现有方法完好`)
}

// ============================================================
// Test 8: aiVerify/aiOperate/aiExtract 在 agent=null 时不崩溃
// ============================================================
console.log('\n🔹 Test 8: Adapter 方法 agent=null 容错')
initConfig({}) // midscene.enabled = false
// 创建一个 mock adapter（不需要真实 page）
class TestAdapter extends BasePlatformAdapter {
  constructor() {
    super(null) // null page
  }
}
const adapter = new TestAdapter()
// _midsceneAgent 应为 null
const v = await adapter.aiVerify('测试断言')
assert(v.success === true, 'aiVerify agent=null 返回 success=true（不阻塞）')

const o = await adapter.aiOperate('测试操作')
assert(o.success === false, 'aiOperate agent=null 返回 success=false')

const e = await adapter.aiExtract('测试提取')
assert(e.success === false, 'aiExtract agent=null 返回 success=false')

const p = await adapter.checkForPopup()
assert(p.hasPopup === false, 'checkForPopup agent=null 返回 hasPopup=false')

// ============================================================
// Test 9: ERROR_CODES 完整
// ============================================================
console.log('\n🔹 Test 9: ERROR_CODES 完整')
assert(ERROR_CODES.SELECTOR_MISS !== undefined, 'SELECTOR_MISS 存在')
assert(ERROR_CODES.LOGIN_EXPIRED !== undefined, 'LOGIN_EXPIRED 存在')

// ============================================================
// 总结
// ============================================================
console.log(`\n${'='.repeat(50)}`)
console.log(`📊 测试结果: ${passed} 通过, ${failed} 失败`)
console.log(`${'='.repeat(50)}`)

if (failed > 0) {
  console.log('❌ 存在失败项！')
  process.exit(1)
} else {
  console.log('✅ 全部通过！Midscene 集成验证完成。')
  process.exit(0)
}
