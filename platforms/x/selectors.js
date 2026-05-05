/**
 * X (Twitter) CSS 选择器集中管理
 *
 * 发布页面: https://x.com/compose/post
 * 最后验证: 2026-04（基于 executor platforms.ts 选择器）
 */

export const PUBLISH_SELECTORS = {
  // 正文输入（X 无标题，只有推文正文）
  contentInput: "div[data-testid='tweetTextarea_0']",
  contentInputAlt: "div[role='textbox']",

  // 图片上传
  imageInput: "input[data-testid='fileInput']",
  imageInputAlt: "input[type='file']",

  // 发推按钮
  submitButton: "button[data-testid='tweetButton']",

  // 首页发帖入口按钮（从首页点击进入编辑弹窗）
  composeButton: 'a[data-testid="SideNav_NewTweet_Button"]',
  composeButtonAlt: 'a[href="/compose/post"]',

  // 编辑弹窗（用于检测弹窗是否已打开 / 发布后是否已消失）
  composeDialog: '[data-testid="tweetTextarea_0"]',

  // 登录检测
  loginPageIndicator: '/i/flow/login',
}

// 数据读取页面选择器（个人主页/分析）
// URL: https://x.com/{username}, https://analytics.twitter.com/
export const READER_SELECTORS = {
  // 个人主页
  profileUrl: 'https://x.com/',
  profileName: '[data-testid="UserName"]',
  profileBio: '[data-testid="UserDescription"]',
  profileFollowers: 'a[href$="/verified_followers"] span, a[href$="/followers"] span',
  profileFollowing: 'a[href$="/following"] span',

  // 推文列表
  postList: '[data-testid="cellInnerDiv"]',
  postItem: 'article[data-testid="tweet"]',
  postContent: '[data-testid="tweetText"]',
  postTime: 'time',

  // 推文数据（单条推文页面）
  postLikes: '[data-testid="like"] span',
  postRetweets: '[data-testid="retweet"] span',
  postReplies: '[data-testid="reply"] span',
  postViews: '[class*="analytics"], a[href$="/analytics"]',
  postBookmarks: '[data-testid="bookmark"] span',
}

// 浏览/养号选择器
// URL: https://x.com/home
export const BROWSE_SELECTORS = {
  // 首页
  homeUrl: 'https://x.com/home',
  feedContainer: '[aria-label="Timeline: Your Home Timeline"]',
  feedItem: 'article[data-testid="tweet"]',
  feedContent: '[data-testid="tweetText"]',
  feedAuthor: '[data-testid="User-Name"]',
  feedTime: 'time',

  // 搜索
  searchUrl: 'https://x.com/explore',
  searchInput: 'input[data-testid="SearchBox_Search_Input"]',
  searchInputAlt: 'input[placeholder*="Search"], input[aria-label*="Search"]',
  searchResultItem: 'article[data-testid="tweet"], [data-testid="UserCell"]',

  // 推文详情页
  tweetDetail: 'article[data-testid="tweet"]',
  tweetDetailLike: '[data-testid="like"]',
  tweetDetailRetweet: '[data-testid="retweet"]',
  tweetDetailReply: '[data-testid="reply"]',
  tweetDetailBookmark: '[data-testid="bookmark"]',
  tweetDetailShare: '[data-testid="share"]',

  // 评论区（推文回复）
  commentList: '[aria-label*="Timeline"]',
  commentItem: 'article[data-testid="tweet"]',

  // Tab 切换（For you / Following）
  tabForYou: '[role="tab"][aria-selected]',
  tabFollowing: '[role="tab"]:not([aria-selected])',

  // 滚动目标
  scrollTarget: '[data-testid="primaryColumn"], main, section',
}

/**
 * 状态指示器 + 多入口（2026-05-04 实测 x.com，已登录态）
 *
 * X 是"主站发帖"模式：dashboard = /home，editor = /compose/post（modal 或独立页）。
 * 既有 sidebar SideNav_NewTweet_Button 入口（已实现），也有顶栏 Post 按钮 + directUrl，
 * 形式化为 CREATOR_ENTRY_SELECTORS 让 navigateToPublishViaEntry 接管，避免每次都进同一 URL。
 *
 * 实测命中（x.com/home，已登录）：
 *   - 顶栏 Post 按钮：div.r-1cwvpvk > button.css-175oi2r.r-sdzlij rect: x=972 y=127 w=66 h=36
 *   - sidebar Post 按钮：a.css-175oi2r.r-sdzlij href=/compose/post rect: x=188 y=718 w=233 h=52
 *     （等价于 a[data-testid="SideNav_NewTweet_Button"]）
 *   - compose 编辑器：div[data-testid="tweetTextarea_0"]（已有）
 *   - compose 发送按钮：button[data-testid="tweetButton"]（已有）
 *
 * 发布成功（已实现 _waitForDialogDismiss 逻辑，这里做 STATE_INDICATORS 形式化）：
 *   - URL 不再含 /compose（editor dialog 关闭时 URL 通常会变到 /home 或保持但 dialog 消失）
 *   - composeDialog selector 消失
 */
export const STATE_INDICATORS = {
  editor: {
    urlPatterns: ['/compose/post', 'x.com/compose'],
    selectors: [
      "div[data-testid='tweetTextarea_0']",
      "button[data-testid='tweetButton']",
      "div[role='textbox']"
    ],
    texts: ["What's happening", 'Post', 'Reply']
  },
  publishOk: {
    // URL 跳出 /compose（X 发推后通常 dialog 关闭并跳回 home / 保留主 URL）
    urlPatterns: ['x.com/home', '/\\/status\\//'],
    selectors: [],  // dialog 消失由 publisher 内联检测（_waitForDialogDismiss 已实现）
    texts: ['Your post was sent', 'View', '查看']
  }
}

/**
 * 创作入口策略：X 实际使用 sidebar 按钮（已实现）；
 * 这里形式化为 CREATOR_ENTRY_SELECTORS 让 publisher 可声明多入口随机择一。
 *
 * 不死板进入同一个页面（用户三点要求 #1）：
 *   - sidebar Post（最自然，X app 主要用户行为）
 *   - 顶栏 Post（首页 timeline 顶部按钮）
 *   - directUrl /compose/post（兜底）
 */
export const CREATOR_ENTRY_SELECTORS = {
  sidebar: {
    homeUrl: 'https://x.com/home',
    entrySelector: 'a[data-testid="SideNav_NewTweet_Button"]',
    waitForDialog: '[data-testid="tweetTextarea_0"]'
  },
  topbar: {
    homeUrl: 'https://x.com/home',
    // 顶栏 Post 按钮没有稳定 data-testid，用 cssPath fallback
    entrySelector: 'div[aria-label] > div > button',  // 模糊兜底
    waitForDialog: '[data-testid="tweetTextarea_0"]'
  },
  directUrl: {
    url: 'https://x.com/compose/post'
  }
}

export const INTERACT_SELECTORS = {
  like: [
    'button[data-testid="like"]',
    '[data-testid="like"]',
  ],
  retweet: [
    'button[data-testid="retweet"]',
    '[data-testid="retweet"]',
  ],
  comment_input: [
    "div[data-testid='tweetTextarea_0']",
    "div[role='textbox']",
  ],
  comment_submit: [
    "button[data-testid='tweetButton']",
  ],
  follow: [
    'button[data-testid="follow"]',
    '[data-testid*="follow"]',
  ],
}
