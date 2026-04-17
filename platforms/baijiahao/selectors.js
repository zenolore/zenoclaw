/**
 * 百家号 CSS 选择器集中管理（2026-04-16 MCP 实测重写）
 *
 * 编辑器: Lexical 标题 + UEditor iframe 正文
 * 文章发布页: https://baijiahao.baidu.com/builder/rc/edit?type=news
 *
 * 页面组件:
 *   标题 → Lexical contenteditable div[data-lexical-editor="true"]
 *   正文 → UEditor iframe#ueditor_0 body.view[contenteditable="true"]
 *   封面 → 单图/三图 radio → 选择封面按钮 → 弹窗(正文/本地上传 | AI封图 | 免费正版图库)
 *   智能创作 → 自动生成播客 checkbox / 图文转动态 checkbox
 *   创作声明 → 采用AI生成内容 checkbox / 来源说明 checkbox
 *   底部 → 存草稿 | 预览 | 定时发布 | 发布
 */

export const PUBLISH_SELECTORS = {
  // ─── 标题 ──────────────────────────────────────────
  // Lexical 编辑器，data-testid="news-title-input" 内的 contenteditable div
  titleContainer: '[data-testid="news-title-input"]',
  titleEditor: '[data-testid="news-title-input"] div[contenteditable="true"][data-lexical-editor="true"]',
  // 隐藏的 textarea 模拟器（备用）
  titleSimulator: '[data-testid="news-title-input"] textarea',

  // ─── 正文 ──────────────────────────────────────────
  // UEditor iframe（id="ueditor_0"）内的 body
  contentIframeId: 'ueditor_0',
  contentIframeBody: 'body[contenteditable="true"]',
  contentIframeBodyAlt: 'body.view',

  // ─── 封面 ──────────────────────────────────────────
  // 封面类型 radio
  coverRadioSingle: 'input[type="radio"][value="one"]',
  coverRadioTriple: 'input[type="radio"][value="three"]',
  // 选择封面按钮（打开弹窗）
  coverSelectButtonText: '选择封面',
  // 弹窗内 file input（hidden, name="media"）
  coverFileInput: 'input[name="media"][type="file"]',
  // 弹窗内确定按钮
  coverConfirmButtonText: '确定',
  coverCancelButtonText: '取消',

  // ─── 智能创作 ──────────────────────────────────────
  autoPodcastCheckbox: '自动生成播客',
  articleToDynamicCheckbox: '图文转动态',

  // ─── 创作声明 ──────────────────────────────────────
  aiContentCheckbox: '采用AI生成内容',
  sourceCitationCheckbox: '来源说明',

  // ─── 发布 ──────────────────────────────────────────
  publishButtonText: '发布',
  saveDraftButtonText: '存草稿',
  scheduledPublishButtonText: '定时发布',

  // ─── 登录检测 ──────────────────────────────────────
  loginPageIndicator: '/passport',
  loginPageIndicatorAlt: 'login',
}

export const BROWSE_SELECTORS = {
  homeUrl: 'https://baijiahao.baidu.com/builder/rc/home',
  scrollTarget: 'body',
}

export const INTERACT_SELECTORS = {
  like: [],
  comment_input: [],
  comment_submit: [],
  follow: [],
}
