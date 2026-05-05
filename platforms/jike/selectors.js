/**
 * 即刻 CSS 选择器集中管理（2026-04-07 实测验证）
 *
 * 发布页面: https://web.okjike.com/following
 * 首页: https://web.okjike.com/
 *
 * 注意: 即刻使用 Mantine UI + CSS Modules，类名有 hash 后缀
 * 优先用 Mantine 组件类、属性选择器、文本匹配
 */

// 发帖页面选择器（实测: web.okjike.com/following）
// 即刻无独立标题字段，只有正文 + 图片
export const PUBLISH_SELECTORS = {
  // 正文输入（实测: .content-editor 内 contenteditable）
  contentInput: '.content-editor [contenteditable="true"]',
  contentInputAlt: "div[contenteditable='true']",

  // 图片上传
  imageInput: "input[type='file']",

  // 发送按钮（实测: button[type="submit"]）
  submitButton: 'button[type="submit"]',
  submitButtonText: '发送',

  // 圈子/话题选择（实测: input[placeholder="未选择圈子"]）
  topicInput: 'input[placeholder*="圈子"]',
  topicInputAlt: '[class*="topic"] input',

  // 登录检测
  loginPageIndicator: '/login',
}

// 数据读取页面选择器（个人主页）
// URL: https://web.okjike.com/u/{userId}
export const READER_SELECTORS = {
  // 个人主页
  profileUrl: 'https://web.okjike.com/u/',
  profileName: '[class*="username"], [class*="UserName"]',
  profileBio: '[class*="bio"], [class*="description"]',

  // 动态列表
  postList: '[class*="MessageList"], [class*="message-list"]',
  postItem: '[class*="MessageItem"], [class*="message-item"]',
  postContent: '[class*="MessageContent"], [class*="content"]',
  postTime: '[class*="time"], time',

  // 动态数据
  postLikes: '[class*="like-count"], [class*="LikeCount"]',
  postComments: '[class*="comment-count"], [class*="CommentCount"]',
  postShares: '[class*="repost-count"], [class*="RepostCount"]',

  // 粉丝/关注
  profileFollowers: '[class*="follower"], [class*="FollowerCount"]',
  profileFollowing: '[class*="following"], [class*="FollowingCount"]',
}

// 浏览/养号选择器（2026-04-07 实测验证）
// URL: https://web.okjike.com/
export const BROWSE_SELECTORS = {
  // 首页（实测: 跳转到 /following）
  homeUrl: 'https://web.okjike.com/',

  // Feed 容器（实测: Mantine ScrollArea）
  feedContainer: '.mantine-ScrollArea-content',
  // Feed 项目（实测: CSS Module hash 类名，用 content 匹配）
  feedContent: '[class*="content"]',
  feedAuthor: '[class*="username"]',

  // 滚动目标（实测: Mantine ScrollArea）
  scrollTarget: '.mantine-ScrollArea-content',
}

// 互动页面选择器（2026-04-07 实测验证）
/**
 * 状态指示器（2026-05-04 实测 web.okjike.com/following，已登录态）
 *
 * jike 是"主页即编辑器"模式：/ 自动重定向到 /following，编辑器在 feed 顶部，
 * 不需要"先点 Compose 按钮"，所以不声明 CREATOR_ENTRY_SELECTORS。
 *
 * 实测数据：
 *   - editor 框架：form._form_k9vch_1 / div._postForm_11r90_1
 *   - 占位文本："分享你的想法..."
 *   - 发送按钮：footer._footer_k9vch_24 button.mantine-focus-auto._root_1rtyu_1
 */
export const STATE_INDICATORS = {
  // 编辑器就绪：URL 在 / 或 /following，且发布表单 + 占位符可见
  editor: {
    urlPatterns: ['web.okjike.com/following', 'web.okjike.com/'],
    selectors: [
      'form._form_k9vch_1',
      'div._postForm_11r90_1',
      'div._container_14fa3_1.content-editor'  // 实测的编辑框 inner container
    ],
    texts: ['分享你的想法']
  },
  // 发布成功：编辑框被清空（jike 发送后 UI 直接 reset，无 toast）
  // 这里不能仅靠 selector 缺失（form 仍在），所以走文本检测：编辑框无 placeholder 可见说明已重置
  // 实测策略：发送后编辑框文本被清空（< 10 字符）；这个由 publisher.js 内联检测，
  // STATE_INDICATORS.publishOk 仅作为"再次出现编辑器占位符"的弱信号
  publishOk: {
    urlPatterns: ['web.okjike.com/following', 'web.okjike.com/'],
    selectors: ['form._form_k9vch_1'],  // 编辑器仍在 = 页面没崩；配合 publisher 内联编辑框清空判断
    texts: ['分享你的想法']
  }
}

export const INTERACT_SELECTORS = {
  like: [
    '[class*="likeButton"]',
    '[class*="LikeButton"]',
    // 文本匹配需通过 findByText 实现
  ],
  comment_input: [
    '[contenteditable="true"]',
    'textarea',
  ],
  comment_submit: [
    'button[type="submit"]',
  ],
  follow: [
    'button[class*="follow"]',
    // 文本匹配需通过 findByText('button', '关注') 实现
  ],
}
