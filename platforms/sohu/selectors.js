/**
 * 搜狐号 CSS 选择器集中管理（2026-04-09 Playwright 实测验证）
 *
 * 搜狐号使用 Quill 富文本编辑器
 * 内容管理页: https://mp.sohu.com/mpfe/v4/contentManagement/first/page
 * 文章编辑页: 通过"发布内容"按钮直接导航
 */

export const PUBLISH_SELECTORS = {
  // ── 标题 ──
  titleInput: 'input[placeholder*="标题"]',
  titleInputAlt: 'textarea[placeholder*="标题"]',

  // ── 正文（Quill 编辑器） ──
  contentInput: '.ql-editor[contenteditable="true"]',
  contentInputAlt: '[contenteditable="true"]',

  // ── 摘要 ──
  summaryInput: 'textarea.abstract-main-textarea',
  summaryInputAlt: 'textarea[placeholder*="摘要"]',

  // ── 原创声明（toggle 开关，非 checkbox） ──
  originalToggle: '.original-state .toggle-Original',
  originalSection: '.original-state',
  originalText: '原创',

  // ── 信息来源（radio 组，class="el-radio__original"） ──
  infoSourceRadioGroup: '.source-declaration',
  infoSourceNone: 'label:has(> .el-radio__original[value="0"])',
  infoSourceQuote: 'label:has(> .el-radio__original[value="1"])',
  infoSourceAI: 'label:has(> .el-radio__original[value="2"])',
  infoSourceFiction: 'label:has(> .el-radio__original[value="3"])',
  infoSourceNoneText: '无特别声明',
  infoSourceQuoteText: '引用声明',
  infoSourceAIText: '包含AI创作内容',
  infoSourceFictionText: '包含虚构创作',

  // ── 话题（el-select 下拉搜索） ──
  topicSection: '.select-topic',
  topicSearchInput: '.select-topic input[placeholder*="关键词搜索"]',
  topicSearchInputAlt: '.select-topic .el-input__inner',
  topicSelectInput: '.select-topic .el-select__input',

  // ── 封面 ──
  coverSection: '.cover-button',
  coverUploadText: '上传图片',
  coverFileInput: 'input[type="file"][accept*="image"]',

  // ── 栏目 ──
  columnSection: '.select-column',
  columnLinkText: '关联栏目',

  // ── 可见范围（正文100字以上才可勾选） ──
  visibleRangeSection: '.check-visible-box',
  visibleRangeText: '必须登录才能查看全文',

  // ── 操作按钮 ──
  publishButton: 'li.publish-report-btn.active.positive-button',
  publishButtonText: '发布',
  timedPublishButton: 'li.timeout-pub',
  saveDraftButton: 'li.publish-report-btn.normal.negative-button',
  previewButton: 'li.normal.negative-button',

  // ── 内容管理页入口 ──
  publishEntryText: '发布内容',
  articleTabText: '文章',

  // ── 登录检测 ──
  loginPageIndicator: '/login',
}

export const BROWSE_SELECTORS = {
  homeUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
  scrollTarget: 'body',
}

export const INTERACT_SELECTORS = {
  like: [],
  comment_input: [],
  comment_submit: [],
  follow: [],
}
