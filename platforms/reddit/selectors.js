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

/**
 * 状态指示器 + 多入口（2026-05-04 实测 reddit.com 中文界面、已登录态）
 *
 * Reddit dashboard = home（reddit.com/）；editor = /submit；
 * 顶栏「创建」按钮 a#create-post 是真实主入口（不是 directUrl 唯一选择）。
 *
 * 实测命中：
 *   - 顶栏「创建」入口：a#create-post (rect: x=1464 y=9 w=54 h=38, clickable)
 *   - 侧栏「创建社区」入口：reddit-sidebar-nav#left-sidebar ... left-nav-top-section
 *   - 编辑器：faceplate-textarea-input[name="title"]（已有）
 *   - editor URL 模式：reddit.com/submit 或 reddit.com/r/{sub}/submit
 *   - 帖子详情 URL 模式：reddit.com/r/{sub}/comments/{id}/{slug}
 */
export const STATE_INDICATORS = {
  editor: {
    urlPatterns: ['/submit', '/r/'],
    selectors: [
      'faceplate-textarea-input[name="title"]',
      '[slot="rte"][contenteditable="true"]',
      '[name="subredditName"]'
    ],
    texts: ['提交到', 'Title', '社区']
  },
  // 发布成功：URL 跳到帖子详情 reddit.com/r/{sub}/comments/{id}/...
  publishOk: {
    urlPatterns: ['/comments/', '/\\/r\\/[^/]+\\/comments\\//'],
    selectors: [
      'shreddit-post',
      'post-consume-tracker'
    ],
    texts: []  // reddit 中文界面 toast 文本不稳定，暂不依赖
  }
}

/**
 * 创作入口策略：reddit 既支持顶栏点击，也支持 directUrl，按 weight 随机择一进入
 * 不死板进入同一个 URL（用户三点要求 #1）
 */
export const CREATOR_ENTRY_SELECTORS = {
  // 顶栏「创建」按钮（reddit/home 任意页都可见）
  topbar: {
    homeUrl: 'https://www.reddit.com/',
    entrySelector: 'a#create-post',
    waitForUrl: '/submit'  // 点击后预期跳转
  },
  // directUrl：r/{sub}/submit?type=TEXT（最稳定）
  directUrl: {
    template: 'https://www.reddit.com/r/{subreddit}/submit?type=TEXT',
    fallback: 'https://www.reddit.com/submit?type=TEXT'
  }
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
