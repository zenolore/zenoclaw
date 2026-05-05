/**
 * 网易号 CSS 选择器集中管理（2026-04-09 实测验证）
 *
 * 网易号创作后台使用 Vue SPA + hash 路由
 * 后台首页: https://mp.163.com/#/
 * 文章编辑: 通过首页"开始创作"→"文章"按钮打开
 */

export const PUBLISH_SELECTORS = {
  // 标题输入（textarea/input placeholder 含"标题"）
  titleInput: 'textarea[placeholder*="标题"]',
  titleInputAlt: 'input[placeholder*="标题"]',

  // 正文输入（contenteditable 编辑器）
  contentInput: '[contenteditable="true"]',

  // "开始创作"区域的"文章"按钮
  createArticleText: '文章',
  createSectionClass: 'content__container__publish-item',

  // 发布按钮
  publishButtonText: '发布',

  // 登录检测（跳转到 www.163.com 表示未登录）
  loginRedirectHost: 'www.163.com',
}

export const BROWSE_SELECTORS = {
  homeUrl: 'https://mp.163.com/#/',
  scrollTarget: 'body',
}

export const INTERACT_SELECTORS = {
  like: [],
  comment_input: ['textarea[placeholder*="评论"]'],
  comment_submit: [],
  follow: [],
}
