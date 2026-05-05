import { BasePlatformAdapter } from '../base.js'
import { randomDelay } from '../../core/human.js'
import { cfg } from '../../core/config.js'
import { PUBLISH_SELECTORS, INTERACT_SELECTORS } from './selectors.js'

/**
 * 大鱼号(UC)文章发布适配器
 *
 * 文章发布页: https://mp.dayu.com/dashboard/article/write
 *
 * 大鱼号特点:
 *   - UEditor iframe 富文本编辑器（body.view.simple-ui）
 *   - 标题 input + 正文 iframe body contenteditable
 *   - 封面 单封面/三封面 radio 选择 + 图片上传
 *   - Ant Design 组件（分类 select、radio 等）
 */

const S = PUBLISH_SELECTORS

export class DayuAdapter extends BasePlatformAdapter {
  constructor(page) {
    super(page)
    this.platformName = 'dayu'
    this.publishUrl = 'https://mp.dayu.com/dashboard/article/write'
  }

  getHomeUrl() { return 'https://mp.dayu.com/dashboard' }
  getLoginUrl() { return 'https://mp.dayu.com/' }
  getInteractSelectors() { return INTERACT_SELECTORS }

  async publish(post) {
    this.log.info('========== 大鱼号发布开始 ==========')
    this.log.info(`标题: ${post.title}`)
    this._dryRun = !!post.dryRun
    if (this._dryRun) this.log.info('[dryRun] 填写内容后不点击发布按钮')

    // 设置任务标签和步骤
    this._overlayTaskLabel = '大鱼号 · 文章发布任务执行中'
    const steps = ['预热浏览', '打开发布页面', '输入标题', '输入正文', '设置封面', '发布文章']
    const T = steps.length
    let S = 0

    try {
      S++
      await this.showStatus('正在模拟人工预热浏览', { next: '打开发布页面', step: S, total: T }).catch(() => {})
      await this.warmupBrowse()

      S++
      await this.showStatus('正在打开大鱼号发布页面', { next: '输入标题', step: S, total: T }).catch(() => {})
      await this.runStep('openPublishPage', () => this.step1_openPublishPage())
      S++
      await this.showStatus('正在模拟人工输入标题', { next: '输入正文', step: S, total: T }).catch(() => {})
      await this.runStep('inputTitle', () => this.step2_inputTitle(post.title))
      S++
      await this.showStatus('正在模拟人工输入正文内容', { next: '设置封面', step: S, total: T }).catch(() => {})
      await this.runStep('inputContent', () => this.step3_inputContent(post.content))
      S++
      await this.showStatus('正在设置封面图', { next: '发布文章', step: S, total: T }).catch(() => {})
      await this.runStep('setCover', () => this.step4_setCover(post.images?.[0]))
      S++
      await this.showStatus('正在点击发布按钮提交文章', { step: S, total: T }).catch(() => {})
      await this.runStep('publish', () => this.step5_publish())
      await this.showStatus('发布完成！', { step: S, total: T, done: true }).catch(() => {})
      await this.hideStatus().catch(() => {})

      await this.fillRemainingTime()

      if (!this._dryRun) {
        this.log.info('[发布后] 返回首页浏览')
        await this.navigateTo(this.getHomeUrl())
      }
      await this.postPublishBrowse()

      this.log.info('========== 大鱼号发布完成 ==========')
      return this.buildResult(true, '大鱼号发布成功')
    } catch (err) {
      this.log.error(`大鱼号发布失败: ${err.message}`)
      return this.buildResult(false, err)
    }
  }

  async step1_openPublishPage() {
    this.log.info('[Step 1] 打开大鱼号文章发布页')
    await this.navigateTo(this.publishUrl)
    await randomDelay(cfg('timing.action_delay_min', 2000), cfg('timing.action_delay_max', 4000))
  }

  async step2_inputTitle(title) {
    this.log.info('[Step 2] 输入标题')
    const el = await this.findElement([S.titleInput, S.titleInputAlt, S.titleInputAlt2])
    if (!el) throw new Error('未找到标题输入框')
    await this.humanTypeInElement(el, title)
    await randomDelay(500, 1500)
  }

  async step3_inputContent(content) {
    this.log.info('[Step 3] 输入正文（iframe UEditor）')
    const frames = this.page.frames()
    for (const frame of frames) {
      if (frame === this.page.mainFrame()) continue
      try {
        const body = await frame.$(S.contentIframeBody) || await frame.$(S.contentIframeBodyAlt)
        if (body) {
          await body.click()
          await randomDelay(300, 600)
          const cdp = await this.page.target().createCDPSession()
          await cdp.send('Input.insertText', { text: content })
          await cdp.detach()
          this.log.info('正文输入完成（iframe body CDP）')
          await randomDelay(500, 1500)
          return
        }
      } catch { /* skip frame */ }
    }
    throw new Error('未找到大鱼号正文 iframe 编辑器')
  }

  async step4_setCover(imagePath) {
    this.log.info('[Step 4] 设置封面')
    try {
      // 选择"单封面"模式
      const singleLabel = await this.findByText('span', S.coverSingleText)
        || await this.findByText('div', S.coverSingleText)
      if (singleLabel) {
        await this.clickElement(singleLabel)
        await randomDelay(500, 1000)
      }

      // 上传封面图
      if (imagePath) {
        const fileInput = await this.findElement([S.coverFileInput, S.coverFileInputAlt])
        if (fileInput) {
          await this.uploadFile(fileInput, imagePath)
          await randomDelay(2000, 4000)
          this.log.info('封面图已上传')
        } else {
          this.log.warn('未找到封面文件上传入口')
        }
      }
    } catch (e) {
      this.log.warn(`封面设置失败: ${e.message}`)
    }
  }

  async step5_publish() {
    if (this._dryRun) {
      this.log.info('[Step 5] dryRun 模式，内容已填写，等待人工确认后手动发布')
      return
    }
    this.log.info('[Step 5] 点击保存/发布')
    // 大鱼号可能需要先保存再发布
    const saveBtn = await this.findByText('button', S.saveButtonText)
    if (saveBtn) {
      await this.clickElement(saveBtn)
      await randomDelay(2000, 5000)
    }
  }
}
