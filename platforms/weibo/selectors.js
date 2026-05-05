/**
 * 微博 CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * 微博使用 woo-* 设计系统类名（稳定）+ CSS Module hash（不稳定）
 * 首页: https://weibo.com/
 * 发布页: https://weibo.com/ （首页弹窗式发布）
 */

// 发帖选择器
// 微博发帖通过首页顶部弹窗编辑器，非独立页面
export const PUBLISH_SELECTORS = {
  // 正文输入（首页编辑器或弹窗）
  // 编辑器（实测: textarea placeholder="有什么新鲜事想分享给大家？"）
  contentInput: 'textarea[placeholder*="有什么新鲜事"]',

  // 图片上传
  imageInput: 'input[type="file"]',

  // 发布按钮（实测: 文本"发送"，非"发布"）
  publishButtonText: '发送',

  // 触发编辑器的按钮
  writeButtonText: '写微博',

  // 登录检测
  loginPageIndicator: 'newlogin',
}

// 数据读取页面选择器
// 微博个人主页: https://weibo.com/u/{uid}
export const READER_SELECTORS = {
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://weibo.com/
export const BROWSE_SELECTORS = {
  homeUrl: 'https://weibo.com/',

  // Feed（实测: .wbpro-feed-content 包含微博正文）
  feedContainer: '#app',
  feedItem: '.wbpro-feed-content',

  // 搜索（实测: input.woo-input-main placeholder="搜索微博"）
  searchInput: 'input[placeholder*="搜索"]',
  searchInputAlt: 'input.woo-input-main',

  // 标签页导航（实测: .woo-box-item-inlineBlock）
  tabItem: '.woo-box-item-inlineBlock',

  // 滚动目标
  scrollTarget: '#app',
}

// 互动选择器（2026-04-07 实测）
export const INTERACT_SELECTORS = {
  like: [
    'button.woo-like-main',
    '.woo-like-main',
  ],
  comment_input: [
    'textarea[placeholder*="评论"]',
    'textarea[placeholder*="转发"]',
    'div[contenteditable="true"]',
  ],
  comment_submit: [
    // 文本匹配: findByText('button', '评论')
  ],
  follow: [
    // 文本匹配: findByText('button', '关注')（实测: woo-button 文本"关注"）
  ],
}
