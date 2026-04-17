/**
 * Reddit CSS 选择器集中管理
 *
 * 实测结论（2026-04-07）：
 *   Reddit 新版全面使用 Web Components，关键元素在 Shadow DOM 内
 *
 *   标题: faceplate-textarea-input[name="title"] 是外层 web component
 *          内部有 shadowRoot.querySelector('textarea[name="title"]')
 *          必须通过 shadow DOM 访问，普通 page.$() 可选择外层 component
 *
 *   正文: [slot="rte"][contenteditable="true"] 或 div[aria-label*="正文"]
 *          就是普通 contenteditable div，可与 CDP insertText 合用
 *
 *   发布按钮: 填写标题后才出现（懒加载）
 *          实测示页面是中文，按钮文本可能为"发布"或"Post"
 *
 * 发布页面: https://www.reddit.com/submit
 * 首页: https://www.reddit.com/
 */

export const PUBLISH_SELECTORS = {
  // 标题输入（实测: faceplate-textarea-input[name="title"] web component
  //   内部 shadow DOM 有 <TEXTAREA name="title">
  //   选择外层 component 后用 shadow DOM 访问内部 textarea
  titleComponent: 'faceplate-textarea-input[name="title"]',
  titleInputInShadow: 'textarea[name="title"]',  // 在 shadowRoot 内使用

  // 正文输入（实测: contenteditable div, visible=true）
  contentInput: '[slot="rte"][contenteditable="true"]',
  contentInputAlt: 'div[aria-label*="\u6b63\u6587"]',  // aria-label="帖子正文字段"
  contentInputFallback: "div[contenteditable='true']",

  // subreddit 选择器（隐藏输入，页面已预选）
  subredditName: '[name="subredditName"]',
  subredditInput: '[name="subredditName"]',

  // 图片上传
  imageInput: "input[type='file']",

  // 发布按钮: 填写内容后启用，新版中文界面文本为"发帖"（旧版可能是"发布"）
  publishButtonText: '发帖',
  publishButtonTextAlt: 'Post',
  publishButtonTextFallbacks: ['发布', 'Submit'],
  publishButtonType: 'button[type="submit"]',

  // 登录检测（包含未登录跳转到 age verification 的情况）
  loginPageIndicator: '/login',
  ageVerifyIndicator: '/age/provide',
}

// 数据读取页面选择器（个人主页）
// 新版 Reddit 无独立数据看板，略
export const READER_SELECTORS = {
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://www.reddit.com/
export const BROWSE_SELECTORS = {
  // 首页
  homeUrl: 'https://www.reddit.com/',

  // Feed（实测: shreddit-post 可访问）
  feedContainer: 'main',
  feedItem: 'shreddit-post, [class*="Post"]',
  feedTitle: '[slot="title"], [class*="title"] a',
  feedSubreddit: '[class*="subreddit"]',

  // 搜索（实测: input[name="q"]）
  searchInput: 'input[name="q"], input[type="search"]',

  // 侧边栏（实测: aside）
  sidebar: 'aside',

  // 滚动目标
  scrollTarget: 'main',
}

// 互动选择器（2026-04-07 实测）
export const INTERACT_SELECTORS = {
  like: [
    'shreddit-post button[upvote]',
    // 新版 Reddit 投票按钮在 Shadow DOM 内，可能需要特殊处理
  ],
  comment_input: [
    "div[contenteditable='true']",
    'textarea',
  ],
  comment_submit: [
    // 文本匹配: findByText('button', 'Comment')
  ],
  follow: [
    'button[class*="join"]',
    // 文本匹配: findByText('button', 'Join')
  ],
}
