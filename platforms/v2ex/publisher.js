import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS, BROWSE_SELECTORS } from './selectors.js'

/**
 * V2EX 帖子发布适配器
 *
 * 发布页面: https://www.v2ex.com/new
 *
 * V2EX 特点:
 *   - 标题 + 正文（纯文本 textarea）
 *   - 需要选择节点
 *   - 无图片上传（通过 Markdown 外链引用）
 *   - 技术社区，风险较低
 */

const SELECTORS = PUBLISH_SELECTORS

export class V2exAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'v2ex'
    this.publishUrl = 'https://www.v2ex.com/new'
  }

  // 平台元数据
  getHomeUrl() { return 'https://www.v2ex.com/' }
  getLoginUrl() { return 'https://www.v2ex.com/signin' }
  getInteractSelectors() { return INTERACT_SELECTORS }
  getBrowsePostSelector() { return BROWSE_SELECTORS.feedItem }

  // 2026-04-20：海外平台加大超时，适应慢网络
  getNavigationTimeout() { return 100000 }
  getElementTimeout() { return 60000 }

  async publish(post) {
    this.log.info('========== V2EX 发帖开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 审核模式：填写内容后不点击提交按钮')

    // 设置任务标签和步骤
    this._overlayTaskLabel = 'V2EX · 帖子发布任务执行中'
    const hasNode = !!post.node
    const steps = ['预热浏览', '打开发帖页面', '输入标题', '输入内容']
    if (hasNode) steps.push('选择节点')
    steps.push('提交发布')
    const T = steps.length
    let S = 0

    try {
      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开发帖页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在打开 V2EX 发帖页面', { next: '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPage', () => this.step1_openPage())
      S++
      await this.showStatus('正在模拟人工输入标题', { next: '输入内容', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step2_inputTitle(post.title))
      S++
      await this.showStatus('正在模拟人工输入内容', { next: hasNode ? '选择节点' : '提交发布', step: S, total: T }).catch(() => {})
      await this.runStep('inputContent', () => this.step3_inputContent(post.content))

      if (hasNode) {
        S++
        await this.showStatus('正在选择目标节点', { next: '提交发布', step: S, total: T }).catch(() => {})
        await this.runStep('selectNode', () => this.step4_selectNode(post.node))
      }

      S++
      await this.showStatus('正在点击提交按钮发布帖子', { step: S, total: T }).catch(() => {})
      await this.runStep('submit', () => this.step5_submit())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== V2EX 发帖成功 ==========')
      return this.buildResult(true, '发布成功')

    } catch (err) {
      this.log.error(`V2EX 发帖失败: ${err.message}`)
      await this.conditionalScreenshot('v2ex_error', 'error')
      return this.buildResult(false, err)
    }
  }

  async step1_openPage() {
    this.log.info('[步骤1] 打开 V2EX 发帖页面')
    await this.navigateTo(this.publishUrl)

    const currentUrl = this.page.url()
    if (currentUrl.includes(SELECTORS.loginPageIndicator)) {
      throw new Error('未登录或登录已过期，请先在浏览器中登录 V2EX')
    }

    // 2026-04-20：海外平台加入视觉验证页面就绪
    await this.visionCheckPageReady('V2EX 发帖页面', {
      expectedElements: ['标题输入框', '正文编辑区', '节点选择'],
      targetDelayMs: 5000
    })

    await this.conditionalScreenshot('v2ex_step1_open', 'step')
    await this.browseForStep('open_page')
  }

  async step2_inputTitle(title) {
    this.log.info('[步骤2] 输入标题')
    const selector = await this.findSelector([
      SELECTORS.titleInput,
      SELECTORS.titleInputAlt,
    ])
    await this.type(selector, title)
    await this.actionPause()
    await this.browseForStep('input_title')
  }

  async step3_inputContent(content) {
    this.log.info('[步骤3] 输入正文')
    const selector = await this.findSelector([
      SELECTORS.contentInput,
      SELECTORS.contentInputAlt,
      SELECTORS.contentInputFallback,
    ])
    await this.type(selector, content)
    await this.actionPause()
    await this.browseForStep('input_content')
  }

  async step4_selectNode(node) {
    this.log.info(`[步骤4] 选择节点: ${node}`)
    try {
      const selectEl = await this.page.$(SELECTORS.nodeSelector)
      if (selectEl) {
        await this.page.select(SELECTORS.nodeSelector, node)
      } else {
        const inputEl = await this.page.$(SELECTORS.nodeInput)
        if (inputEl) {
          await this.type(SELECTORS.nodeInput, node)
        }
      }
      await randomDelay(1000, 2000)
    } catch (err) {
      this.log.warn(`选择节点 "${node}" 失败: ${err.message}`)
    }
  }

  async step5_submit() {
    if (this._dryRun) {
      this.log.info('[步骤5] dryRun 模式，内容已填写，等待人工确认后手动提交')
      return
    }
    this.log.info('[步骤5] 提交帖子')

    const reviewDelayMin = cfg('steps.publish.review_delay_min', 3000)
    const reviewDelayMax = cfg('steps.publish.review_delay_max', 8000)
    const waitAfterMin = cfg('steps.publish.wait_after_min', 5000)
    const waitAfterMax = cfg('steps.publish.wait_after_max', 15000)

    await randomDelay(reviewDelayMin, reviewDelayMax)
    await this.conditionalScreenshot('v2ex_before_publish', 'before_publish')

    const selector = await this.findSelector([
      SELECTORS.submitButton,
      SELECTORS.submitButtonAlt,
    ])
    await this.click(selector)

    this.log.info('已点击提交按钮')
    await randomDelay(waitAfterMin, waitAfterMax)
    await this.conditionalScreenshot('v2ex_after_publish', 'after_publish')
  }

}
