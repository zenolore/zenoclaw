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

/**
 * 账号数据看板选择器（公众号）
 * 实测日期：2026-05-02
 *
 * 公众号特点：
 *   - 后台所有页面 URL 必须带 token=xxx&lang=zh_CN
 *   - 必须复用已登录的 tab（不能新建 tab，cookie 不传递）
 *   - 多数页面是 SPA，但用 query 参数（?t=xxx）切换
 *
 * 数据来源页面：
 *   - /cgi-bin/home?t=home/index → 首页（含 公众号名 / 总用户数 / 昨日数据 / 群发列表）
 *   - /cgi-bin/contactmanage?t=user/index → 用户管理（粉丝列表 + 全部用户(N)）
 *   - /misc/appmsgcomment → 留言管理（最新留言 + 各文章留言数）
 *   - /promotion/publisher/publisher_index → 流量主收益
 *
 * 文本驱动，bodyText 形如：
 *   "{公众号名} {公众号名} 原创内容 0 总用户数 3,723 +862 昨日阅读(人) 0 昨日分享(人) 0 昨日新增关注(人) 0"
 */
export const ACCOUNT_STATS_SELECTORS = {
  homeUrlBase: 'https://mp.weixin.qq.com/cgi-bin/home',
  userManageUrlBase: 'https://mp.weixin.qq.com/cgi-bin/contactmanage',
  commentUrlBase: 'https://mp.weixin.qq.com/misc/appmsgcomment',
}

/**
 * 留言（评论）管理页选择器
 * 页面：https://mp.weixin.qq.com/misc/appmsgcomment?action=list_latest_comment...
 * 实测日期：2026-05-02
 *
 * 列表页结构：
 *   左侧：已发表内容列表，每行显示该文章的留言数
 *   右侧：最新留言（默认 5 条）
 *
 * 单条留言区块文本形如：
 *   "{作者} 留言N次 关注Y年: {留言内容} {YYYY-MM-DD HH:MM:SS} {地区}"
 *
 * 留意：单条留言的"回复/删除/精选"按钮通常 hover 才显示，
 * 且回复操作通常需进入文章详情页（cgi-bin/appmsgcomment_v2）
 */
export const COMMENT_REPLY_SELECTORS = {
  pageUrlBase: 'https://mp.weixin.qq.com/misc/appmsgcomment',
  // 回评流程比较复杂，待按需补充
  commentItem: null,
  commentReplyButton: null,
  replyTextarea: null,
  replySubmitButton: null,
}

/**
 * 创作者中心多入口选择器（2026-05-04 真实 DOM 实测 mp.weixin.qq.com 已登录）
 *
 * 实测发现：
 *   - 后台首页 div#app > div.main_bd_new > div.weui-desktop-panel > weui-desktop-panel__hd 区域显示「新的创作」
 *     文本，rect x=336 y=623 w=1190 h=52；下属包含 文章/选择已有内容/贴图/视频/转载/音频/直播
 *   - 注意：「新的创作」 div 不是 button 但是可点击（实际点击会跳转 cgi-bin/appmsg）
 *   - 「全部发表记录」 button.weui-desktop-btn (footer of list)，rect x=1407 y=1585 w=118 h=36
 */
export const CREATOR_ENTRY_SELECTORS = {
  creatorHomeUrl: 'https://mp.weixin.qq.com/',

  // 后台首页主区域「新的创作」入口
  dashboardCreateEntry: [
    'div.main_bd_new div.weui-desktop-panel > div.weui-desktop-panel__hd',
    'div.weui-desktop-panel__hd'
  ],
  dashboardCreateText: ['新的创作'],

  // 「全部发表记录」按钮（已发表入口，不是新建）
  publishedListButton: [
    'div#list_container button.weui-desktop-btn'
  ],
  publishedListText: ['全部发表记录'],

  isPlaceholder: false
}
