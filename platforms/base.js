import fs from 'fs'
import path from 'path'
import { getLogger } from '../core/logger.js'
import { cfg, getConfig } from '../core/config.js'
import { verifyPageContent } from '../core/vision-verify.js'
import { createMidsceneAgent, safeMidsceneCall } from '../core/midscene-agent.js'
import { normalizeEvolutionConfig } from '../evolution/runtime/evolution-config.js'
import { getFeatureFlags } from '../evolution/runtime/feature-flags.js'
import { createTraceWriter } from '../evolution/evidence/trace-writer.js'
import { createEvidenceBundle } from '../evolution/evidence/evidence-bundle.js'
import { createInterruptionGuard } from '../evolution/interruption/interruption-guard.js'
import { createVerifier } from '../evolution/verify/verifier.js'
import { createRepairProposer } from '../evolution/repair/repair-proposer.js'
import { createRuleMemory } from '../evolution/memory/rule-memory.js'
import { createPopupMemory } from '../evolution/memory/popup-memory.js'
import { createStrategyRegistry } from '../evolution/memory/strategy-registry.js'
import { createStrategyLoader } from '../evolution/runtime/strategy-loader.js'
import {
  verifyPageReady,
  verifyContentFilled,
  locateElement,
  detectPopup,
  judgePublishResult,
  smartDelay
} from '../core/vision-locate.js'
import { simulateIMEText, containsChinese } from '../core/ime-simulator.js'
import { injectOverlay, updateOverlay, removeOverlay } from '../core/status-overlay.js'
import {
  createHumanCursor,
  humanClick,
  humanType,
  humanPaste,
  humanScroll,
  humanUploadFile,
  simulateBrowsing,
  randomDelay,
  calculateRemainingWait,
  gaussianRandom,
  humanHesitateClick,
  humanReviewContent,
  humanRecoverPause,
  humanPasteViaClipboard,
  personaDelay
} from '../core/human.js'
import { initSessionPersona, getPersonaEvidence } from '../core/persona.js'
import { createEntryStrategy } from '../core/entry-strategy.js'

// ============================================================
// 结构化错误码（Adapter Error Codes）
// ============================================================

export const ERROR_CODES = {
  LOGIN_EXPIRED:    'LOGIN_EXPIRED',     // 未登录或登录已过期
  SELECTOR_MISS:    'SELECTOR_MISS',     // 关键选择器未命中
  UPLOAD_FAILED:    'UPLOAD_FAILED',     // 文件上传失败
  PUBLISH_BLOCKED:  'PUBLISH_BLOCKED',   // 发布被平台拦截（风控/审核）
  EDITOR_NOT_READY: 'EDITOR_NOT_READY',  // 编辑器未就绪
  NAVIGATION_FAILED:'NAVIGATION_FAILED', // 页面导航失败/超时
  UNKNOWN:          'UNKNOWN',           // 未分类错误
}

export class AdapterError extends Error {
  /**
   * @param {string} message - 错误描述
   * @param {string} code - ERROR_CODES 中的错误码
   * @param {string} [step] - 出错的步骤名称
   */
  constructor(message, code = ERROR_CODES.UNKNOWN, step = null) {
    super(message)
    this.name = 'AdapterError'
    this.code = code
    this.step = step
  }
}

/**
 * 平台适配器基类
 * 所有平台适配器继承此类，实现 publish() 方法
 *
 * 配置节对应关系:
 *   导航行为      → config.browser.navigation_timeout, config.timing.post_navigation_delay_*
 *   操作间隔      → config.timing.action_delay_*
 *   总发帖时长    → config.timing.total_duration_*
 *   标签页关闭    → config.tab.*
 *   截图策略      → config.screenshot.*
 *   步骤浏览时间  → config.steps.*
 */
// 步骤名称 → 中文浮窗文字（runStep 自动映射）
const STEP_LABEL_MAP = {
  warmupBrowse:     '正在预热浏览...',
  openPage:         '正在打开页面...',
  openPublishPage:  '正在打开发布页面...',
  selectSubreddit:  '正在选择社区...',
  inputTitle:       '正在输入标题...',
  inputContent:     '正在输入正文...',
  uploadImages:     '正在上传图片...',
  uploadCover:      '正在上传封面图...',
  addTags:          '正在添加标签...',
  selectQuestion:   '正在选择投稿问题...',
  declareOriginal:  '正在声明原创...',
  setScheduleTime:  '正在设置定时发布...',
  publish:          '正在发布...',
  submit:           '正在提交发布...',
  verifyPublish:    '正在验证发布结果...',
}

export class BasePlatformAdapter {
  constructor(page) {
    this.page = page
    this.cursor = null
    this.log = getLogger()
    this.startTime = null
    this._stepLog = []
    this._assertionFailures = 0
    this._midsceneAgent = null  // Midscene AI 视觉 agent
    this._evolutionTraceWriter = null
    this._evolutionEvidenceBundle = null
    this._evolutionInterruptionGuard = null
    this._evolutionVerifier = null
    this._evolutionRepairProposer = null
    this._evolutionRuleMemory = null
    this._evolutionPopupMemory = null
    this._evolutionStrategyRegistry = null
    this._evolutionFlags = null
  }

  /**
   * 初始化 cursor（需要在 page 准备好后调用）
   */
  async init() {
    this.cursor = await createHumanCursor(this.page)
    this.startTime = Date.now()
    this._stepLog = []
    this._assertionFailures = 0

    // 初始化 session persona（整段会话使用同一人格，确保行为节奏一致）
    try {
      const personaInfo = initSessionPersona()
      this.log.info(`[Persona] 当前会话：${personaInfo.label}（${personaInfo.key}）`)
    } catch (err) {
      this.log.warn(`[Persona] 初始化跳过: ${err.message}`)
    }

    // 注入状态浮窗（顶部居中显示当前操作步骤）
    await injectOverlay(this.page).catch(() => {})

    // 初始化 Midscene AI 视觉 agent（如果已启用）
    try {
      this._midsceneAgent = await createMidsceneAgent(this.page)
    } catch (err) {
      this.log.warn(`[Midscene] 初始化跳过: ${err.message}`)
      this._midsceneAgent = null
    }
  }

  // ============================================================
  // 真人化行为：多入口导航 / 通读检查 / 人化错误恢复
  // ============================================================

  /**
   * 通过多入口策略导航到发布页（替代直接 goto）
   *
   * 平台通过实现 `getCreatorEntryStrategies()` 返回入口候选列表：
   *   [{ key, label, weight, run: async (adapter) => { ... } }, ...]
   *
   * 候选 run 函数内可调用 this.* 的辅助方法（hover/click/wait）
   * 推荐先确保已经在 home 页或登录态页，再调用本方法。
   *
   * @param {object} [options]
   * @param {string} [options.fallbackUrl] - 全部失败兜底；默认 this.publishUrl
   * @param {Array<object>} [options.candidates] - 自定义候选；默认 this.getCreatorEntryStrategies()
   * @returns {Promise<{entry, attempts, status}>}
   */
  async navigateToPublishViaEntry(options = {}) {
    const candidates = options.candidates
      || (typeof this.getCreatorEntryStrategies === 'function' ? this.getCreatorEntryStrategies() : [])
      || []
    const fallbackUrl = options.fallbackUrl || this.publishUrl

    if (!Array.isArray(candidates) || candidates.length === 0) {
      this.log.debug('[多入口] 平台未声明入口候选，直接 goto 兜底')
      if (fallbackUrl) await this.navigateTo(fallbackUrl)
      this.addStepEvidence('entry_strategy', { status: 'fallback', reason: 'no_candidates' })
      return { entry: null, attempts: 0, status: 'fallback', reason: 'no_candidates' }
    }

    const platformName = (typeof this.getPlatformName === 'function')
      ? this.getPlatformName()
      : (this.platformName || 'unknown')

    const strategy = createEntryStrategy({ platform: platformName, log: this.log })
    const result = await strategy.execute(this, candidates, { fallbackUrl })
    this.addStepEvidence('entry_strategy', {
      ...result,
      persona: getPersonaEvidence(),
      platform: platformName
    })
    return result
  }

  /**
   * 通读检查：写完所有内容、提交前调用一次。
   * 由调用方在 publish 流程中显式调用，例如：
   *   await this.runStep('reviewBeforeSubmit', () => this.reviewBeforeSubmit())
   *
   * @param {object} [options] - 透传给 humanReviewContent
   */
  async reviewBeforeSubmit(options = {}) {
    if (!this.page) return
    try {
      await humanReviewContent(this.page, this.cursor, options)
      this.addStepEvidence('review_before_submit', {
        ...getPersonaEvidence(),
        ...options
      })
    } catch (err) {
      this.log.debug(`[通读检查] 跳过: ${err.message}`)
    }
  }

  /**
   * 人化错误恢复：在重试或决定升级前先做"读 → 滚 → 等"
   * 不改变控制流，仅插入合理停顿与可选草稿保存
   */
  async recoverHumanly(options = {}) {
    if (!this.page) return
    try {
      await humanRecoverPause(this.page, this.cursor, options)
    } catch (err) {
      this.log.debug(`[人化恢复] 跳过: ${err.message}`)
    }
  }

  /**
   * 真实 paste 输入封装：替代部分 humanPaste 场景
   * 富文本编辑器若强制依赖 paste 事件可走此路径
   */
  async humanPasteReal(selector, text) {
    return humanPasteViaClipboard(this.page, selector, text)
  }

  /**
   * 入口行为常用工具：hover 一个元素再 click
   * 给入口策略 run 函数复用
   */
  async hesitateClickSelector(selector) {
    if (!this.cursor) return
    return humanHesitateClick(this.cursor, selector, this.page, { force: true })
  }

  /**
   * 在入口候选 run 函数里复用：等元素出现并 hover 后再点
   */
  async clickEntrySelector(selector, { hover = true } = {}) {
    const elementTimeout = cfg('browser.element_timeout', 30000)
    await this.page.waitForSelector(selector, { visible: true, timeout: elementTimeout })
    if (hover) {
      try { await this.cursor?.move?.(selector, { paddingPercentage: 12 }) } catch { /* ignore */ }
      await personaDelay(180, 500)
    }
    await this.cursor.click(selector, {
      paddingPercentage: 12,
      waitForClick: Math.floor(gaussianRandom(60, 220))
    })
  }

  // ============================================================
  // 状态指示器：editor ready / publishOk
  // 平台 selectors.js 声明 STATE_INDICATORS = { editor, publishOk }
  // 三元组 { urlPatterns?, selectors?, texts? }，任一类命中即视为命中
  // ============================================================

  async _matchStateIndicators(indicators, options = {}) {
    const ind = indicators || {}
    const urlPatterns = Array.isArray(ind.urlPatterns) ? ind.urlPatterns : []
    const selectors = Array.isArray(ind.selectors) ? ind.selectors : []
    const texts = Array.isArray(ind.texts) ? ind.texts : []
    const timeoutMs = Math.max(0, options.timeoutMs ?? 8000)
    const pollMs = Math.max(100, options.pollMs ?? 500)
    const requireAll = !!options.requireAll
    const start = Date.now()
    let lastHits = { urlHit: null, selectorHit: null, textHit: null }

    const matchOnce = async () => {
      const hits = { urlHit: null, selectorHit: null, textHit: null }
      try {
        const url = this.page?.url?.() || ''
        for (const p of urlPatterns) {
          if (!p) continue
          if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
            try { if (new RegExp(p.slice(1, -1)).test(url)) { hits.urlHit = p; break } } catch { /* ignore */ }
          } else if (url.includes(p)) {
            hits.urlHit = p; break
          }
        }
      } catch { /* ignore */ }

      for (const sel of selectors) {
        try {
          const el = await this.page.$(sel)
          if (el) { hits.selectorHit = sel; break }
        } catch { /* ignore */ }
      }

      if (texts.length > 0) {
        try {
          const bodyText = await this.page.evaluate(() => document.body?.innerText || '')
          for (const t of texts) {
            if (t && bodyText.includes(t)) { hits.textHit = t; break }
          }
        } catch { /* ignore */ }
      }
      return hits
    }

    do {
      const hits = await matchOnce()
      lastHits = hits
      const anyHit = hits.urlHit || hits.selectorHit || hits.textHit
      const allKindsHit = (!urlPatterns.length || hits.urlHit)
        && (!selectors.length || hits.selectorHit)
        && (!texts.length || hits.textHit)
      const requestedKinds = urlPatterns.length || selectors.length || texts.length
      const ready = requireAll ? (requestedKinds && allKindsHit) : !!anyHit
      if (ready) return { ready: true, hits, ms: Date.now() - start }
      if (Date.now() - start >= timeoutMs) break
      await new Promise(r => setTimeout(r, pollMs))
    } while (true)

    return { ready: false, hits: lastHits, ms: Date.now() - start }
  }

  /**
   * 判断当前是否在编辑器就绪状态。失败默认抛错（强依赖）。
   */
  async assertEditorReady(indicators, options = {}) {
    const { throwOnFail = true, timeoutMs = 15000, ...rest } = options
    const result = await this._matchStateIndicators(indicators, { timeoutMs, ...rest })
    this.addStepEvidence('editor_ready_check', {
      ready: result.ready,
      hits: result.hits,
      durationMs: result.ms,
      url: this.page?.url?.() || ''
    })
    if (!result.ready) {
      this.log.error(`[状态] editor ready 未命中（${result.ms}ms），URL=${this.page?.url?.() || ''}`)
      if (throwOnFail) {
        await this.conditionalScreenshot('editor_ready_fail', 'error').catch(() => {})
        throw new Error(`${this.platformName || 'platform'} 编辑页未就绪（URL/selector/text 三元组均未命中）`)
      }
    } else {
      this.log.info(`[状态] editor ready 命中：${JSON.stringify(result.hits)}`)
    }
    return result
  }

  /**
   * 等待发布成功的状态命中。失败不抛错，返回 ready=false 让调用方降级到视觉/截图。
   */
  async waitForPublishSuccess(indicators, options = {}) {
    const { timeoutMs = 20000, pollMs = 800, ...rest } = options
    const result = await this._matchStateIndicators(indicators, { timeoutMs, pollMs, ...rest })
    this.addStepEvidence('publish_success_check', {
      ready: result.ready,
      hits: result.hits,
      durationMs: result.ms,
      url: this.page?.url?.() || ''
    })
    if (result.ready) {
      this.log.info(`[状态] 发布成功命中：${JSON.stringify(result.hits)}`)
    } else {
      this.log.warn(`[状态] 发布成功未命中（${result.ms}ms），需视觉/截图二次确认`)
    }
    return result
  }

  // ============================================================
  // Step 追踪（Pipeline Step Monitoring）
  // ============================================================

  /**
   * 包装一个步骤，自动记录 stepName / status / duration / evidence
   * @param {string} name - 步骤名称
   * @param {Function} fn - 步骤执行函数
   */
  async runStep(name, fn) {
    const evolution = this._getEvolutionRuntime()
    let evolutionStep = null
    const entry = {
      stepName: name,
      status: 'running',
      startedAt: new Date().toISOString(),
      evidence: [],
      error: null,
      durationMs: 0
    }
    this._stepLog.push(entry)
    // 更新状态浮窗（英文 stepName → 中文提示）
    const label = STEP_LABEL_MAP[name] || name
    await this.showStatus(label).catch(() => {})
    if (evolution?.traceWriter && evolution?.evidenceBundle) {
      evolutionStep = this._safeEvolutionCall(() => {
        const step = evolution.traceWriter.startStep(name, { stepLabel: label })
        evolution.evidenceBundle.recordStepMeta(step, { stepLabel: label })
        return step
      })
    }
    try {
      await this._tryHandleStepInterruption(name, evolution, 'before_step')
      await fn()
      await this._tryHandleStepInterruption(name, evolution, 'after_step')
      const verification = await this._tryShadowVerifyStep(name, evolution)
      const verificationRecovered = await this._tryRecoverFailedVerification(name, fn, evolution, verification)
      if (verificationRecovered) {
        this.addStepEvidence('verification_recovered', { stepName: name })
      }
      entry.status = 'passed'
      if (evolution && evolutionStep) {
        this._safeEvolutionCall(() => evolution.traceWriter.finishStep(evolutionStep, 'success'))
      }
    } catch (err) {
      const recovered = await this._tryRecoverInterruptedStep(name, fn, evolution, err)
      if (recovered) {
        entry.status = 'passed'
        entry.error = null
        this.addStepEvidence('interruption_recovered', { stepName: name })
        if (evolution && evolutionStep) {
          this._safeEvolutionCall(() => evolution.traceWriter.finishStep(evolutionStep, 'recovered_by_interruption_guard'))
        }
        return
      }
      entry.status = 'failed'
      entry.error = err.message
      if (evolution && evolutionStep) {
        this._safeEvolutionCall(() => evolution.traceWriter.failStep(evolutionStep, err))
      }
      await this._tryProposeRepairForFailure(name, evolution, err, evolutionStep)
      throw err
    } finally {
      entry.finishedAt = new Date().toISOString()
      entry.durationMs = Date.now() - new Date(entry.startedAt).getTime()
      if (evolution?.traceWriter) {
        this._safeEvolutionCall(() => evolution.traceWriter.flush())
      }
    }
  }

  /**
   * 向当前步骤追加证据
   * @param {string} key - 证据键（如 'assert:标题', 'publishResult'）
   * @param {*} value - 证据值
   */
  addStepEvidence(key, value) {
    // 2026-04-15 安全加固：兼容未接入 runStep() 的老平台。
    // 修改原因：部分历史平台没有步骤包装，导致发布校验虽然执行了，但 step_report 中没有证据可追踪。
    // 修改策略：首次写证据时自动创建一个 runtimeEvidence 虚拟步骤，仅承载证据，不改变原有发布流程控制。
    // 回退方式：删除下方 synthetic step 创建逻辑，即可恢复“无 runStep 时不记录证据”的旧行为。
    if (!this._stepLog || this._stepLog.length === 0) {
      this._stepLog = [{
        stepName: 'runtimeEvidence',
        status: 'passed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        evidence: [],
        error: null,
        durationMs: 0,
      }]
    }
    const current = this._stepLog[this._stepLog.length - 1]
    if (current) {
      current.evidence.push({ key, value, at: new Date().toISOString() })
    }
  }

  /**
   * 获取完整步骤报告
   * @returns {Array} 步骤执行记录
   */
  getStepReport() {
    return this._stepLog || []
  }

  _getEvolutionRuntime() {
    if ((this._evolutionTraceWriter && this._evolutionEvidenceBundle) || this._evolutionInterruptionGuard || this._evolutionVerifier || this._evolutionRepairProposer || this._evolutionRuleMemory) {
      return {
        traceWriter: this._evolutionTraceWriter,
        evidenceBundle: this._evolutionEvidenceBundle,
        interruptionGuard: this._evolutionInterruptionGuard,
        verifier: this._evolutionVerifier,
        repairProposer: this._evolutionRepairProposer,
        ruleMemory: this._evolutionRuleMemory,
        popupMemory: this._evolutionPopupMemory,
        strategyRegistry: this._evolutionStrategyRegistry
      }
    }

    const config = normalizeEvolutionConfig(getConfig())
    const flags = getFeatureFlags(config)
    this._evolutionFlags = flags

    if (flags.traceEnabled !== true && flags.evidenceEnabled !== true && flags.interruptionGuardEnabled !== true && flags.verifierEnabled !== true && flags.repairAgentEnabled !== true && flags.ruleMemoryEnabled !== true) {
      return null
    }

    if (flags.traceEnabled === true || flags.evidenceEnabled === true) {
      this._evolutionTraceWriter = createTraceWriter({
        config,
        flags,
        platform: this.getPlatformName(),
        taskType: 'publish'
      })
      this._evolutionEvidenceBundle = createEvidenceBundle({
        config,
        flags,
        traceId: this._evolutionTraceWriter.traceId,
        platform: this.getPlatformName(),
        taskType: 'publish'
      })
    }

    if (flags.ruleMemoryEnabled === true) {
      this._evolutionRuleMemory = createRuleMemory({
        config,
        flags,
        platform: this.getPlatformName()
      })
      this._evolutionPopupMemory = createPopupMemory({
        config,
        flags,
        platform: this.getPlatformName(),
        taskType: 'publish'
      })
      this._evolutionStrategyRegistry = createStrategyRegistry({
        config,
        flags
      })
    }

    if (flags.interruptionGuardEnabled === true) {
      const strategyLoader = createStrategyLoader({
        config,
        flags,
        platform: this.getPlatformName()
      })
      this._evolutionInterruptionGuard = createInterruptionGuard({
        page: this.page,
        platform: this.getPlatformName(),
        flags,
        config,
        traceWriter: this._evolutionTraceWriter,
        activeRules: strategyLoader.loadActiveInterruptionRules(),
        popupMemory: this._evolutionPopupMemory,
        ruleMemory: this._evolutionRuleMemory,
        strategyRegistry: this._evolutionStrategyRegistry,
        log: this.log
      })
    }

    if (flags.verifierEnabled === true) {
      this._evolutionVerifier = createVerifier({
        page: this.page,
        platform: this.getPlatformName(),
        flags,
        config,
        traceWriter: this._evolutionTraceWriter,
        log: this.log
      })
    }

    if (flags.repairAgentEnabled === true) {
      this._evolutionRepairProposer = createRepairProposer({
        platform: this.getPlatformName(),
        taskType: 'publish',
        flags,
        config,
        traceWriter: this._evolutionTraceWriter,
        log: this.log
      })
    }

    return {
      traceWriter: this._evolutionTraceWriter,
      evidenceBundle: this._evolutionEvidenceBundle,
      interruptionGuard: this._evolutionInterruptionGuard,
      verifier: this._evolutionVerifier,
      repairProposer: this._evolutionRepairProposer,
      ruleMemory: this._evolutionRuleMemory,
      popupMemory: this._evolutionPopupMemory,
      strategyRegistry: this._evolutionStrategyRegistry
    }
  }

  async _tryShadowVerifyStep(name, evolution) {
    if (!evolution?.verifier) return null
    try {
      const result = await evolution.verifier.verifyStep(name)
      const payload = typeof result?.toJSON === 'function' ? result.toJSON() : result
      this.addStepEvidence('shadow_verification', payload)
      await this._tryProposeRepairForVerification(name, evolution, payload)
      return result
    } catch (err) {
      this.log.debug(`[Evolution] shadow verifier skipped: ${err.message}`)
      return null
    }
  }

  async _tryHandleStepInterruption(name, evolution, reason) {
    if (!evolution?.interruptionGuard) return null
    const guardConfig = evolution.interruptionGuard.guardConfig || {}
    if (reason === 'before_step' && guardConfig.beforeStepCheck === false) return null
    if (reason === 'after_step' && guardConfig.afterStepCheck !== true) return null
    if (reason === 'on_error' && guardConfig.onErrorCheck === false) return null
    try {
      const result = await evolution.interruptionGuard.handleCurrentInterruption(name, reason)
      if (result?.handled) {
        this.addStepEvidence(`interruption_${reason}_handled`, result.detection)
      }
      return result
    } catch (err) {
      this.log.debug(`[Evolution] interruption ${reason} skipped: ${err.message}`)
      return null
    }
  }

  async _tryRecoverFailedVerification(name, fn, evolution, verification) {
    const payload = typeof verification?.toJSON === 'function' ? verification.toJSON() : verification
    if (!payload || payload.passed === true) return false
    const handled = await this._tryHandleStepInterruption(name, evolution, 'verification_failed')
    if (!handled?.handled) return false
    try {
      await fn()
      await this._tryShadowVerifyStep(name, evolution)
      return true
    } catch (err) {
      this._safeEvolutionCall(() => evolution.traceWriter?.addEvent?.('step_retry_after_verification_failed', {
        stepName: name,
        retryError: err?.message || String(err || '')
      }))
      return false
    }
  }

  async _tryProposeRepairForVerification(name, evolution, verification) {
    if (!evolution?.repairProposer || verification?.passed === true) return null
    try {
      const proposal = evolution.repairProposer.proposeFromVerification({
        ...verification,
        stepName: verification?.stepName || name
      })
      if (proposal) this.addStepEvidence('repair_proposal', proposal)
      return proposal
    } catch (err) {
      this.log.debug(`[Evolution] repair proposal skipped: ${err.message}`)
      return null
    }
  }

  async _tryProposeRepairForFailure(name, evolution, error, evolutionStep) {
    if (!evolution?.repairProposer) return null
    try {
      const failure = {
        failureId: evolutionStep?.stepId || null,
        traceId: evolutionStep?.traceId || evolution?.traceWriter?.traceId || null,
        stepId: evolutionStep?.stepId || null,
        platform: this.getPlatformName(),
        taskType: 'publish',
        stepName: name,
        errorCode: error?.code || null,
        errorMessage: error?.message || String(error || ''),
        artifactIds: [],
        metadata: {
          source: 'runStep_failure'
        }
      }
      const proposal = evolution.repairProposer.proposeFromFailure(failure)
      if (proposal) this.addStepEvidence('repair_proposal', proposal)
      return proposal
    } catch (err) {
      this.log.debug(`[Evolution] failure repair proposal skipped: ${err.message}`)
      return null
    }
  }

  async _tryRecoverInterruptedStep(name, fn, evolution, originalError) {
    if (!evolution?.interruptionGuard) return false
    const result = await this._tryHandleStepInterruption(name, evolution, 'on_error')
    if (!result?.handled) return false

    try {
      await fn()
      this._safeEvolutionCall(() => evolution.traceWriter?.addEvent?.('step_retried_after_interruption', {
        stepName: name,
        originalError: originalError?.message || String(originalError || '')
      }))
      return true
    } catch (retryError) {
      this._safeEvolutionCall(() => evolution.traceWriter?.addEvent?.('step_retry_after_interruption_failed', {
        stepName: name,
        originalError: originalError?.message || String(originalError || ''),
        retryError: retryError?.message || String(retryError || '')
      }))
      return false
    }
  }

  _safeEvolutionCall(fn) {
    try {
      return fn()
    } catch (err) {
      if (this._evolutionFlags?.failOpen === false) {
        throw err
      }
      this.log.debug(`[Evolution] observe-only hook skipped: ${err.message}`)
      return null
    }
  }

  // ============================================================
  // 统一返回结构（Unified Result Builder）
  // ============================================================

  /**
   * 构建统一的 publish 返回结构
   * 子类在 publish() 末尾调用此方法，确保返回格式一致
   *
   * @param {boolean} success - 是否成功
   * @param {string|Error} messageOrError - 描述信息或 Error 对象
   * @param {object} [extra] - 额外字段（如 errorCode, publishedUrl）
   * @returns {{success, message, publishedUrl, step_report, errorCode}}
   */
  buildResult(success, messageOrError, extra = {}) {
    // 统一清理状态浮窗（无论成功/失败/页面跳转）
    this.hideStatus().catch(() => {})

    const isErr = messageOrError instanceof Error
    const message = isErr ? messageOrError.message : messageOrError
    const errCode = extra.errorCode
      || (isErr && messageOrError.code) || null
    const errStep = (isErr && messageOrError.step) || null

    // 2026-04-26 优先级：extra.publishedUrl > captureRealPostUrl 抓到的真实文章页 URL > page.url() fallback
    //   原因：发布完成后子类一般会跳到平台首页或作品列表，page.url() 只能拿到列表/首页 URL，
    //         不利于后续 readStatsViaZenoclaw 抓阅读量。captureRealPostUrl() 在子类里实现，
    //         发布成功后从作品列表 DOM 找到刚发布文章的真实 href 写到 this._capturedPublishedUrl。
    let publishedUrl = extra.publishedUrl || this._capturedPublishedUrl || null
    if (success && !publishedUrl) {
      try {
        const url = this.page.url()
        // 排除发布页本身的 URL（说明未跳转）
        if (url && !url.includes('/write') && !url.includes('/publish') && !url.includes('/upload') && !url.includes('/edit')) {
          publishedUrl = url
        }
      } catch { /* page may be closed */ }
    }

    return {
      success,
      message,
      publishedUrl,
      errorCode: errCode,
      errorStep: errStep,
      step_report: this.getStepReport(),
    }
  }

  /**
   * 重新初始化 cursor（page 被重新赋值后必须调用）
   * 场景：微信/搜狐 step1 切换到新标签页后 this.page 变了
   */
  async reinitCursor() {
    try {
      this.cursor = await createHumanCursor(this.page)
      this.log.debug('cursor 已重新初始化')
    } catch (e) {
      this.log.warn(`cursor 重新初始化失败: ${e.message}，后续点击将使用 fallback`)
      this.cursor = null
    }
  }

  /**
   * 子类必须实现：执行发帖操作
   * @param {object} post - 帖子数据 { title, content, images, tags }
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async publish(post) {
    throw new Error('子类必须实现 publish() 方法')
  }

  // ============================================================
  // 平台元数据（子类可重写）
  // ============================================================

  /** 平台首页 URL（养号浏览用） */
  getHomeUrl() { return null }

  /** 平台登录 URL */
  getLoginUrl() { return null }

  /** 平台互动选择器（数组式 fallback 格式） */
  getInteractSelectors() { return null }

  /** 浏览时帖子元素选择器（用于点击帖子→阅读→返回） */
  getBrowsePostSelector() { return null }

  /** 平台名称 */
  getPlatformName() { return this.platformName || 'unknown' }

  // ============================================================
  // 真实文章页 URL 抓取（2026-04-26 新增，子类按需重写）
  // ============================================================
  //
  // 背景:
  //   发布成功后页面通常跳到「作品列表」或「平台首页」，page.url() 拿到的不是文章页 URL，
  //   导致下游 readStatsViaZenoclaw 抓不到阅读/赞/评数据。
  //
  // 约定:
  //   1) 子类在 publish() 流程 step6 成功后、navigateTo(getHomeUrl()) 之前调用 this.captureRealPostUrl(post)
  //   2) 子类实现里把抓到的 URL 写到 this._capturedPublishedUrl
  //   3) 失败时不抛错（仅 warn），不影响发布结果
  //
  // buildResult() 的 publishedUrl 字段优先级:
  //   extra.publishedUrl > this._capturedPublishedUrl > page.url() fallback
  //
  /**
   * 子类可重写：发布成功后从作品列表 DOM 抓取真实文章页 URL，写入 this._capturedPublishedUrl
   * 默认实现：不做任何事（保持兼容性）
   * @param {object} post - 标题用于 DOM 匹配
   * @returns {Promise<string|null>} 抓到的 URL 或 null
   */
  async captureRealPostUrl(/* post */) {
    return null
  }

  /** 页面导航超时（毫秒），海外平台子类可覆盖增大 */
  getNavigationTimeout() { return cfg('browser.navigation_timeout', 60000) }

  /** 等待页面元素出现超时（毫秒），海外平台子类可覆盖增大 */
  getElementTimeout() { return cfg('browser.element_timeout', 30000) }

  // ============================================================
  // 导航
  // ============================================================

  /**
   * 导航到指定 URL 并等待加载完成
   *
   * 配置项:
   *   browser.navigation_timeout          — 页面加载超时
   *   timing.post_navigation_delay_min/max — 加载后等待
   */
  async navigateTo(url, { waitUntil, pageDescription, expectedElements } = {}) {
    this.log.info(`导航到: ${url}`)
    const navTimeout = this.getNavigationTimeout()
    const strategy = waitUntil || cfg('browser.wait_until', 'networkidle2')
    await this.page.goto(url, { waitUntil: strategy, timeout: navTimeout })

    const delayMin = cfg('timing.post_navigation_delay_min', 2000)
    const delayMax = cfg('timing.post_navigation_delay_max', 4000)
    const targetDelay = Math.floor(gaussianRandom(delayMin, delayMax))
    const stepStart = Date.now()

    // 视觉验证页面就绪（耗时计入延迟）
    if (pageDescription) {
      const vr = await verifyPageReady(this.page, pageDescription, expectedElements || [])
      this.addStepEvidence('vision_page_ready', { url, ...vr })
      if (!vr.ready) {
        this.log.warn(`[视觉验证] 页面可能未完整加载，等待额外 2s 后继续`)
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    // 智能计时：视觉检测耗时已计入，只等剩余时间
    await smartDelay(stepStart, targetDelay)
    this.log.info('页面加载完成')

    // 页面导航后重新注入状态浮窗（导航会丢失之前的 DOM）
    // 如果已调用 hideStatus()（发布完成），不再重新注入
    if (!this._overlayDismissed) {
      await injectOverlay(this.page).catch(() => {})
    }
  }

  // ============================================================
  // 浏览模拟
  // ============================================================

  /**
   * 等待并模拟浏览（填充时间，让操作看起来像真人）
   * @param {number} minSeconds - 最短浏览时间（秒）
   * @param {number} maxSeconds - 最长浏览时间（秒）
   */
  async browseAround(minSeconds, maxSeconds) {
    const durationMs = Math.floor(
      gaussianRandom(minSeconds * 1000, maxSeconds * 1000)
    )
    await simulateBrowsing(this.page, this.cursor, durationMs)
  }

  /**
   * 按步骤名称读取配置的浏览时间并模拟浏览
   *
   * 配置项: steps.<stepName>.browse_min/max
   *
   * @param {string} stepName - 步骤名称（对应 config.steps 下的 key）
   */
  async browseForStep(stepName) {
    const browseMin = cfg(`steps.${stepName}.browse_min`, 60)
    const browseMax = cfg(`steps.${stepName}.browse_max`, 180)
    await this.browseAround(browseMin, browseMax)
  }

  // ============================================================
  // 操作间隔
  // ============================================================

  /**
   * 操作间的随机等待
   *
   * 配置项: timing.action_delay_min/max
   */
  async actionPause() {
    const delayMin = cfg('timing.action_delay_min', 3000)
    const delayMax = cfg('timing.action_delay_max', 15000)
    await randomDelay(delayMin, delayMax)
  }

  // ============================================================
  // 总时长补足
  // ============================================================

  /**
   * 在发帖流程最后，补足剩余时间以达到目标总时长
   *
   * 配置项: timing.total_duration_min/max
   */
  async fillRemainingTime() {
    if (!this.startTime) return

    const remaining = calculateRemainingWait(this.startTime)
    if (remaining > 5000) {
      this.log.info(`补足剩余时间: ${(remaining / 1000 / 60).toFixed(1)} 分钟`)
      await simulateBrowsing(this.page, this.cursor, remaining)
    }
  }

  // ============================================================
  // 发布后行为
  // ============================================================

  /**
   * 发帖前预热浏览：先导航到平台首页，模拟浏览 feed 一段时间
   * 让平台看到自然的「浏览→发帖」行为链，而非直接访问发帖页
   *
   * 配置项:
   *   timing.warmup_browse_enabled — 是否启用
   *   timing.warmup_browse_min/max — 预热浏览时间（秒）
   */
  async warmupBrowse() {
    const enabled = cfg('timing.warmup_browse_enabled', true)
    if (!enabled) {
      this.log.debug('预热浏览已禁用，跳过')
      return
    }

    const homeUrl = this.getHomeUrl?.()
    if (!homeUrl) {
      this.log.debug('平台未配置首页 URL，跳过预热浏览')
      return
    }

    const browseMin = cfg('timing.warmup_browse_min', 300)
    const browseMax = cfg('timing.warmup_browse_max', 900)
    const durationMs = Math.floor(gaussianRandom(browseMin * 1000, browseMax * 1000))

    this.log.info(`[预热浏览] 导航到首页: ${homeUrl}，浏览 ${Math.floor(durationMs / 1000)}s`)
    await this.navigateTo(homeUrl)
    const postSelector = this.getBrowsePostSelector()
    await simulateBrowsing(this.page, this.cursor, durationMs, { postSelector })
    this.log.info('[预热浏览] 完成')
  }

  /**
   * 发布成功后，在页面上继续浏览一段时间再结束
   *
   * 配置项: tab.post_publish_browse_min/max
   */
  async postPublishBrowse() {
    const browseMin = cfg('tab.post_publish_browse_min', 30)
    const browseMax = cfg('tab.post_publish_browse_max', 120)
    if (browseMax > 0) {
      this.log.info('发布后继续浏览...')
      await this.browseAround(browseMin, browseMax)
    }
  }

  /**
   * 2026-04-15 安全加固：弱校验平台统一改走“保守发布结果校验”。
   *
   * 修改原因：
   * - 多个平台在点击发布后仅做固定等待，容易把“显式失败”误判为成功。
   * - 这会导致后续继续执行 fillRemainingTime / postPublishBrowse，形成伪成功链路。
   *
   * 修改策略：
   * - 这里只拦截“页面已明确给出失败信号”的情况（文本失败提示）。
   * - 如果结果是 unknown，则维持旧行为，不直接判失败，避免因页面改版或 toast 缺失误伤正常发布。
   * - 可选接入视觉校验，但默认只记证据，不作为失败判定依据，继续保持低风险。
   *
   * 回退方式：
   * - 如果后续发现某个平台误报，只需在该平台的 step*_publish() 中删除本 helper 调用，
   *   即可恢复到“点击发布后仅等待”的旧逻辑。
   * - 本 helper 不修改 buildResult 结构，也不改变其他平台默认行为，回退面仅限接入点。
   */
  async conservativeVerifyPublishResult(options = {}) {
    const {
      guardName = this.getPlatformName(),
      waitOptions = {},
      useVisionWhenUnknown = false,
      platformName = this.getPlatformName(),
    } = options

    const waitResult = await this.waitForPublishResult(waitOptions)
    const summary = {
      guardName,
      waitResult,
      visionResult: null,
      strategy: useVisionWhenUnknown ? 'text_then_optional_vision' : 'text_only',
    }

    if (waitResult.status === 'error') {
      this.addStepEvidence('publishGuard', summary)
      throw new AdapterError(
        `${guardName} 发布被页面显式拦截：${waitResult.evidence}`,
        ERROR_CODES.PUBLISH_BLOCKED,
        'publish'
      )
    }

    if (waitResult.status === 'unknown' && useVisionWhenUnknown) {
      try {
        summary.visionResult = await this.visionCheckPublishResult({ platformName })
      } catch (err) {
        summary.visionResult = { status: 'unknown', details: `vision_error:${err.message}`, popupHandled: false }
        this.log.warn(`[发布校验] ${guardName} 视觉辅助校验失败，继续沿用保守策略: ${err.message}`)
      }
    }

    this.addStepEvidence('publishGuard', summary)
    return summary
  }

  /**
   * 关闭标签页前的延迟等待
   *
   * 配置项: tab.close_delay_min/max
   */
  async preCloseDelay() {
    const delayMin = cfg('tab.close_delay_min', 3000)
    const delayMax = cfg('tab.close_delay_max', 15000)
    this.log.debug('关闭标签页前等待...')
    await randomDelay(delayMin, delayMax)
  }

  // ============================================================
  // 截图
  // ============================================================

  /**
   * 截图保存
   *
   * 配置项:
   *   screenshot.full_page — 是否截全页
   *   screenshot.save_dir  — 截图保存目录
   */
  async takeScreenshot(name) {
    const fullPage = cfg('screenshot.full_page', false)
    const saveDir  = cfg('screenshot.save_dir', './logs/screenshots')

    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = path.join(saveDir, `${name}_${timestamp}.png`)
    await this.page.screenshot({ path: filePath, fullPage })
    this.log.info(`截图已保存: ${filePath}`)
    return filePath
  }

  /**
   * 根据截图策略决定是否截图
   *
   * 配置项: screenshot.on_each_step / on_error / on_before_publish / on_after_publish
   *
   * @param {string} name - 截图名称
   * @param {string} trigger - 触发类型: 'step' | 'error' | 'before_publish' | 'after_publish'
   */
  async conditionalScreenshot(name, trigger) {
    const triggerMap = {
      step: 'screenshot.on_each_step',
      error: 'screenshot.on_error',
      before_publish: 'screenshot.on_before_publish',
      after_publish: 'screenshot.on_after_publish',
    }
    const configKey = triggerMap[trigger]
    if (configKey && cfg(configKey, trigger === 'error')) {
      return this.takeScreenshot(name)
    }
    return null
  }

  // ============================================================
  // 状态浮窗（页面顶部居中，显示当前操作步骤）
  // ============================================================

  /**
   * 更新状态浮窗
   *
   * 新格式（推荐）：
   *   await this.showStatus('正在输入标题', { next: '输入正文', step: 3, total: 8 })
   *
   * 完成状态：
   *   await this.showStatus('发布完成！', { step: 8, total: 8, done: true })
   *
   * 旧格式（向后兼容）：
   *   await this.showStatus('正在输入标题...')
   *
   * @param {string} current - 当前操作描述
   * @param {object} [opts] - 可选参数
   * @param {string} [opts.next] - 下一步描述
   * @param {number} [opts.step] - 当前步骤序号
   * @param {number} [opts.total] - 总步骤数
   * @param {boolean} [opts.done] - 是否已完成（切绿色）
   * @param {boolean} [opts.error] - 是否出错（切红色）
   */
  async showStatus(current, opts) {
    if (!opts || typeof opts !== 'object') {
      return updateOverlay(this.page, current)
    }
    return updateOverlay(this.page, {
      label: this._overlayTaskLabel || `${this.platformName || '自动化'} · 任务执行中`,
      current,
      next: opts.next || '',
      step: opts.step || 0,
      total: opts.total || 0,
      done: !!opts.done,
      error: !!opts.error,
    })
  }

  /**
   * 移除状态浮窗
   */
  async hideStatus() {
    this._overlayDismissed = true
    return removeOverlay(this.page)
  }

  // ============================================================
  // 快捷封装，子类直接调用
  // ============================================================

  async click(selector) {
    return humanClick(this.cursor, selector, this.page)
  }

  async type(selector, text) {
    return humanType(this.page, selector, text, this.cursor)
  }

  /**
   * CDP insertText 输入（用于 contenteditable 富文本编辑器）
   * keyboard.type 对中文或 React/Vue 编辑器不可靠时使用此方法
   */
  async paste(selector, text) {
    return humanPaste(this.page, selector, text, this.cursor)
  }

  async scroll() {
    return humanScroll(this.page)
  }

  async uploadFile(selectorOrHandle, filePaths) {
    // 兼容两种调用模式：
    //   uploadFile('input[type=file]', [path])   — string selector（大多数平台）
    //   uploadFile(elementHandle, path)           — ElementHandle（抖音/视频号/头条）
    if (typeof selectorOrHandle === 'string') {
      return humanUploadFile(this.page, selectorOrHandle, filePaths)
    }

    // ElementHandle 模式：直接在已找到的元素上调用 uploadFile
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
    await selectorOrHandle.uploadFile(...paths)
    const waitMin = cfg('upload.wait_after_select_min', 2000)
    const waitMax = cfg('upload.wait_after_select_max', 5000)
    await randomDelay(waitMin, waitMax)
    this.log.info(`文件上传完成（ElementHandle 模式，${paths.length} 个文件）`)
  }

  /**
   * 从多个候选选择器中找到第一个存在于页面中的
   * @param {string[]} candidates - 候选 CSS 选择器列表（按优先级排列）
   * @returns {Promise<string>} 匹配到的选择器
   * @throws {Error} 全部未命中时抛出
   */
  async findSelector(candidates) {
    for (const selector of candidates) {
      try {
        const el = await this.page.$(selector)
        if (el) {
          this.log.debug(`使用选择器: ${selector}`)
          return selector
        }
      } catch {
        continue
      }
    }
    this.addStepEvidence('selector_miss', { candidates, url: this.page.url() })
    throw new AdapterError(
      `未找到匹配的元素，候选选择器: ${candidates.join(', ')}`,
      ERROR_CODES.SELECTOR_MISS
    )
  }

  /**
   * 从多个候选选择器中找到第一个存在于页面中的，返回 ElementHandle
   * （findSelector 的 ElementHandle 版本，供 weibo/bilibili 等 publisher 使用）
   * @param {string[]} candidates - 候选 CSS 选择器列表
   * @returns {Promise<ElementHandle|null>} 命中的元素，全部未命中返回 null
   */
  async findElement(candidates) {
    for (const selector of candidates) {
      try {
        const el = await this.page.$(selector)
        if (el) {
          this.log.debug(`findElement 命中: ${selector}`)
          return el
        }
      } catch {
        continue
      }
    }
    this.log.warn(`findElement 未命中，候选: ${candidates.join(', ')}`)
    this.addStepEvidence('selector_miss', { candidates, url: this.page.url() })
    return null
  }

  /**
   * 通过文本内容查找按钮或元素（替代 Puppeteer 不支持的 :has-text()）
   * @param {string} tag - HTML 标签名（如 'button', 'a', 'span'）
   * @param {string|string[]} text - 要匹配的文本内容；数组时按顺序尝试
   * @returns {Promise<ElementHandle|null>}
   */
  async findByText(tag, text) {
    const candidates = Array.isArray(text) ? text : [text]
    const elements = await this.page.$$(tag)
    for (const el of elements) {
      const content = await el.evaluate(node => node.textContent.trim())
      for (const candidate of candidates) {
        if (candidate && content.includes(candidate)) return el
      }
    }
    return null
  }

  // ============================================================
  // AI 视觉验证
  // ============================================================

  /**
   * 发布前 AI 视觉验证：截图当前页面，调用视觉模型确认内容已正确填写
   *
   * 配置项: vision.enabled / vision.api_key / vision.base_url / vision.model
   *
   * @param {object} expected - 期望内容 { title?, content?, tags?, imageCount? }
   * @returns {Promise<{pass: boolean, confidence: number, details: string, issues: string[]}>}
   */
  async verifyBeforePublish(expected) {
    return verifyPageContent(this.page, expected)
  }

  // ============================================================
  // AI 视觉验证核心方法（零 DOM 侵入，纯截图）
  //
  // 所有方法在 vision.enabled = false 时直接返回默认值，不阻塞流程。
  // 视觉检测耗时计入操作延迟（智能计时），不额外增加总时长。
  // ============================================================

  /**
   * 视觉验证页面就绪 + 智能计时
   *
   * 截图让 AI 判断页面是否完整加载。
   * 视觉检测耗时自动计入 targetDelayMs，剩余时间再等待。
   *
   * @param {string} pageDescription - 页面描述（如 "Reddit 发帖页面"）
   * @param {object} [options]
   * @param {string[]} [options.expectedElements] - 期望看到的元素描述
   * @param {number} [options.targetDelayMs] - 目标总延迟（含视觉检测时间）
   * @returns {Promise<{ready: boolean, details: string}>}
   */
  async visionCheckPageReady(pageDescription, options = {}) {
    const targetDelay = options.targetDelayMs || Math.floor(
      gaussianRandom(
        cfg('timing.action_delay_min', 3000),
        cfg('timing.action_delay_max', 15000)
      )
    )
    const stepStart = Date.now()

    const result = await verifyPageReady(
      this.page, pageDescription, options.expectedElements || []
    )
    this.addStepEvidence('vision_page_ready', { pageDescription, ...result })

    if (!result.ready) {
      this.log.warn(`[视觉验证] 页面未就绪，额外等待 2s`)
      await new Promise(r => setTimeout(r, 2000))
    }

    await smartDelay(stepStart, targetDelay)
    return result
  }

  /**
   * 视觉验证内容填写 + 智能计时
   *
   * 截图让 AI 确认表单内容是否正确填写。
   * 用于填写完标题、正文、上传图片后的检查。
   *
   * @param {object} expected - 期望内容 { title?, content?, tags?, imageCount? }
   * @param {object} [options]
   * @param {number} [options.targetDelayMs] - 目标总延迟
   * @returns {Promise<{pass: boolean, confidence: number, details: string, issues: string[]}>}
   */
  async visionCheckContent(expected, options = {}) {
    const targetDelay = options.targetDelayMs || Math.floor(
      gaussianRandom(
        cfg('timing.action_delay_min', 3000),
        cfg('timing.action_delay_max', 15000)
      )
    )
    const stepStart = Date.now()

    const result = await verifyContentFilled(this.page, expected)
    this.addStepEvidence('vision_content_check', { expected: Object.keys(expected), ...result })

    await smartDelay(stepStart, targetDelay)
    return result
  }

  /**
   * 视觉定位 + ghost-cursor 鼠标点击
   *
   * 当选择器找不到元素时，截图让 AI 找到目标坐标，
   * 然后用 ghost-cursor 模拟真人鼠标移动过去点击。
   *
   * @param {string} elementDescription - 目标描述（如 "蓝色的发布按钮"）
   * @returns {Promise<{clicked: boolean, method: string, details: string}>}
   */
  async visionLocateAndClick(elementDescription) {
    const result = await locateElement(this.page, elementDescription)
    this.addStepEvidence('vision_locate', { target: elementDescription, ...result })

    if (!result.found) {
      return { clicked: false, method: 'vision', details: result.description }
    }

    // 用 ghost-cursor 模拟真人鼠标移动 + 点击
    try {
      if (this.cursor) {
        // ghost-cursor：贝塞尔曲线移动到目标坐标，然后点击
        await this.cursor.moveTo({ x: result.x, y: result.y })
        const clickWait = Math.floor(gaussianRandom(
          cfg('mouse.click_wait_min', 50),
          cfg('mouse.click_wait_max', 200)
        ))
        await new Promise(r => setTimeout(r, clickWait))
        await this.page.mouse.click(result.x, result.y)
      } else {
        await this.page.mouse.click(result.x, result.y)
      }
      this.log.info(`[视觉点击] 已点击 "${elementDescription}" @ (${result.x}, ${result.y})`)
      return { clicked: true, method: 'vision_cursor', details: result.description }
    } catch (err) {
      this.log.warn(`[视觉点击] 点击失败: ${err.message}`)
      return { clicked: false, method: 'vision', details: `点击异常: ${err.message}` }
    }
  }

  /**
   * 视觉检测弹窗 + 自动处理
   *
   * 截图检测是否有弹窗遮挡，如果有则用鼠标点击关闭/确认。
   * 适用于不可预测的 cookie 提示、通知弹窗、发布确认框等。
   *
   * @param {string} [action='close'] - 处理方式: 'close' | 'confirm'
   * @returns {Promise<{hasPopup: boolean, handled: boolean, popupType: string}>}
   */
  async visionHandlePopup(action = 'close') {
    const result = await detectPopup(this.page, action)
    this.addStepEvidence('vision_popup', result)

    if (!result.hasPopup) {
      return { hasPopup: false, handled: false, popupType: '' }
    }

    if (result.buttonX <= 0 || result.buttonY <= 0) {
      this.log.warn(`[视觉弹窗] 检测到弹窗但未定位到按钮: ${result.popupType}`)
      return { hasPopup: true, handled: false, popupType: result.popupType }
    }

    // ghost-cursor 鼠标点击弹窗按钮
    try {
      if (this.cursor) {
        await this.cursor.moveTo({ x: result.buttonX, y: result.buttonY })
        const clickWait = Math.floor(gaussianRandom(50, 200))
        await new Promise(r => setTimeout(r, clickWait))
        await this.page.mouse.click(result.buttonX, result.buttonY)
      } else {
        await this.page.mouse.click(result.buttonX, result.buttonY)
      }
      this.log.info(`[视觉弹窗] 已处理弹窗: ${result.popupType} → (${result.buttonX}, ${result.buttonY})`)
      await randomDelay(500, 1500)
      return { hasPopup: true, handled: true, popupType: result.popupType }
    } catch (err) {
      this.log.warn(`[视觉弹窗] 处理失败: ${err.message}`)
      return { hasPopup: true, handled: false, popupType: result.popupType }
    }
  }

  /**
   * 视觉判断发布结果 + 自动处理弹窗
   *
   * 点击发布按钮后，截图判断当前状态：
   *   - 成功 → 直接返回
   *   - 需要确认 → 自动点击确认按钮
   *   - 需要关闭 → 自动点击关闭按钮
   *   - 失败/仍在编辑 → 返回状态供上层处理
   *
   * @param {object} [options]
   * @param {string} [options.platformName] - 平台名称
   * @returns {Promise<{status: string, details: string, popupHandled: boolean}>}
   */
  async visionCheckPublishResult(options = {}) {
    const platformName = options.platformName || this.getPlatformName()
    const result = await judgePublishResult(this.page, platformName)
    this.addStepEvidence('vision_publish_result', result)

    // 自动处理弹窗
    if (result.hasPopup && result.buttonX > 0 && result.buttonY > 0) {
      try {
        if (this.cursor) {
          await this.cursor.moveTo({ x: result.buttonX, y: result.buttonY })
          await new Promise(r => setTimeout(r, Math.floor(gaussianRandom(50, 200))))
          await this.page.mouse.click(result.buttonX, result.buttonY)
        } else {
          await this.page.mouse.click(result.buttonX, result.buttonY)
        }
        this.log.info(`[视觉发布] 已点击弹窗按钮: "${result.popupAction}" → (${result.buttonX}, ${result.buttonY})`)
        await randomDelay(1000, 3000)
        return { status: result.status, details: result.details, popupHandled: true }
      } catch (err) {
        this.log.warn(`[视觉发布] 弹窗点击失败: ${err.message}`)
      }
    }

    return { status: result.status, details: result.details, popupHandled: false }
  }

  // ============================================================
  // Midscene AI 视觉状态机
  // ============================================================

  /**
   * AI 视觉验证：用自然语言断言当前页面状态
   * 失败不阻塞流程，仅记录证据
   *
   * @param {string} assertion - 自然语言断言（如 '标题输入框中包含文字"xxx"'）
   * @param {object} [options]
   * @param {boolean} [options.throwOnFail=false] - 验证失败时是否抛异常
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async aiVerify(assertion, options = {}) {
    if (!this._midsceneAgent) {
      return { success: true, error: 'agent_not_available' }
    }
    const verifyEnabled = cfg('midscene.verify_after_step', true)
    if (!verifyEnabled) {
      return { success: true, error: 'verify_disabled' }
    }

    const result = await safeMidsceneCall(this._midsceneAgent, 'aiAssert', assertion)
    this.addStepEvidence(`ai_verify`, { assertion, ...result })

    if (!result.success && options.throwOnFail) {
      throw new AdapterError(
        `AI 验证失败: ${assertion} — ${result.error}`,
        ERROR_CODES.UNKNOWN
      )
    }
    return result
  }

  /**
   * AI 操作：用自然语言指示 AI 在页面上执行操作
   * 适用于选择器不可靠的场景（下拉框、弹窗、Tab 切换等）
   *
   * @param {string} instruction - 自然语言指令（如 '点击发布按钮'）
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async aiOperate(instruction) {
    if (!this._midsceneAgent) {
      return { success: false, error: 'agent_not_available' }
    }
    const result = await safeMidsceneCall(this._midsceneAgent, 'aiAct', instruction)
    this.addStepEvidence(`ai_operate`, { instruction, ...result })
    return result
  }

  /**
   * AI 数据提取：用自然语言从页面提取结构化数据
   *
   * @param {string} query - 数据描述（如 '{likes: number, comments: number}'）
   * @returns {Promise<{success: boolean, result?: any, error?: string}>}
   */
  async aiExtract(query) {
    if (!this._midsceneAgent) {
      return { success: false, error: 'agent_not_available' }
    }
    const result = await safeMidsceneCall(this._midsceneAgent, 'aiQuery', query)
    this.addStepEvidence(`ai_extract`, { query, ...result })
    return result
  }

  /**
   * 智能点击：先尝试选择器，失败时降级到 AI 视觉操作
   *
   * @param {string[]} selectors - 候选 CSS 选择器
   * @param {string} aiDescription - AI 降级时的自然语言描述（如 '点击发布按钮'）
   * @returns {Promise<boolean>} 是否成功点击
   */
  async smartClick(selectors, aiDescription) {
    // 1. 先尝试传统选择器（快速路径，0 成本）
    const el = await this.findElement(selectors)
    if (el) {
      await this.clickElement(el)
      return true
    }

    // 2. 选择器未命中 → 尝试自建视觉定位（零 DOM 侵入）
    if (aiDescription) {
      const visionResult = await this.visionLocateAndClick(aiDescription)
      if (visionResult.clicked) return true
    }

    // 3. 视觉定位也失败 → 最后尝试 Midscene（如果可用）
    const fallbackEnabled = cfg('midscene.fallback_on_selector_miss', true)
    if (fallbackEnabled && this._midsceneAgent) {
      this.log.warn(`[smartClick] 视觉定位未命中，Midscene 降级: ${aiDescription}`)
      const result = await this.aiOperate(aiDescription)
      return result.success
    }

    this.log.warn(`[smartClick] 所有方式均未命中: ${selectors.join(', ')}`)
    return false
  }

  /**
   * 智能查找并点击：findElement + clickElement + AI 降级
   * 未找到时抛出 AdapterError（与 findSelector 行为一致）
   *
   * @param {string[]} selectors - 候选 CSS 选择器
   * @param {string} aiDescription - AI 降级描述
   * @throws {AdapterError} 选择器和 AI 均失败时
   */
  async smartFindAndClick(selectors, aiDescription) {
    const success = await this.smartClick(selectors, aiDescription)
    if (!success) {
      throw new AdapterError(
        `未找到元素且 AI 操作失败: ${aiDescription}`,
        ERROR_CODES.SELECTOR_MISS
      )
    }
  }

  /**
   * AI 弹窗检测与处理：检测意外弹窗并尝试关闭
   * 在关键步骤之间调用，防止弹窗阻塞后续操作
   *
   * @returns {Promise<{hasPopup: boolean, dismissed: boolean}>}
   */
  async checkForPopup() {
    if (!this._midsceneAgent || !cfg('midscene.auto_dismiss_popup', true)) {
      return { hasPopup: false, dismissed: false }
    }

    try {
      const queryResult = await safeMidsceneCall(
        this._midsceneAgent,
        'aiQuery',
        '{hasPopup: boolean, popupDescription: string}, 检查页面是否有弹窗、对话框、提示框覆盖在主内容上方。如果没有弹窗返回 hasPopup: false'
      )

      if (!queryResult.success || !queryResult.result?.hasPopup) {
        return { hasPopup: false, dismissed: false }
      }

      this.log.warn(`[Midscene] 检测到弹窗: ${queryResult.result.popupDescription}`)
      const dismissResult = await safeMidsceneCall(
        this._midsceneAgent,
        'aiAct',
        '关闭当前弹窗、对话框或提示框（点击关闭按钮、取消按钮或点击遮罩层）'
      )

      this.addStepEvidence('popup_dismissed', {
        popup: queryResult.result.popupDescription,
        dismissed: dismissResult.success
      })

      return { hasPopup: true, dismissed: dismissResult.success }
    } catch (err) {
      this.log.debug(`[Midscene] 弹窗检测异常: ${err.message}`)
      return { hasPopup: false, dismissed: false }
    }
  }

  // ============================================================
  // 元素操作
  // ============================================================

  /**
   * 通过 ghost-cursor 点击 ElementHandle（保留鼠标移动轨迹）
   * cursor 不存在时 fallback 到原生 el.click()
   * @param {ElementHandle} el - 目标元素
   */
  async clickElement(el) {
    if (this.cursor) {
      const clickOffset  = cfg('mouse.click_offset_percent', 10)
      const clickWaitMin = cfg('mouse.click_wait_min', 50)
      const clickWaitMax = cfg('mouse.click_wait_max', 200)
      await this.cursor.click(el, {
        paddingPercentage: clickOffset,
        waitForClick: Math.floor(gaussianRandom(clickWaitMin, clickWaitMax))
      })
    } else {
      await el.click()
    }
  }

  /**
   * 通过文本点击元素
   * @param {string} tag
   * @param {string|string[]} text - 单文本或文本数组（用于多语言/多版本兼容）
   * @param {object} [options]
   * @param {number} [options.timeoutMs] - 等待元素出现的总超时；为 0/未设则不轮询
   */
  async clickByText(tag, text, options = {}) {
    const timeoutMs = Number(options.timeoutMs ?? 0)
    let el = null
    if (timeoutMs > 0) {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        el = await this.findByText(tag, text)
        if (el) break
        await new Promise(r => setTimeout(r, 250))
      }
    } else {
      el = await this.findByText(tag, text)
    }
    if (!el) {
      const label = Array.isArray(text) ? text.join('|') : text
      throw new Error(`未找到包含文本 "${label}" 的 <${tag}> 元素`)
    }
    await this.clickElement(el)
    const label = Array.isArray(text) ? text.join('|') : text
    this.log.debug(`点击文本元素: <${tag}>"${label}"`)
    return true
  }

  /**
   * 向 ElementHandle 输入文字（配合 findElement 使用）
   *
   * 策略：CDP Input.insertText，兼容普通 input 和 React/Vue 富文本编辑器。
   * 按段落拆分，段间模拟思考停顿，与 humanPaste 保持一致。
   *
   * @param {ElementHandle} element - 目标元素句柄
   * @param {string} text - 要输入的文字
   */
  async humanTypeInElement(element, text) {
    const preMin = cfg('keyboard.pre_type_delay_min', 300)
    const preMax = cfg('keyboard.pre_type_delay_max', 800)

    await this.clickElement(element)
    await randomDelay(preMin, preMax)

    const cdp = await this.page.target().createCDPSession()
    const paragraphs = text.split('\n')

    // 自适应输入策略（与 humanPaste 一致）
    const imeEnabled = cfg('keyboard.ime_enabled', true)
    const imeThresholdShort = cfg('keyboard.ime_threshold_short', 200)
    const imeThresholdLong = cfg('keyboard.ime_threshold_long', 800)
    const imeParagraphLimit = cfg('keyboard.ime_paragraph_limit', 3)
    const totalLen = text.length

    let mode = 'ime'
    if (totalLen > imeThresholdLong) {
      mode = 'fast'
      this.log.info(`长文模式（${totalLen}字），分段快速输入`)
    } else if (totalLen > imeThresholdShort) {
      mode = 'hybrid'
      this.log.info(`混合模式（${totalLen}字），前${imeParagraphLimit}段 IME`)
    }

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i]
      if (para.length > 0) {
        let useIME = false
        if (mode === 'ime') {
          useIME = imeEnabled && containsChinese(para)
        } else if (mode === 'hybrid') {
          useIME = imeEnabled && containsChinese(para) && i < imeParagraphLimit
        }

        if (useIME) {
          try {
            await simulateIMEText(cdp, para)
          } catch (imeErr) {
            this.log.warn(`IME 输入第${i+1}段失败，降级为快速输入`)
            await cdp.send('Input.insertText', { text: para })
          }
        } else {
          const sentences = para.match(/[^。！？.!?\n]+[。！？.!?]?/g) || [para]
          for (let s = 0; s < sentences.length; s++) {
            await cdp.send('Input.insertText', { text: sentences[s] })
            if (s < sentences.length - 1) await randomDelay(150, 500)
          }
        }
      }
      if (i < paragraphs.length - 1) {
        await randomDelay(200, 500)
        await this.page.keyboard.press('Enter')
        const pauseMin = mode === 'fast' ? 300 : 800
        const pauseMax = mode === 'fast' ? 1000 : 2000
        await randomDelay(pauseMin, pauseMax)
      }
    }

    await cdp.detach()
    this.log.debug('humanTypeInElement 输入完成')
  }

  // ============================================================
  // 条件等待（Condition-Based Waits）
  // ============================================================

  /**
   * 等待多个选择器中任一出现
   * @param {string[]} selectors - CSS 选择器数组
   * @param {number} timeout - 最大等待时间（毫秒）
   * @returns {string|null} 命中的选择器，超时返回 null
   */
  async waitForAny(selectors, timeout = 15000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      for (const sel of selectors) {
        try {
          const el = await this.page.$(sel)
          if (el) return sel
        } catch { /* next */ }
      }
      await randomDelay(300, 600)
    }
    return null
  }

  /**
   * 等待编辑器就绪（标题或正文元素可交互）
   * @param {string[]} titleSelectors - 标题选择器
   * @param {string[]} contentSelectors - 正文选择器
   * @param {number} timeout - 最大等待时间
   * @returns {boolean}
   */
  async waitForEditorReady(titleSelectors, contentSelectors, timeout = 20000) {
    const allSels = [...titleSelectors, ...contentSelectors]
    const hit = await this.waitForAny(allSels, timeout)
    if (hit) {
      this.log.info(`[就绪] 编辑器已就绪: ${hit}`)
      return true
    }
    this.log.warn(`[就绪] 编辑器未就绪（${timeout}ms 超时）`)
    return false
  }

  /**
   * 等待 URL 包含指定字符串
   * @param {string} pattern - URL 中应包含的子串
   * @param {number} timeout - 最大等待时间
   * @returns {boolean}
   */
  async waitForUrlContains(pattern, timeout = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (this.page.url().includes(pattern)) return true
      await randomDelay(300, 600)
    }
    return false
  }

  // ============================================================
  // 后置断言（Post-Action Assertions）
  // ============================================================

  /**
   * 断言 input/textarea 的值包含预期文本
   * @param {string|string[]} selectors - CSS 选择器（单个或多个）
   * @param {string} expected - 期望包含的文本
   * @param {string} label - 日志标签（如 "标题"）
   */
  async assertInputValue(selectors, expected, label) {
    const sels = Array.isArray(selectors) ? selectors : [selectors]
    const prefix = expected.trim().substring(0, 30)
    for (const sel of sels) {
      try {
        const actual = await this.page.$eval(sel, el => el.value || el.textContent || '')
        if (actual && actual.trim().includes(prefix)) {
          this.log.info(`[断言] ${label} 回读验证通过 ✓`)
          this.addStepEvidence(`assert:${label}`, 'passed')
          return true
        }
      } catch { /* next selector */ }
    }
    this.log.warn(`[断言] ${label} 回读不一致: 期望含 "${prefix}"`)
    this.addStepEvidence(`assert:${label}`, 'failed')
    this._assertionFailures++
    return false
  }

  /**
   * 断言富文本编辑器（contenteditable）的内容包含预期文本片段
   * @param {string|string[]} selectors - 编辑器 CSS 选择器
   * @param {string} expected - 期望包含的文本
   * @param {string} label - 日志标签
   */
  async assertRichTextContent(selectors, expected, label) {
    const sels = Array.isArray(selectors) ? selectors : [selectors]
    const prefix = expected.trim().substring(0, 40)
    for (const sel of sels) {
      try {
        const actual = await this.page.$eval(sel, el => (el.textContent || '').substring(0, 200))
        if (actual && actual.includes(prefix)) {
          this.log.info(`[断言] ${label} 内容验证通过 ✓`)
          this.addStepEvidence(`assert:${label}`, 'passed')
          return true
        }
      } catch { /* next selector */ }
    }
    this.log.warn(`[断言] ${label} 内容不一致: 期望含 "${prefix}"`)
    this.addStepEvidence(`assert:${label}`, 'failed')
    this._assertionFailures++
    return false
  }

  /**
   * 断言元素存在
   * @param {string|string[]} selectors - CSS 选择器
   * @param {string} label - 日志标签
   * @returns {boolean}
   */
  async assertElementExists(selectors, label) {
    const sels = Array.isArray(selectors) ? selectors : [selectors]
    for (const sel of sels) {
      try {
        const el = await this.page.$(sel)
        if (el) {
          this.log.info(`[断言] ${label} 元素存在 ✓`)
          return true
        }
      } catch { /* next */ }
    }
    this.log.warn(`[断言] ${label} 元素未找到`)
    return false
  }

  /**
   * 等待元素消失（如上传 loading、处理中状态）
   * @param {string} selector - CSS 选择器
   * @param {number} timeout - 最大等待时间（毫秒）
   * @param {string} label - 日志标签
   * @returns {boolean}
   */
  async waitForElementGone(selector, timeout = 10000, label = '') {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const el = await this.page.$(selector)
        if (!el) {
          if (label) this.log.info(`[断言] ${label} 已消失 ✓`)
          return true
        }
      } catch { return true }
      await randomDelay(500, 1000)
    }
    if (label) this.log.warn(`[断言] ${label} 超时未消失`)
    return false
  }

  /**
   * 发布后结果验证 — 检测成功/失败信号
   * @param {object} options
   * @param {string[]} [options.successTexts] - 成功提示文本
   * @param {string[]} [options.errorTexts] - 错误提示文本
   * @param {string} [options.successUrlPattern] - 成功跳转 URL 模式
   * @param {number} [options.timeout] - 最大等待时间
   * @returns {{status: 'success'|'error'|'unknown', evidence: string}}
   */
  async waitForPublishResult(options = {}) {
    const {
      successTexts = ['发布成功', '已发布', '发表成功', '提交成功'],
      errorTexts = ['发布失败', '发表失败', '请重试', '网络错误', '审核不通过'],
      successUrlPattern = null,
      timeout = 20000
    } = options

    const start = Date.now()
    while (Date.now() - start < timeout) {
      // 检查 URL 跳转
      if (successUrlPattern) {
        const url = this.page.url()
        if (url.includes(successUrlPattern)) {
          this.log.info(`[断言] 发布成功（URL 跳转）: ${url.substring(0, 80)}`)
          const r = { status: 'success', evidence: `url:${url.substring(0, 80)}` }
          this.addStepEvidence('publishResult', r)
          return r
        }
      }

      // 检查页面文本
      try {
        const bodyText = await this.page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '')

        for (const text of errorTexts) {
          if (bodyText.includes(text)) {
            this.log.warn(`[断言] 发布可能失败: 检测到 "${text}"`)
            const r = { status: 'error', evidence: `text:${text}` }
            this.addStepEvidence('publishResult', r)
            return r
          }
        }

        for (const text of successTexts) {
          if (bodyText.includes(text)) {
            this.log.info(`[断言] 发布成功: 检测到 "${text}" ✓`)
            const r = { status: 'success', evidence: `text:${text}` }
            this.addStepEvidence('publishResult', r)
            return r
          }
        }
      } catch { /* page may be navigating */ }

      // 2026-04-20：固定 500ms 轮询间隔，避免随机延迟错过短暂 toast
      await new Promise(r => setTimeout(r, 500))
    }

    this.log.warn(`[断言] 发布结果未知（${timeout}ms 内未检测到明确信号）`)
    const result = { status: 'unknown', evidence: 'timeout' }
    this.addStepEvidence('publishResult', result)
    return result
  }
}
