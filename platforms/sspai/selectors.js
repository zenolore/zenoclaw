/**
 * 少数派 (SSPAI) CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * 注意: Puppeteer 新标签页无法访问 sspai（被拦截）
 * 选择器基于已有标签页 DOM 检查验证
 *
 * 首页: https://sspai.com/
 * 发布页: https://sspai.com/write
 */

export const PUBLISH_SELECTORS = {
  // 标题输入（实测: textarea.el-textarea__inner）
  titleInput: "textarea[placeholder*='请输入标题']",
  titleInputAlt: ".el-textarea__inner",

  // 正文输入（CKEditor 5 富文本编辑器）
  contentInput: ".ck-content.ck-editor__editable[contenteditable='true']",
  contentInputAlt: "div[contenteditable='true']",

  // 封面图上传
  imageInput: "input[type='file']",

  // 发布按钮（实测: button.btn-action 文本“发布”）
  publishButton: 'button.btn-action',
  publishButtonText: '发布',

  // 标签/话题
  tagInput: 'input[placeholder*="标签"], input[placeholder*="话题"]',

  // 登录检测
  loginPageIndicator: '/login',
}

// 数据读取页面选择器（个人主页）
// URL: https://sspai.com/u/{userId}/posts
export const READER_SELECTORS = {
  // 个人主页
  profileUrl: 'https://sspai.com/u/',
  profileName: '[class*="username"], [class*="nick"]',
  profileBio: '[class*="bio"], [class*="intro"]',

  // 文章列表
  articleList: '[class*="article-list"], [class*="post-list"]',
  articleItem: '[class*="article-item"], [class*="post-item"]',
  articleTitle: '[class*="article-title"], [class*="post-title"] a',
  articleTime: '[class*="time"], time',

  // 文章数据
  articleViews: '[class*="view-count"], [class*="views"]',
  articleLikes: '[class*="like-count"], [class*="likes"]',
  articleComments: '[class*="comment-count"], [class*="comments"]',

  // 粉丝/关注
  profileFollowers: '[class*="follower"], [class*="fans"]',
  profileFollowing: '[class*="following"]',
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://sspai.com/
export const BROWSE_SELECTORS = {
  // 首页
  homeUrl: 'https://sspai.com/',

  // Feed（实测: .feed__main 包含文章卡片）
  feedContainer: '.feed__main, .feed',
  feedItem: '.article__card__content',
  feedTitle: '.main__banner__title',
  feedAuthor: '.article__card__author__name, .article__card__author',
  feedExcerpt: '.article__card__summary',

  // 侧边栏（实测: .home__sidebar）
  sidebar: '.home__sidebar',
  sidebarItem: '.home__sidebar__item',
  sidebarActiveBtn: '.home__sidebar__btn--active',

  // Banner
  bannerItem: '.main__banner__item',

  // 评论图标
  articleComment: '.ssCommunityIcon__comment, [class*="comment"]',

  // 滚动目标
  scrollTarget: '.feed__main, .feed',
}

/**
 * 状态指示器（2026-05-04 实测 sspai.com/write，已登录态）
 *
 * sspai 主页（sspai.com/）实测**没有显式发布入口**——首页 banner 文章标题里有"创作"
 * 关键字但都是文章本身，不是发布按钮。所以 sspai 是单入口模式：directUrl `/write`，
 * 不声明 CREATOR_ENTRY_SELECTORS（用户三点要求 #1：没主入口就不用）。
 *
 * 实测命中（sspai/write）：
 *   - 顶部「发布」按钮：header#app-head ... button.btn-action 文本"发布" rect: x=1262 y=9
 *   - 顶部「草稿 N」按钮：header#app-head ... button.el-button.el-button--default rect: x=947 y=11
 *   - editor header 完整文本："草稿 10 新文章 删除 保存 预览 发布"
 *   - 标题：textarea[placeholder*='请输入标题']
 *   - 正文：.ck-content.ck-editor__editable
 *
 * 发布成功判断（用户三点要求 #3：必须真实命中）：
 *   - URL 跳转：/write → /post/{id}（文章发布后跳详情页）
 *   - 或 toast：".el-message--success" 类（element ui 框架 toast）
 *   - 或文本："发布成功" / "已发布"
 */
export const STATE_INDICATORS = {
  editor: {
    urlPatterns: ['/write'],
    selectors: [
      'header#app-head button.btn-action',
      "textarea[placeholder*='请输入标题']",
      '.ck-content.ck-editor__editable'
    ],
    texts: ['新文章', '草稿', '预览']
  },
  publishOk: {
    // URL 跳出 /write 到 /post/{id}（文章详情）；或 /matrix 矩阵审核页
    urlPatterns: ['/post/', '/matrix', 'sspai.com/u/'],
    selectors: [
      '.el-message--success',
      '.el-notification--success'
    ],
    texts: ['发布成功', '已发布', '提交成功']
  }
}

export const INTERACT_SELECTORS = {
  like: [
    'button[class*="like"]',
    '[class*="zan"]',
  ],
  collect: [
    'button[class*="collect"]',
    '[class*="bookmark"]',
  ],
  comment_input: [
    'textarea[placeholder*="评论"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  comment_submit: [
    'button[type="submit"]',
  ],
  follow: [
    'button[class*="follow"]',
  ],
}
