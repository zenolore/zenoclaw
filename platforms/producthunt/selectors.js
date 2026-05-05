/**
 * Product Hunt CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * PH 使用 Tailwind CSS + data-test 属性
 * 发布页: https://www.producthunt.com/posts/new
 * 首页: https://www.producthunt.com/
 */

export const PUBLISH_SELECTORS = {
  // 标题输入
  titleInput: 'input[name="name"], input[placeholder*="name"], input',

  // 描述/正文输入
  contentInput: 'textarea[name="tagline"], textarea[placeholder*="tagline"]',
  contentInputAlt: 'textarea',

  // 图片上传
  imageInput: "input[type='file']",

  // 提交按钮
  submitButton: 'button[type="submit"]',
  submitLink: '[data-test="header-nav-link-submit"]',
  submitButtonText: 'Submit',

  // 登录检测
  loginPageIndicator: '/login',
}

// 数据读取页面选择器
// PH 无独立数据看板
export const READER_SELECTORS = {
}

// 浏览/养号选择器（2026-04-07 实测验证）
export const BROWSE_SELECTORS = {
  homeUrl: 'https://www.producthunt.com/',

  // Feed（实测: data-test 属性）
  feedContainer: '[data-test="homepage-section-today"], main',
  feedHeadline: '[data-test="homepage-tagline"]',
  feedItem: '[data-test^="post-item"]',
  feedTitle: '[data-test^="post-name"]',
  feedUpvotes: 'button[data-test="vote-button"]',

  // 导航（实测: data-test）
  navLaunches: '[data-test="header-nav-link-launches"]',
  navSubmit: '[data-test="header-nav-link-submit"]',

  // 搜索（实测: data-test="header-search-input"）
  searchInput: '[data-test="header-search-input"]',

  // 通知
  notificationBell: '[data-test="notification-bell"]',

  // 滚动目标
  scrollTarget: 'main',
}

// 互动选择器（2026-04-07 实测）
export const INTERACT_SELECTORS = {
  like: [
    'button[data-test="vote-button"]',
  ],
  comment_input: [
    'div[contenteditable="true"]',
    'textarea',
  ],
  comment_submit: [
    // 文本匹配: findByText('button', 'Comment')
  ],
  follow: [
    // 文本匹配: findByText('button', 'Follow')
  ],
}
