/**
 * B站 (Bilibili) CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * B站使用 bili-* 前缀类名（首页）+ vui_* 组件类名（编辑器 iframe 内）
 * 首页: https://www.bilibili.com/
 * 投稿页: https://member.bilibili.com/platform/upload/text/new-edit
 *
 * ❗ 专栏编辑器在 iframe 内: https://member.bilibili.com/york/read-editor?
 * 操作这些选择器时需要先 switchToFrame()
 */

// 发帖选择器
// URL: https://member.bilibili.com/platform/upload/text/new-edit
// 
// ⚠️ 实测结论（2026-04-07）：
//    主页面 完全没有 input/textarea/button
//    标题输入、正文编辑器、发布按钮 全在 york/read-editor iframe 内
//    必须先 frame = await frameEl.contentFrame()，再在 frame 内操作
export const PUBLISH_SELECTORS = {
  // 正确发布页 URL（实测: /edit 会重定向到 /new-edit）
  publishUrl: 'https://member.bilibili.com/platform/upload/text/new-edit',

  // iframe 选择器（在主页面匹配，然后 .contentFrame() 切换进去）
  editorFrame: 'iframe[src*="read-editor"]',

  // 标题输入（实测: iframe 内 textarea.title-input__inner
  //          placeholder="请输入标题（建议30字以内）"）
  titleInput: 'textarea[placeholder*="请输入标题"]',
  titleInputAlt: '.title-input__inner',

  // 正文输入（实测: iframe 内 TipTap/ProseMirror 编辑器）
  contentInput: '.tiptap.ProseMirror.eva3-editor',
  contentInputAlt: '.eva3-editor',

  // 发布按钮（实测: iframe 内 button.vui_button--blue 文本"发布"）
  publishButton: 'button.vui_button--blue',
  publishButtonText: '发布',

  // 话题按钮
  topicButton: 'button.topic-button',

  // 登录检测
  loginPageIndicator: '/login',
}

// 数据读取页面选择器
// B站创作中心: https://member.bilibili.com/platform/home
export const READER_SELECTORS = {
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://www.bilibili.com/
export const BROWSE_SELECTORS = {
  homeUrl: 'https://www.bilibili.com/',

  // Feed（实测: .bili-video-card 视频卡片, .feed-card 信息流卡片）
  feedContainer: 'main.bili-feed4-layout, .feed2',
  feedItem: '.bili-video-card, .bili-feed-card',
  feedTitle: '.bili-video-card__info--tit, .carousel-footer-title',
  feedAuthor: '.bili-video-card__info--author',

  // 推荐轮播（实测: .recommended-swipe）
  recommendSwipe: '.recommended-swipe',

  // 频道导航（实测: .channel-icons__item）
  channelItem: '.channel-icons__item',

  // 搜索（实测: input.nav-search-input）
  searchInput: 'input.nav-search-input',

  // 导航入口
  navUpload: '.right-entry-item--upload',
  navDynamic: 'a.channel-icons__item',

  // 滚动目标
  scrollTarget: 'main.bili-feed4-layout, .feed2',
}

// 互动选择器（2026-04-07 实测）
export const INTERACT_SELECTORS = {
  like: [
    '.video-like',
    'button[class*="like"]',
  ],
  comment_input: [
    'textarea[placeholder*="评论"]',
    'div[contenteditable="true"]',
  ],
  comment_submit: [
    // 文本匹配: findByText('button', '发布')
  ],
  follow: [
    // 文本匹配: findByText('button', '关注')
  ],
}

/**
 * 账号首页数据选择器
 * 页面：https://member.bilibili.com/platform/home
 * 实测日期：2026-05-02
 */
export const ACCOUNT_STATS_SELECTORS = {
  pageUrl: 'https://member.bilibili.com/platform/home',
  // bodyText 形如 "成为UP主的第2251天"，需文本驱动
}

/**
 * 评论管理页（自己作品下读者评论的采集与回评）
 *
 * 页面：https://member.bilibili.com/platform/comment/article
 * 实测日期：2026-05-02
 *
 * 顶部 tab：用户可见评论 / 待精选评论 / 视频评论 / 专栏评论 / 音频评论
 * 排序: 最近发布 / 点赞最多 / 回复最多
 *
 * 单条评论容器：.comment-list-item（含 视频标题 + 评论者 + 评论文本 + 日期 + 回复按钮）
 *   .ci-title          → 评论者名字
 *   span.reply.action  → 回复按钮
 *
 * 列表容器：.section-list_wrap
 */
export const COMMENT_REPLY_SELECTORS = {
  pageUrl: 'https://member.bilibili.com/platform/comment/article',

  // 顶部 tab 是 .bcc-tabs__item 之类的（待二次确认 class）
  // 排序选项

  // 评论列表容器
  commentListWrap: '.section-list_wrap',

  // 单条评论项
  commentItem: '.comment-list-item',
  // 评论者名字
  commentAuthorName: '.ci-title',

  // 回复按钮（每条评论右侧）
  commentReplyButton: 'span.reply.action',

  // 操作按钮（顶部全选/举报/删除）
  reportButton: 'button.bcc-button.bcc-button--default',
  deleteButton: 'button.bcc-button.del',

  // 输入框/提交按钮（点击"回复"后弹出，待二次探测）
  replyTextarea: null,    // TODO 待点击回复后二次探测
  replySubmitButton: null,
}

/**
 * 创作者中心多入口选择器（2026-05-04 真实 DOM 实测）
 *
 * 实测发现：
 *   - 主站 www.bilibili.com 顶部"投稿"按钮 selector：li.right-entry-item--upload > li.v-popover-wrap > a
 *     href = https://member.bilibili.com/platform/upload/video/frame，rect x=1502 y=15 w=100 h=34
 *   - 主站顶部"创作中心" selector：a.right-entry__outside (href=https://member.bilibili.com/platform/home)
 */
export const CREATOR_ENTRY_SELECTORS = {
  creatorHomeUrl: 'https://member.bilibili.com/platform/home',
  publishUrl: 'https://member.bilibili.com/platform/upload/text/new-edit',

  // 主站顶部"投稿"入口（A 元素，可直接 click 跳到投稿主页）
  topbarUploadEntry: [
    'li.right-entry-item--upload li.v-popover-wrap > a',
    'li.right-entry-item--upload a',
    'a[href*="member.bilibili.com/platform/upload"]'
  ],
  topbarUploadText: ['投稿', '上传'],

  // 主站顶部"创作中心"入口
  topbarCreatorEntry: [
    'a.right-entry__outside',
    'a[href*="member.bilibili.com/platform/home"]'
  ],
  topbarCreatorText: ['创作中心', '创作'],

  // 创作者中心后台的"投稿"按钮（实测 a#nav_upload_btn，左上 x=32 y=84）
  dashboardUploadEntry: [
    'a#nav_upload_btn',
    'div.nav-upload-btn',
    'a[href*="member.bilibili.com/platform/upload"]'
  ],
  dashboardUploadText: ['投稿', '专栏投稿', '视频投稿'],

  isPlaceholder: false
}
