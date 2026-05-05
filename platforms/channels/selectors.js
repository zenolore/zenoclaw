/**
 * 微信视频号 CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * 视频号使用 finder-ui-desktop-* 稳定类名
 * 助手首页: https://channels.weixin.qq.com/platform
 * 发布入口: https://channels.weixin.qq.com/platform/post/create
 */

// 发帖选择器
// URL: https://channels.weixin.qq.com/platform/post/create
// ⚠️ 视频号 SPA 架构：上传表单需点击触发，Puppeteer 新标签页无法静态检测
// 实际发布需在已有登录标签页中操作
export const PUBLISH_SELECTORS = {
  // 登录检测
  loginPageIndicator: '/login',

  // 导航区域（实测: finder-ui-desktop-* 稳定类，post/create 页可见）
  navContainer: '.finder-ui-desktop-menu__wrp',
  navHeader: '.finder-ui-desktop-menu__header',
  navSubItem: '.finder-ui-desktop-sub-menu__item',

  // 视频文件上传（上传表单触发后可见）
  videoInput: 'input[type="file"]',

  // 标题/描述输入（视频号发布页的描述区域）
  titleInput: 'textarea[placeholder*="描述"], input[placeholder*="标题"]',
  descInput: 'textarea[placeholder*="描述"]',
  descInputAlt: "div[contenteditable='true']",

  // 发布按钮（文本匹配，触发后可见）
  publishButtonText: '发表',
}

// 数据读取页面选择器
export const READER_SELECTORS = {
}

// 浏览/养号选择器
// URL: https://channels.weixin.qq.com/platform
export const BROWSE_SELECTORS = {
  homeUrl: 'https://channels.weixin.qq.com/platform',

  // 导航（实测: finder-ui-desktop-* 稳定类）
  navContainer: '.finder-ui-desktop-menu__header',
  navItem: '.finder-ui-desktop-sub-menu__item',
  navLink: '.finder-ui-desktop-menu__link',

  // 内容区
  contentInfo: '.finder-content-info',
  dataContent: '.data-content',
  postPreview: '.post-preview-wrap',

  // 账号信息
  accountInfo: '.account-info',
  menuFooter: '.finder-ui-desktop-menu__footer',

  scrollTarget: '.finder-ui-desktop-menu, body',
}

// 互动选择器（备用，未实测）
export const INTERACT_SELECTORS = {
  like: [
    '[class*="like"]',
    'button[class*="like"]',
  ],
  comment_input: [
    'textarea[placeholder*="评论"]',
    'div[contenteditable="true"]',
  ],
  comment_submit: [],
  follow: [],
}

/**
 * 重要：视频号架构说明
 *
 * 主页面 = 侧栏 + 顶栏 + <iframe name="content" src="/micro/...">
 * 所有主区业务内容都在这个 iframe 内，必须用 page.frames() 进入 iframe 后才能操作。
 *
 * iframe 定位方式：
 *   const frame = page.frames().find(f => f.name() === 'content' || /\/micro\//.test(f.url()))
 */
export const IFRAME_INFO = {
  // iframe 名称和 URL pattern
  contentFrameName: 'content',
  contentFrameUrlPattern: '/micro/',
}

/**
 * 账号首页数据看板选择器
 * 页面：https://channels.weixin.qq.com/platform
 * 实测日期：2026-05-02
 *
 * 首页 bodyText 可见：账号名 / 视频号 ID / 视频 N / 关注者 N
 * 其中数字在 .common-menu-item 里，需要进侧栏账号区
 */
export const ACCOUNT_STATS_SELECTORS = {
  pageUrl: 'https://channels.weixin.qq.com/platform',
  // 侧栏账号名卡（包含账号名、视频号 ID、视频数、关注者数）
  accountInfoCard: '.common-menu-item.account-info, .common-menu-item',
  // bodyText 例：“卢传俺382 申请认证 视频号ID: sphyz2TVk6QZoDN 视频1２ 关注者２８”
  // 需要用文本驱动提取
}

/**
 * 评论管理页（在 iframe 内）
 *
 * 页面：https://channels.weixin.qq.com/platform/comment
 * iframe URL：https://channels.weixin.qq.com/micro/interaction/comment
 * 实测日期：2026-05-02
 *
 * 评论页布局：
 *   左侧：你全部视频列表（每个视频显示评论数）
 *   右侧：选中视频后该视频的评论列表 + “写评论”按钮
 *
 * 流程：
 *   1. 进 iframe
 *   2. 点 .comment-feed-wrap 选中某个视频（feed-info 末尾数字 = 评论数）
 *   3. 点 .tag-wrap.primary（写评论）当评论，
 *      或点单条评论内的 "回复" 按钮回复读者评论
 *   4. textarea.create-input 输入 placeholder="发表评论"
 */
export const COMMENT_REPLY_SELECTORS = {
  pageUrl: 'https://channels.weixin.qq.com/platform/comment',
  iframeUrlPattern: '/micro/interaction/comment',

  // 顶部过滤 tab（视频 / 图文）
  filterTab: 'a[href="javascript:void(0);"]',

  // 视频下拉选择器
  videoSelectDropdown: '.weui-desktop-form__dropdown__dt',

  // 左侧视频卡（每条评论数在 .feed-info 末尾）
  videoCard: '.comment-feed-wrap',
  videoCardContent: '.feed-content',  // 包含标题+日期+评论数
  videoCardInfo: '.feed-info',  // 日期 + 评论数末尾

  // 右侧 "写评论" 按钮（不是回评，是给该视频发一条新评论）
  writeCommentButton: '.tag-wrap.primary',
  writeCommentButtonText: '写评论',

  // 评论输入框（点 "写评论" 后出现）
  commentInput: 'textarea.create-input',
  commentInputPlaceholder: '发表评论',

  // 评论项（单条读者评论）选择器待二次探测
  // bodyText 看到 "彭先生 2022/05/04 05:07" 这种格式
  commentItem: null,         // TODO 待二次探测
  commentReplyButton: null,  // TODO 待二次探测

  // 提交按钮：在 textarea 输入后出现，需输入后二次探测
  replySubmitButton: null,   // TODO
}
