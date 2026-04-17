/**
 * 微信公众号 CSS 选择器集中管理（2026-04-09 Playwright 实测验证）
 *
 * 微信公众号使用 ProseMirror 富文本编辑器
 * 后台首页: https://mp.weixin.qq.com/
 * 编辑器: 通过"新的创作"→"文章"打开新标签页
 * 编辑器URL: https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77
 */

export const PUBLISH_SELECTORS = {
  // ── 标题 ──
  titleInput: 'textarea#title',
  titleInputAlt: 'textarea.js_title',

  // ── 正文（ProseMirror 编辑器） ──
  contentInput: '.ProseMirror[contenteditable="true"]',
  contentInputAlt: '#js_editor [contenteditable="true"]',

  // ── 作者 ──
  authorInput: 'input#author',
  authorInputAlt: 'input.js_author',

  // ── 摘要 ──
  digestInput: 'textarea#js_description',
  digestInputAlt: 'textarea.js_desc',

  // ── 封面 ──
  coverFileInput: 'input[type="file"][accept*="image"]',

  // ── 原创声明（点击后弹出对话框，需确认） ──
  originalSection: '.setting-group__switch.js_original_apply',
  originalSectionAlt: '.js_edit_ori',
  originalConfirmBtn: '.weui-desktop-btn_primary',
  originalAgreeCheckbox: '.original_agreement',

  // ── 赞赏 ──
  rewardSection: '.setting-group__switch.js_reward_open',

  // ── 留言 ──
  commentSection: '.setting-group__switch.js_interaction',
  commentCheckbox: '#checkbox12',
  commentAutoPublic: '.comment_checkbox',

  // ── 合集 ──
  collectionCheckbox: '.frm_checkbox_label:has(.js_album)',

  // ── 原文链接 ──
  sourceUrlCheckbox: '.frm_checkbox_label:has(.js_url)',
  sourceUrlInput: 'input[placeholder*="原文链接"]',

  // ── 创作来源 ──
  claimSourceCheckbox: '.claim_source_label_wrapper',

  // ── 展示热门划线 ──
  hotUnderlineCheckbox: '.frm_checkbox_label:has(input)',

  // ── 平台推荐 ──
  recommendCheckbox: '.not_recommend_checkbox_label',

  // ── 快捷私信 ──
  chatCheckbox: '#checkbox13',
  chatSection: '.js_chat_label',

  // ── 视频贴片 ──
  videoDotCheckbox: '#video_dot_checkbox',

  // ── 辟谣来源 ──
  rumourCheckbox: '.frm_checkbox_label:has(.js_rumor)',

  // ── 发表后转为视频号视频 ──
  videoTransferCheckbox: '.frm_checkbox_label:has(.js_video_transfer)',

  // ── 允许未付费用户留言 ──
  unpaidCommentCheckbox: '#checkbox11',

  // ── 留言权限 radios（所有用户/已关注/已关注7天+） ──
  commentPermAll: 'input[type="radio"][value="1"]',
  commentPermFollowed: 'input[type="radio"][value="2"]',
  commentPermFollowed7d: 'input[type="radio"][value="3"]',

  // ── 平台推荐 radios ──
  recommendOn: '.js_recommend_radio input[value="0"]',
  recommendOff: '.js_recommend_radio input[value="1"]',

  // ── 群发通知 radios ──
  massSendOn: '.js_mass_send_radio input[value="1"]',
  massSendOff: '.js_mass_send_radio input[value="2"]',

  // ── 操作按钮 ──
  publishButton: 'button.mass_send',
  publishButtonText: '发表',
  previewButton: 'button:has-text("预览")',
  previewText: '预览',
  saveDraftButton: 'button:has-text("保存为草稿")',
  saveDraftText: '保存为草稿',

  // ── 创建入口 ──
  createEntryText: '新的创作',
  articleMenuText: '文章',
  articleMenuSelector: '.new-creation__menu-content',

  // ── 登录检测 ──
  loginPageIndicator: '/login',
}

export const BROWSE_SELECTORS = {
  homeUrl: 'https://mp.weixin.qq.com/',
  scrollTarget: 'body',
}

export const INTERACT_SELECTORS = {
  like: [],
  comment_input: [],
  comment_submit: [],
  follow: [],
}
