/**
 * V2EX CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * 发布页面: https://www.v2ex.com/new
 * 首页: https://www.v2ex.com/
 */

export const PUBLISH_SELECTORS = {
  // 标题输入
  titleInput: "input[name='title']",
  titleInputAlt: "input.sl",

  // 正文输入
  contentInput: "textarea[name='content']",
  contentInputAlt: "textarea#topic_content",
  contentInputFallback: "textarea",

  // 图片上传
  imageInput: "input[type='file']",

  // 提交按钮
  submitButton: "input[type='submit']",
  submitButtonAlt: "button[type='submit']",

  // 节点选择
  nodeSelector: "select[name='node_name']",
  nodeInput: "input[name='node_name']",

  // 登录检测
  loginPageIndicator: '/signin',
}

// 数据读取页面选择器（个人主页）
// URL: https://www.v2ex.com/member/{username}
export const READER_SELECTORS = {
  // 个人主页
  profileUrl: 'https://www.v2ex.com/member/',
  profileName: 'h1, .bigger a',
  profileBio: '.bigger + .gray',

  // 帖子列表
  postList: '.cell.item',
  postTitle: '.cell.item .item_title a',
  postNode: '.cell.item .node',
  postTime: '.cell.item .topic_info span',
  postReplies: '.cell.item .count_livid, .cell.item .count_orange',

  // 个人数据（V2EX 无详细数据看板）
  profileTopics: '#topics-count, table.balance td',
  profileReplies: '#replies-count',
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://www.v2ex.com/
export const BROWSE_SELECTORS = {
  // 首页
  homeUrl: 'https://www.v2ex.com/',

  // 分类标签（实测: a.tab / a.tab_current）
  tabCurrent: 'a.tab_current',
  tab: 'a.tab',

  // 今日热议（实测: .cell 内的 .item_hot_topic_title）
  hotTopicTitle: '.item_hot_topic_title',
  hotTopicCell: '.cell[class*="hot_t_"]',

  // 最热节点（实测: a.item_node）
  nodeItem: 'a.item_node',

  // Feed（实测: .cell.item 为帖子列表项）
  feedContainer: '#Main .box',
  feedItem: '.cell.item',
  feedTitle: '.cell.item .item_title a',
  feedAuthor: '.cell.item .topic_info strong a',
  feedNode: '.cell.item .node',
  feedReplies: '.cell.item .count_livid, .cell.item .count_orange',

  // 搜索（实测: input#search）
  searchInput: 'input#search',

  // 帖子详情页
  topicContent: '.topic_content, [class*="markdown_body"]',
  topicReplyList: '.cell[id^="r_"]',
  topicReplyContent: '.reply_content',
  topicReplyAuthor: '.cell strong a.dark',

  // 滚动目标
  scrollTarget: '#Main',
}

export const INTERACT_SELECTORS = {
  like: [
    'a[class*="thank"]',
    '[onclick*="thank"]',
  ],
  comment_input: [
    'textarea[name="content"]',
    '#reply_content',
    'textarea',
  ],
  comment_submit: [
    'input[type="submit"]',
    'button[type="submit"]',
  ],
  follow: [
    'input[value*="关注"]',
    'a[class*="follow"]',
  ],
}
