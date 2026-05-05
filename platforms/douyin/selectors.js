/**
 * 抖音 CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * 抖音使用 semi-* 组件库 + douyin-creator-master-* 稳定类名 + CSS Module hash（不稳定）
 * 创作者中心首页: https://creator.douyin.com/
 * 视频上传页: https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web
 * 图文发布页: https://creator.douyin.com/creator-micro/content/post/imgtext
 * 文章发布页: https://creator.douyin.com/creator-micro/content/post/article
 */

// 发帖选择器（视频上传为主要发布方式）
// URL: https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web
export const PUBLISH_SELECTORS = {
  // 视频文件上传（实测: input[type="file"] 在上传区域内）
  videoInput: 'input[type="file"]',

  // 上传按钮（实测: button.semi-button-primary 文本"上传视频"）
  uploadButton: 'button.semi-button-primary',
  uploadButtonText: '上传视频',

  // 标题输入（图文发布页）
  titleInput: 'input[placeholder*="标题"], textarea[placeholder*="标题"]',

  // 发布标签页切换（实测: douyin-creator-master-* 稳定类）
  publishTabVideo: '.douyin-creator-master-navigation',
  publishTabText: '发布图文',

  // 发布按钮（实测: 上传视频后的发布按钮）
  publishButton: 'button.douyin-creator-master-button-primary',
  publishButtonText: '发布',

  // 登录检测
  loginPageIndicator: '/login',
}

// 数据读取页面选择器
export const READER_SELECTORS = {
}

/**
 * 创作者中心多入口选择器（2026-05-04 真实 DOM 实测校准）
 *
 * 实测发现（probe-creator-entries.mjs 报告）：
 *   - 创作者后台左侧主发布按钮真实文本是「高清发布」，selector `.douyin-creator-master-button-primary`
 *     位置 x=24 y=72，class 列表含 douyin-creator-master-button.douyin-creator-master-button-primary
 *   - 侧栏菜单真实文本是「创作中心」（不是"创作者中心"）
 *   - www.douyin.com 主站 header 头像 selector `header [class*="avatar"]` 命中（class semi-avatar），34x34，右上
 *   - 主站初始 DOM 里没有"创作者中心"链接，必须先 hover 头像才出现下拉
 *
 * ⚠️ Puppeteer querySelectorAll 不支持 :has-text()；文本匹配走 BasePlatformAdapter.findByText / clickByText。
 */
export const CREATOR_ENTRY_SELECTORS = {
  // 创作者中心首页（dashboard 入口的载体）
  creatorHomeUrl: 'https://creator.douyin.com/creator-micro/home',

  // 顶部"高清发布"按钮（已登录创作者后台时出现，左上）
  dashboardPublishButton: [
    '#douyin-creator-master-side-upload-wrap button.douyin-creator-master-button-primary',
    '.douyin-creator-master-button-primary',
    'button[class*="publish"]',
    'a[href*="content/upload"]'
  ],
  dashboardPublishButtonText: ['高清发布', '发布作品', '上传视频', '发布'],

  // 主站右上头像（hover 触发下拉）
  avatarTrigger: [
    'header [class*="avatar"]',
    'header .semi-avatar',
    'header img[class*="avatar"]'
  ],
  // hover 后出现的下拉里的"创作者中心" / "创作中心"
  // 注意：当前 selector 在初始 DOM 不可见；需要 hover 后再探测
  avatarMenuCreatorEntry: [
    'a[href^="https://creator.douyin.com"]',
    'a[href*="creator.douyin.com/creator-micro"]'
  ],
  avatarMenuCreatorText: ['创作中心', '创作者中心'],

  // 主站顶部"创作者中心" / "上传"入口（不通过头像菜单）
  topbarCreatorEntry: [
    'header a[href*="creator.douyin.com"]',
    'a[href*="creator.douyin.com/creator-micro/home"]'
  ],
  topbarCreatorText: ['创作者中心', '上传', '创作中心'],

  // 主站顶部右上「投稿」入口（实测 www.douyin.com/jingxuan，rect x=1547 y=6 w=24 h=44）
  // class hash 不稳定，主要靠 findByText('投稿') + 顶部坐标过滤
  topbarUploadEntry: [
    'pace-island [class*="d5oQ4GPx"]',
    'header [class*="upload"]',
    'header div[class*="post"]'
  ],
  topbarUploadText: ['投稿'],

  // 创作者后台侧栏「创作中心」入口（命中样本来自 li#douyin-creator-master-menu-nav-create）
  sideMenuCreatorEntry: [
    'li#douyin-creator-master-menu-nav-create',
    'li[class*="navigation-item"]'
  ],

  isPlaceholder: false
}

// 浏览/养号选择器
// URL: https://www.douyin.com/
export const BROWSE_SELECTORS = {
  homeUrl: 'https://www.douyin.com/',

  // Feed（实测: www.douyin.com 首页视频卡片）
  feedItem: '[class*="video-card"], [class*="feed-card"]',

  // 搜索（实测: 抖音主站顶部搜索框）
  searchInput: 'input[placeholder*="搜索"]',
}

// 互动选择器（www.douyin.com 前台看别人视频时的互动，未实测）
export const INTERACT_SELECTORS = {
  like: [
    '[class*="like-btn"]',
    '[class*="like-icon"]',
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
 * 账号首页数据看板选择器
 * 页面：https://creator.douyin.com/creator-micro/home
 * 实测日期：2026-05-02
 *
 * 首页中有 3 个 .statics-item-* 卡片：关注 N / 粉丝 N / 获赞 N
 * （class 含哈希后缀，用前缀匹配）
 */
export const ACCOUNT_STATS_SELECTORS = {
  pageUrl: 'https://creator.douyin.com/creator-micro/home',
  // 首页账号统计卡（class 名带哈希，用前缀匹配）
  staticItem: '[class*="statics-item"]',  // 包含 "关注 144" / "粉丝 573" 这种文本
  staticNumber: '[class*="number"]',
}

/**
 * 评论管理页（自己作品下读者评论的采集与回评）
 *
 * 页面：https://creator.douyin.com/creator-micro/interactive/comment
 * 实测日期：2026-05-02
 *
 * 与头条/百家号区别：抖音必须先点 "选择作品" 选中某个作品后才能看该作品下的评论，
 * 评论页面不是“跨作品资询”。当前账号作品评论为 0，评论项 DOM 结构未获取到。
 */
export const COMMENT_REPLY_SELECTORS = {
  pageUrl: 'https://creator.douyin.com/creator-micro/interactive/comment',

  // "选择作品" 按钮（必须先点才能加载该作品评论）
  selectVideoButton: '.douyin-creator-interactive-button.douyin-creator-interactive-button-primary',
  selectVideoButtonText: '选择作品',

  // 评论输入区（抖音用 div[contenteditable]，不是 textarea；
  // class 带哈希（input-d24X73），用前缀模糊匹配）
  replyInput: '[class*="input-"][contenteditable], div[contenteditable="true"][class*="input"]',

  // 发送按钮
  replySubmitButton: 'button.douyin-creator-interactive-button.douyin-creator-interactive-button-primary',
  replySubmitButtonDisabled: 'button.douyin-creator-interactive-button.douyin-creator-interactive-button-disabled',

  // 评论项未实测（当前账号评论为 0）。待你作品有评论后补。
  commentItem: null,
  commentAuthorName: null,
  commentContent: null,
  commentTimer: null,
}
