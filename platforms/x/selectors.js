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
