/**
 * 小红书 CSS 选择器集中管理
 *
 * ⚠️ 基于 2025 年页面结构，平台改版后需更新此文件
 * 调试方法：Chrome 打开发帖页面 → F12 检查元素
 *
 * 未来计划：接入 AI 元素识别后，此文件可自动维护
 */

// 发帖页面选择器（2026-04-07 实测验证）
export const PUBLISH_SELECTORS = {
  // 图片上传
  // 上传前: .upload-input 存在；上传后: 只剩 input[type=file]
  uploadInput: '.upload-input',
  uploadInputAlt: 'input[type="file"]',

  // 标题输入（实测: <input class="d-text" placeholder="填写标题会有更多赞哦">）
  titleInput: 'input[placeholder*="填写标题"]',
  titleInputAlt: 'input[placeholder*="标题"]',
  titleInputFallback: 'input.d-text',

  // 正文输入（实测: <div class="tiptap ProseMirror" role="textbox" contenteditable="true">）
  // ⚠️ 编辑器已从 Quill 换为 Tiptap/ProseMirror，须用 CDP insertText 输入
  contentInput: '.tiptap.ProseMirror[contenteditable="true"]',
  contentInputAlt: 'div[role="textbox"][contenteditable="true"]',
  contentInputFallback: 'div[contenteditable="true"]',

  // 图片上传 fallback
  uploadInputFallback: 'input[type="file"][accept*="image"]',

  // 话题标签（实测: 编辑器下方 .bottom-wrapper 内的按钮）
  topicButton: 'button.topic-btn',
  topicContainer: '.topic-container',
  tagGroup: '.tag-group',
  recommendTopicWrapper: '.recommend-topic-wrapper',
  // publisher.js 引用的 key（与 topicButton 等价）
  tagButton: 'button.topic-btn',
  tagInput: '.tiptap.ProseMirror[contenteditable="true"]',
  tagSuggestion: '.item.is-selected, .topic-list .item',

  // 发布按钮（实测: 无可靠 CSS class，只能 findByText）
  // 主要通过 findByText('button', '发布') 匹配
  publishButtonText: '发布',

  // 暂存按钮
  saveDraftButtonText: '暂存离开',

  // 原创声明（实测: .original-wrapper 仍存在，文本"原创声明"）
  originalWrapper: '.original-wrapper',
  // 内容类型声明（2026-04-07 实测确认）
  // d-select 下拉组件，可选: 虚构演绎仅供娱乐 | 笔记含AI合成内容 | 内容包含营销广告 | 内容来源声明
  // 对于正常原创内容发布，无需选择任何声明
  contentTypeSelectText: '添加内容类型声明',
  // 如果内容含 AI 生成，应声明此项
  contentTypeAIText: '笔记含AI合成内容',

  // 定时发布（实测: .post-time-wrapper / .post-time-switch-container）
  scheduleWrapper: '.post-time-wrapper',
  scheduleSwitchContainer: '.post-time-switch-container',
  scheduleCheckboxText: '定时发布',
  scheduleDateInput: 'input[placeholder*="日期"], .post-time-wrapper input:first-of-type',
  scheduleTimeInput: 'input[placeholder*="时间"], .post-time-wrapper input:last-of-type',

  // 可见性设置（实测: "更多设置" → "公开可见" 下拉）
  visibilityText: '公开可见',
  visibilityPrivateText: '仅自己可见',
  visibilityFriendsText: '仅互关好友可见',

  // 合拍/正文复制（实测: "更多设置" → checkbox 开关）
  allowDuetText: '允许合拍',
  allowCopyText: '允许正文复制',

  // 地点（实测: .address-card-wrapper 内的 d-select 组件）
  locationWrapper: '.address-card-wrapper',
  locationSelect: '.address-card-select',
  locationPlaceholderText: '添加地点',

  // 登录检测
  loginPageIndicator: '/login',
}

// 数据读取页面选择器（创作者中心）（2026-04-07 实测验证）
// URL: https://creator.xiaohongshu.com/new/home
export const READER_SELECTORS = {
  // 创作者中心导航
  homeUrl: 'https://creator.xiaohongshu.com/new/home',
  // 侧边栏菜单项（通过文本匹配 findByText）
  navNoteManageText: '笔记管理',
  navDataBoardText: '数据看板',

  // 个人资料概览（实测: .static.description-text 内含"关注数/粉丝数/获赞与收藏"）
  profileStatBar: '.static.description-text',

  // 笔记数据总览（实测: .grouped-note-data 容器）
  dataContainer: '.datas.grouped-note-data',
  dataGroup: '.grouped-note-data-group',
  dataGrid: '.grouped-note-data-grid',
  // 每个数据项: .title 子元素文本为 曝光数/观看数/封面点击率/视频完播率/点赞数/评论数/收藏数/分享数/净涨粉/新增关注/取消关注/主页访客
  dataItemTitle: '.grouped-note-data-grid .title',
  // 统计周期（实测: .time-scope 内含"统计周期 03-31 至 04-06"）
  dataTimeScope: '.time-scope',
  // 周期切换（实测: .d-segment-item）
  dataPeriod7d: '.d-segment-item.active',
  dataPeriod30d: '.d-segment-item:not(.active)',

  // 粉丝数据（实测: .fans-current / .fans-max）
  fansCurrent: '.fans-current',
  fansMax: '.fans-max',

  // 最新笔记（实测: .latest-note → .note-container → .note-card）
  latestNote: '.latest-note',
  noteContainer: '.note-container',
  noteCard: '.note-card',
  noteImage: '.note-image',

  // 创作话题（实测: .topic-note-list → .note-card）
  topicNoteList: '.topic-note-list',
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://www.xiaohongshu.com/explore
export const BROWSE_SELECTORS = {
  // 首页
  homeUrl: 'https://www.xiaohongshu.com/explore',
  feedPage: '.feeds-page',
  feedContainer: '.feeds-container',
  feedItem: 'section.note-item',
  feedLoading: '.feeds-loading',
  // 笔记卡片内部结构
  feedTitle: 'section.note-item span:first-child',
  feedAuthor: 'section.note-item .name',
  feedLikeCount: 'section.note-item .count',
  feedLikeWrapper: '.like-wrapper',

  // 频道切换（推荐/穿搭/美食/彩妆/影视/职场/情感/家居/游戏/旅行/健身）
  channelActive: '.active.channel',
  channelItem: '.channel',

  // 搜索（实测: input.search-input placeholder="搜索小红书"）
  searchInput: 'input.search-input',
  searchIcon: '.search-icon',

  // 笔记详情页弹层（点击笔记卡片后出现）
  noteDetailContainer: '.interaction-container',
  noteDetailClose: '.close-box',
  noteDetailFollowBtn: '.note-detail-follow-btn',
  noteDetailFollowButton: 'button.follow-button',
  // 互动栏（底部）
  engageBar: '.engage-bar-container',
  engageBarInput: '.content-input',
  engageBarSubmit: 'button.btn.submit',
  engageBarCancel: 'button.btn.cancel',
  // 笔记详情页互动按钮
  detailLike: '.like-wrapper',
  detailCollect: '.collect-wrapper',
  detailShare: '.share-wrapper',
  detailChatCount: '.chat-wrapper',

  // 评论区（实测: .comments-container → .comment-item）
  commentContainer: '.comments-container',
  commentItem: '.comment-item',
  commentInner: '.comment-inner-container',
  commentMenu: '.comment-menu',
  commentInteractions: '.interactions',

  // 滚动目标（养号时需要滚动的主区域）
  scrollTarget: '.feeds-container',
}

// 互动页面选择器（2026-04-07 笔记详情页实测验证）
// 数组形式，按优先级排列，支持 fallback
export const INTERACT_SELECTORS = {
  like: [
    '.like-wrapper',
    '.like-wrapper svg',
  ],
  collect: [
    '.collect-wrapper',
    '.collect-wrapper svg',
  ],
  comment_input: [
    '.content-input',
    // 注意: 是 <p class="content-input">，非 textarea
  ],
  comment_submit: [
    'button.btn.submit',
    // 文本匹配需通过 findByText('button', '发送') 实现
  ],
  follow: [
    'button.follow-button',
    '.note-detail-follow-btn',
    // 文本匹配需通过 findByText('button', '关注') 实现
  ],
  share: [
    '.share-wrapper',
    '.share-icon-container',
  ],
}
