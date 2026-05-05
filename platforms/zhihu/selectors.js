/**
 * 知乎 CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * 发布页面: https://zhuanlan.zhihu.com/write
 * 创作中心: https://www.zhihu.com/creator/manage/creation/all
 * 首页: https://www.zhihu.com/
 */

// 发帖页面选择器（实测: zhuanlan.zhihu.com/write）
export const PUBLISH_SELECTORS = {
  // 标题输入（实测: label.WriteIndex-titleInput 内嵌 textarea[name="title"]）
  titleInput: 'label.WriteIndex-titleInput textarea',
  titleInputAlt: 'textarea[placeholder*="\u6807\u9898"]',

  // 正文输入（实测: Draft.js 编辑器）
  contentInput: '.Editable-content.RichText',
  contentInputAlt: 'div.public-DraftEditor-content',
  contentInputFallback: 'div[contenteditable="true"]',

  // 封面图上传
  imageInput: 'input[type="file"]',

  // 发布按钮（实测: button.Button--primary 文本"发布"）
  publishButton: 'button.Button--primary',
  publishButtonText: '发布',

  // 发布设置（实测: 右侧面板）
  publishSettingsText: '发布设置',
  addCoverText: '添加封面',

  // 话题标签（先点「添加话题」按钮，搜索框才出现）
  addTopicButtonText: '添加话题',
  tagInput: 'input[placeholder*="搜索话题"]',
  tagSuggestion: '.WriteIndex-topicItem, .TopicItem, [class*="topicItem"], [class*="TopicItem"]',

  // 登录检测
  loginPageIndicator: '/signin',
}

// 数据读取页面选择器（创作者中心）（2026-04-07 实测验证）
// URL: https://www.zhihu.com/creator/manage/creation/all
export const READER_SELECTORS = {
  // 创作者中心导航
  homeUrl: 'https://www.zhihu.com/creator/manage/creation/all',

  // 创作者主框架（实测: .Creator.Creator--v2 → .Creator-mainColumn）
  creatorContainer: '.Creator.Creator--v2',
  creatorMainColumn: '.Creator-mainColumn',
  creatorLevelInfo: '.LevelInfoV2-creatorInfo',
  creatorLevelImage: '.CreatorHomeLevelImage',

  // 侧边栏菜单（CSS Module 类名不可靠，用文本匹配）
  navContentManageText: '内容管理',
  navDataAnalysisText: '数据分析',
  navContentAnalysisText: '内容分析',
  navFollowerAnalysisText: '关注者分析',

  // 内容管理页 — 标签页（实测: a.Tabs-link）
  contentTabs: 'a.Tabs-link',
  contentTabActive: 'a.Tabs-link.is-active',

  // 内容管理页 — 日期筛选（实测: .CreatorRangePicker）
  dateRangePicker: '.CreatorRangePicker',

  // 内容管理页 — 内容卡片操作（实测: .CreationCard-ActionButton）
  contentCardAction: '.CreationCard-ActionButton',
  // 统计标签文本: 阅读/赞同/评论/收藏/喜欢 (通过 findByText 匹配)
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://www.zhihu.com/
export const BROWSE_SELECTORS = {
  // 首页
  homeUrl: 'https://www.zhihu.com/',
  // 主结构（实测: main.App-main → .Topstory）
  appMain: 'main.App-main',
  topstory: '.Topstory',

  // Feed（实测: .TopstoryItem 内嵌 .ContentItem）
  feedItem: '.TopstoryItem',
  feedContent: '.RichText.ztext',
  feedReadMore: 'button.ContentItem-more',

  // 互动按钮（实测: button.VoteButton / button.ContentItem-action）
  voteUp: 'button.VoteButton',
  voteDown: 'button.VoteButton.VoteButton--down',
  contentAction: 'button.ContentItem-action',

  // 搜索（实测: input#Popover1-toggle + button.SearchBar-searchButton）
  searchInput: 'input#Popover1-toggle',
  searchButton: 'button.SearchBar-searchButton',

  // 顶部发帖区域（实测: 文本匹配）
  postThoughtText: '发想法',
  askQuestionText: '提问题',
  writeAnswerText: '写回答',
  writeArticleText: '写文章',

  // 滚动目标
  scrollTarget: 'main.App-main',
}

// 互动页面选择器（2026-04-07 实测验证）
// 数组形式，按优先级排列，支持 fallback
export const INTERACT_SELECTORS = {
  like: [
    'button.VoteButton',
    // 文本包含 "赞同 N"
  ],
  collect: [
    'button[aria-label*="收藏"]',
    // 文本匹配需通过 findByText 实现
  ],
  comment_input: [
    'textarea[placeholder*="写下你的评论"]',
    'textarea[placeholder*="评论"]',
  ],
  comment_submit: [
    // 文本匹配需通过 findByText('button', '发布评论') 实现
  ],
  follow: [
    '.FollowButton:not(.is-followed)',
    'button[class*="follow"]',
    // 文本匹配需通过 findByText('button', '关注') 实现
  ],
}

/**
 * 账号数据看板选择器（多页综合）
 * 实测日期：2026-05-02
 *
 * 知乎数据散落在 3 个页面：
 *   - /creator (创作主页) → 账号名 / 等级 / 创作分 / 草稿箱
 *   - /creator/analytics → 阅读总量 / 赞同 / 喜欢 / 评论 / 收藏 / 分享
 *   - /creator/followers → 关注者总数 / 活跃关注者 / 占比
 *   - /creator/income-analysis → 今日收益 / 本周 / 累计收益 / 创作余额
 *
 * 各页面用文本驱动提取（"标题 + 数字" 模式）
 */
export const ACCOUNT_STATS_SELECTORS = {
  homeUrl: 'https://www.zhihu.com/creator',
  analyticsUrl: 'https://www.zhihu.com/creator/analytics',
  followersUrl: 'https://www.zhihu.com/creator/followers',
  incomeUrl: 'https://www.zhihu.com/creator/income-analysis',

  // 主页文本特征（用文本驱动）
  // bodyText 形如 "ZenoAI工作室 Lv 3 创作分 920 草稿箱 (65)"
  // 各分析页的数字都跟在标题后（"阅读总量 36"、"赞同总量 2" 等）
}

/**
 * 评论管理页（自己回答下的读者评论）
 *
 * 页面：https://www.zhihu.com/creator/manage/comment/answer
 *       (默认显示"回答"分类，可切换 /article、/idea、/zvideo、/question)
 * 实测日期：2026-05-02
 *
 * 评论管理页结构：
 *   左侧：自己的回答/文章/视频列表，每条显示评论数
 *   - 顶部 tab: 回答 / 视频 / 文章 / 想法 / 提问
 *
 * 当前账号所有回答评论数 = 0，单条评论 DOM 待你账号有评论后补。
 */
export const COMMENT_REPLY_SELECTORS = {
  pageUrl: 'https://www.zhihu.com/creator/manage/comment/answer',
  articleCommentsUrl: 'https://www.zhihu.com/creator/manage/comment/article',
  ideaCommentsUrl: 'https://www.zhihu.com/creator/manage/comment/idea',

  // 评论项（待二次探测）
  commentItem: null,
  commentReplyButton: null,
  replyTextarea: null,
  replySubmitButton: null,

  // 顶部分类 tab
  // bodyText 显示 "回答 视频 文章 想法 提问"
}

/**
 * 创作者中心多入口选择器（2026-05-04 真实 DOM 实测 zhihu.com 已登录）
 *
 * 实测发现：
 *   - 首页中央 WriteArea.Card 直接有「写文章」按钮，selector div.WriteArea.Card div.css-hv22zf，rect x=660 y=269 w=173 h=50
 *   - 顶栏「创作中心」 a.css-16zsfw9 (href=https://www.zhihu.com/creator)，rect x=1384 y=14 w=48 h=34
 *   - 右侧 CreatorEntrance Card 「进入创作中心」 a.css-uz260w (href=https://www.zhihu.com/creator)
 *   - 「去投稿」div.KfeCollection-CreateSaltCard-button 是盐言投稿入口（独立场景，非主流）
 */
export const CREATOR_ENTRY_SELECTORS = {
  creatorHomeUrl: 'https://www.zhihu.com/creator',

  // 首页 WriteArea 「写文章」入口（最显眼，登录用户首页就能看到）
  writeAreaEntry: [
    'div.WriteArea.Card div.css-hv22zf',
    'div.WriteArea.Card'
  ],
  writeAreaText: ['写文章', '写回答', '写想法'],

  // 顶栏「创作中心」入口
  topbarCreatorEntry: [
    'header a[href*="zhihu.com/creator"]',
    'a.css-16zsfw9'
  ],
  topbarCreatorText: ['创作中心'],

  // 右侧 CreatorEntrance Card 「进入创作中心」入口
  sideCreatorEntry: [
    'div.CreatorEntrance a',
    'a[href="https://www.zhihu.com/creator"]'
  ],
  sideCreatorText: ['进入创作中心', '创作中心'],

  isPlaceholder: false
}
