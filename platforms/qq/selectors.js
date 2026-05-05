/**
 * 企鹅号(腾讯内容开放平台) CSS 选择器集中管理（2026-04-09 实测验证）
 *
 * 企鹅号使用 ProseMirror 富文本编辑器 + omui 组件库
 * 文章编辑页: https://om.qq.com/main/creation/article
 * 入口URL: https://om.qq.com/article/articlePublish
 */

export const PUBLISH_SELECTORS = {
  // 标题输入（span.omui-inputautogrowing__inner contenteditable）
  titleInput: 'span.omui-inputautogrowing__inner',

  // 正文输入（ProseMirror contenteditable）
  contentInput: '.ProseMirror.ExEditor-basic',
  contentInputAlt: '.ProseMirror[contenteditable="true"]',

  // 摘要输入（textarea placeholder="请输入摘要"，可能隐藏需展开）
  summaryInput: 'textarea[placeholder*="摘要"]',

  // 结语输入
  epilogueInput: 'textarea[placeholder*="结语"]',

  // 标签/话题建议输入
  tagInput: 'input.omui-suggestion__value',

  // 文章类型 radio
  articleTypeRadio: 'input[type="radio"].omui-radio__input',

  // 封面上传
  coverFileInput: 'input[type="file"]',

  // 发布按钮
  publishButtonText: '发布',
  publishButtonClass: 'omui-button omui-button--primary',

  // 定时发布
  scheduledPublishText: '定时发布',

  // 存草稿
  saveDraftText: '存草稿',

  // 预览
  previewText: '预览',

  // 登录检测
  loginPageIndicator: 'userAuth',
}

export const BROWSE_SELECTORS = {
  homeUrl: 'https://om.qq.com/',
  scrollTarget: 'body',
}

export const INTERACT_SELECTORS = {
  like: [],
  comment_input: [],
  comment_submit: [],
  follow: [],
}
