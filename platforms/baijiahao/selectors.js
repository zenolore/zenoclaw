/**
 * 百家号 CSS 选择器集中管理（2026-04-16 MCP 实测重写）
 *
 * 编辑器: Lexical 标题 + UEditor iframe 正文
 * 文章发布页: https://baijiahao.baidu.com/builder/rc/edit?type=news
 *
 * 页面组件:
 *   标题 → Lexical contenteditable div[data-lexical-editor="true"]
 *   正文 → UEditor iframe#ueditor_0 body.view[contenteditable="true"]
 *   封面 → 单图/三图 radio → 选择封面按钮 → 弹窗(正文/本地上传 | AI封图 | 免费正版图库)
 *   智能创作 → 自动生成播客 checkbox / 图文转动态 checkbox
 *   创作声明 → 采用AI生成内容 checkbox / 来源说明 checkbox
 *   底部 → 存草稿 | 预览 | 定时发布 | 发布
 */

export const PUBLISH_SELECTORS = {
  // ─── 标题 ──────────────────────────────────────────
  // Lexical 编辑器，data-testid="news-title-input" 内的 contenteditable div
  titleContainer: '[data-testid="news-title-input"]',
  titleEditor: '[data-testid="news-title-input"] div[contenteditable="true"][data-lexical-editor="true"]',
  // 隐藏的 textarea 模拟器（备用）
  titleSimulator: '[data-testid="news-title-input"] textarea',

  // ─── 正文 ──────────────────────────────────────────
  // UEditor iframe（id="ueditor_0"）内的 body
  contentIframeId: 'ueditor_0',
  contentIframeBody: 'body[contenteditable="true"]',
  contentIframeBodyAlt: 'body.view',

  // ─── 封面 ──────────────────────────────────────────
  // 封面类型 radio
  coverRadioSingle: 'input[type="radio"][value="one"]',
  coverRadioTriple: 'input[type="radio"][value="three"]',
  // 选择封面按钮（打开弹窗）
  coverSelectButtonText: '选择封面',
  // 弹窗内 file input（hidden, name="media"）
  coverFileInput: 'input[name="media"][type="file"]',
  // 弹窗内确定按钮
  coverConfirmButtonText: '确定',
  coverCancelButtonText: '取消',

  // ─── 智能创作 ──────────────────────────────────────
  autoPodcastCheckbox: '自动生成播客',
  articleToDynamicCheckbox: '图文转动态',

  // ─── 创作声明 ──────────────────────────────────────
  aiContentCheckbox: '采用AI生成内容',
  sourceCitationCheckbox: '来源说明',

  // ─── 发布 ──────────────────────────────────────────
  publishButtonText: '发布',
  // 2026-04-18：实测稳定 selector（优先于文本匹配，避免误点其他"发布"元素）
  publishButton: 'button[data-testid="publish-btn"]',
  saveDraftButtonText: '存草稿',
  scheduledPublishButtonText: '定时发布',
  // 发布后可能的二次确认弹窗
  confirmModal: '.cheetah-modal-content, [role="dialog"], .ant-modal-content',
  confirmButtonTexts: ['确认发布', '确定发布', '立即发布', '确认', '确定'],

  // ─── 登录检测 ──────────────────────────────────────
  loginPageIndicator: '/passport',
  loginPageIndicatorAlt: 'login',
}

export const BROWSE_SELECTORS = {
  homeUrl: 'https://baijiahao.baidu.com/builder/rc/home',
  scrollTarget: 'body',
}

// 互动选择器：百家号是作者后台为主，前台文章详情页互动未探测。
// 如需互动别人文章可参考评论面板结构。
export const INTERACT_SELECTORS = {
  like: [],
  comment_input: [],
  comment_submit: [],
  follow: [],
}

/**
 * 账号首页数据看板选择器
 * 页面：https://baijiahao.baidu.com/builder/rc/home
 * 实测日期：2026-05-02
 *
 * 首页上可见数据卡：
 *   - 累计投稿量 38
 *   - 累计百度搜索量 0 昨日 +552
 *   - 总粉丝量 0 昨日 0
 *   - 评论量 0
 */
export const ACCOUNT_STATS_SELECTORS = {
  pageUrl: 'https://baijiahao.baidu.com/builder/rc/home',
  // 首页“近期数据 / 数据总览”区域中的数据卡。未发现统一 class，用文本定位：
  // 某 块 包含 “总粉丝量”、“累计投稿量”、“累计百度搜索量”、“评论量”等标题，同一 div 同时包含数字。
}

/**
 * 评论管理页（自己文章下读者评论的采集与回评）
 *
 * 页面：https://baijiahao.baidu.com/builder/rc/commentmanage/comment/all
 * 实测日期：2026-05-02 在用户已登录的 Chrome 9222 中探测过
 *
 * 与头条区别：百家号每条评论旁边直接内嵌输入框（textarea + 0/500 计数），不需点击展开。
 */
export const COMMENT_REPLY_SELECTORS = {
  pageUrl: 'https://baijiahao.baidu.com/builder/rc/commentmanage/comment/all',

  // 顶部过滤 tab（全部/图文/视频/小视频/动态/图集/待删除）
  filterTab: '.cheetah-tabs-tab-btn',
  filterTabActive: '.cheetah-tabs-tab-btn-active, .cheetah-tabs-tab-btn.cheetah-tabs-tab-btn-active',

  // 单条评论项
  commentItem: '.client_pages_comment_item',

  // 评论内容、作者、被评论的文章标题（文本包含 “评论了你的图文《...》” 或 “评论了你的视频《...》”）
  // 未看到独立 class，需在 commentItem 范围内靠正则提取

  // 评论项右上 “点赞”/“回复” 统计
  commentLikeStat: '.comment-like.like-normal',
  commentReplyStat: '.comment-reply',

  // 回复输入区（内嵌，无需点击展开）
  // textarea cssPath 关键: .reply-inp-contanier > .cheetah-textArea > textarea.cheetah-input
  // 注意：reply-inp-contanier 是百家号拼写（不是 container）
  replyTextarea: '.reply-inp-contanier textarea.cheetah-input',
  replyTextareaPlaceholder: '请输入回复的内容',

  // 发送按钮：.reply-btn 是包装 div，里面是真正的 button.cheetah-btn-primary。
  replyBtnContainer: '.reply-btn',
  replySubmitButton: '.reply-btn button.cheetah-btn-primary',

  // 最大字符限制
  maxReplyChars: 500,
}

/**
 * 创作者中心多入口选择器（2026-05-04 真实 DOM 实测 baijiahao.baidu.com 已登录）
 *
 * 实测发现：
 *   - 后台首页左上「发布作品」按钮 div#home-publish-btn，rect x=24 y=84 w=152 h=40
 *   - 没有"创作"独立入口，"发布作品"是 dashboard 主入口
 */
export const CREATOR_ENTRY_SELECTORS = {
  creatorHomeUrl: 'https://baijiahao.baidu.com/builder/rc/home',

  // 后台首页主发布按钮
  dashboardPublishButton: [
    '#home-publish-btn',
    'div#home-publish-btn'
  ],
  dashboardPublishButtonText: ['发布作品', '发布'],

  isPlaceholder: false
}
