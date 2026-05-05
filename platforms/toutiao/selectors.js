/**
 * 今日头条 CSS 选择器集中管理（2026-04-14 MCP 实测全量验证）
 *
 * 头条使用 byte-* 组件库 + syl-* 编辑器类名
 * 文章发布页: https://mp.toutiao.com/profile_v4/graphic/publish
 * 视频上传页: https://mp.toutiao.com/profile_v4/xigua/upload-video
 * 微头条页:  https://mp.toutiao.com/profile_v4/weitoutiao/publish
 */

// 发帖选择器（文章模式）
// URL: https://mp.toutiao.com/profile_v4/graphic/publish
export const PUBLISH_SELECTORS = {
  // ===== 内容区 =====

  // 标题输入（TEXTAREA，无 class，用 placeholder 定位）
  titleInput: 'textarea[placeholder*="请输入文章标题"]',

  // 正文编辑器（ProseMirror 富文本，div[contenteditable="true"]）
  contentInput: '.ProseMirror[contenteditable="true"]',
  contentInputAlt: '.ProseMirror',

  // 工具栏按钮
  toolbarButton: 'button.syl-toolbar-button',

  // ===== 右侧设置面板（pgc-edit-cell）=====

  // 展示封面区域容器
  coverSection: '.pgc-edit-cell.required',

  // 封面模式 radio（value: 2=单图, 3=三图, 1=无封面）
  coverModeRadioGroup: '.article-cover-radio-group',
  coverModeRadio: '.article-cover-radio-group input[type="radio"]',
  // 单图模式 label
  coverModeSingle: '.article-cover-radio-group input[type="radio"][value="2"]',
  // 三图模式 label
  coverModeTriple: '.article-cover-radio-group input[type="radio"][value="3"]',
  // 无封面模式 label
  coverModeNone:   '.article-cover-radio-group input[type="radio"][value="1"]',

  // 封面上传触发区（点击后动态注入 input[type=file]）
  coverAddBtn: '.article-cover-add',
  // 上传后动态注入的 file input（需等待出现）
  // 2026-04-17: 三图模式下 file input 被注入到 document.body 下的 .upload-handler 弹窗中，
  // 不在 .article-cover-images 下，所以使用通用 selector
  coverFileInput: '.upload-handler input[type="file"], .upload-handler-drag input[type="file"], .article-cover-images input[type="file"]',

  // 添加位置
  locationCell: '.pgc-edit-cell.position-cell',
  locationSelect: '.pgc-edit-cell.position-cell .position-select',
  locationInput: '.pgc-edit-cell.position-cell .byte-select-view-search input',
  locationDropdownItem: '.byte-select-option, .byte-select-item',
  locationValue: '.pgc-edit-cell.position-cell .byte-select-view-value',

  // 投放广告 radio（value: 3=投放广告赚收益）
  adRadioGroup: '.byte-radio-group:has(.article-ad-radio)',
  adRadioOn:  '.article-ad-radio input[type="radio"][value="3"]',
  adRadioOff: '.article-ad-radio input[type="radio"][value="2"]',

  // 声明首发 checkbox（class: exclusive-checkbox-wraper）
  exclusiveCheckbox: '.exclusive-checkbox-wraper',
  exclusiveCheckboxItem: '.exclusive-checkbox-wraper .byte-checkbox',
  rightsProtectionCell: '.rights-protection, .exclusive-basic-select',
  rightsProtectionCheckbox: '.rights-protection .byte-checkbox, .exclusive-basic-select .byte-checkbox',
  rightsProtectionInput: '.rights-protection input[type="checkbox"], .exclusive-basic-select input[type="checkbox"]',
  rightsProtectionDialog: '.byte-modal',

  // 合集 - 添加至合集按钮
  collectionCell:   '.collection-form-item',
  collectionButton: '.collection-form-item button',
  collectionModal: '.byte-modal.add-collection-modal, .article-publish-add-collection',
  collectionItem: '.byte-modal.add-collection-modal .add-collection-item, .article-publish-add-collection .add-collection-item',
  collectionItemCheckbox: '.byte-modal.add-collection-modal .add-collection-item .byte-checkbox, .article-publish-add-collection .add-collection-item .byte-checkbox',
  collectionConfirmButton: '.byte-modal.add-collection-modal button, .article-publish-add-collection button',

  // 同时发布微头条 toggle
  microToutiaoCell: '.pgc-edit-cell.form-tuwen_wtt_trans',
  microToutiaoToggle: '.pgc-edit-cell.form-tuwen_wtt_trans .byte-checkbox',
  microToutiaoInput: '.pgc-edit-cell.form-tuwen_wtt_trans input[type="checkbox"]',

  // 作品声明 checkboxes（MCP 实测: 容器 div.source-wrap，每项 label.byte-checkbox.checkbot-item）
  // checked 判定: label 上有 byte-checkbox-checked class
  declarationGroup: '.source-wrap',
  declarationCheckbox: '.source-wrap label.byte-checkbox.checkbot-item',

  // ===== 底部操作栏 =====

  // 预览并发布（MCP 实测: button.byte-btn-primary.publish-btn，文本"预览并发布"）
  // 注意: 没有 publish-btn-last class，用文本匹配更可靠
  publishBtn: 'button.byte-btn-primary.publish-btn',
  publishBtnAlt: 'button.publish-btn',

  // 定时发布按钮（MCP 实测: 也是 button.publish-btn，文本"定时发布"）
  scheduleBtn: 'button.publish-btn',

  // 定时发布弹窗（MCP 实测: div.byte-modal.common-timing-picker inside [role="dialog"]）
  scheduleModal: '.byte-modal.common-timing-picker',
  scheduleModalWrapper: '[role="dialog"]',

  // 弹窗内 3 个下拉（MCP 实测: .day-select / .hour-select / .minute-select）
  scheduleDaySelect:    '.common-timing-picker .day-select .byte-select-view',
  scheduleHourSelect:   '.common-timing-picker .hour-select .byte-select-view',
  scheduleMinuteSelect: '.common-timing-picker .minute-select .byte-select-view',
  // 下拉选项（listitem 元素）
  scheduleOption: '.common-timing-picker li',

  // 确认按钮（MCP 实测: .byte-modal-footer 内 button.byte-btn-primary，文本"预览并定时发布"）
  scheduleConfirmButton: '.common-timing-picker .byte-modal-footer button.byte-btn-primary',
  scheduleCancelButton:  '.common-timing-picker .byte-modal-footer button.byte-btn-default',

  // 预览
  previewBtn: 'button.byte-btn-default.publish-btn',

  // ===== 登录检测 =====
  loginPageIndicator: '/login',
}

// 微头条选择器
// URL: https://mp.toutiao.com/profile_v4/weitoutiao/publish
export const MICRO_SELECTORS = {
  contentInput: 'textarea[placeholder*="说点什么"]',
  imageInput: 'input[type="file"]',
  publishButtonText: '发布',
}

// 数据读取页面选择器
export const READER_SELECTORS = {
}

// 浏览/养号选择器
// 注: www.toutiao.com 有反爬限制，改用创作平台主页
export const BROWSE_SELECTORS = {
  homeUrl: 'https://mp.toutiao.com/profile_v4/index',

  // 创作平台主页（实测: .pgc-content + 导航菜单）
  feedContainer: '.pgc-content, .pgc-main',
  menuItem: '.byte-menu-item',
  menuGroup: '.byte-menu-inline',

  // 数据面板
  dataTitle: '.data-board-item-title',

  scrollTarget: '.pgc-content, body',
}

// 互动选择器（阅读其他头条文章详情页时的点赞/评论/收藏/关注）
// 选择器来源：2026-05-02 在 www.toutiao.com/article/<id>/ 页面实测
export const INTERACT_SELECTORS = {
  // 点赞按钮：.detail-like（含设数，如 "760"）、aria-label*="点赞"
  like: [
    '.detail-like',
    '[aria-label*="点赞"]',
  ],
  // 评论输入框：头条文章详情页需要点击 "评论" 按钮后才出现输入区，
  // 点击后为可输入状态。如需要 publisher 实现可参考后台评论面板结构。
  comment_input: [
    '.detail-interaction-comment',  // 点击这个展开评论区
    'textarea[placeholder*="评论"]',
  ],
  // 评论提交按钮：展开评论区后出现（未实测到出现按钮的选择器，需交互探测）
  comment_submit: [
    'button[class*="submit"]',
  ],
  // 收藏按钮：.detail-interaction-collect
  collect: [
    '.detail-interaction-collect',
    '[aria-label*="收藏"]',
  ],
  // 分享按钮：.ttp-interact-share
  share: [
    '.ttp-interact-share',
  ],
  // 关注按钮：.user-subscribe-wrapper button（本身就是 button），文本“关注”
  follow: [
    '.user-subscribe-wrapper',
    'button.user-subscribe-wrapper',
  ],
}

/**
 * 自己文章下读者评论的采集与回评选择器
 *
 * 页面：https://mp.toutiao.com/profile_v4/manage/comment/all
 * 实测：2026-05-02 在用户已登录的 Chrome 9222 里点击“回复”后右侧面板出现
 *
 * 与上面 INTERACT_SELECTORS 区分：
 *   - INTERACT_SELECTORS  = 去其他人文章里互动（点赞/收藏/关注）
 *   - COMMENT_REPLY       = 在后台评论管理里回复自己文章下的读者评论
 */
export const COMMENT_REPLY_SELECTORS = {
  pageUrl: 'https://mp.toutiao.com/profile_v4/manage/comment/all',

  // 顶部过滤 tab（全部/文章/视频/微头条）
  filterTab: '.byte-tabs-header-title',
  filterTabActive: '.byte-tabs-header-title.active',

  // 单条评论项
  commentItem: '.comment-item',
  commentItemHeader: '.comment-item-header',
  commentAuthorName: '.comment-item-title',
  // 被评论的文章标题（“评论了微头条 《标题》”）
  commentArticleTitle: '.comment-item-header-extra .extra-title',
  // 评论文本
  commentContent: '.comment-item-content-wrap',
  // 评论时间
  commentTimer: '.comment-item-timer',

  // 操作按钮容器（含 “回复”、“赞”、“置顶”）
  commentActions: '.comment-item-actions',
  // 单个动作（需按 innerText 精确匹配 “回复”）
  commentActionItem: '.comment-item-actions-item',

  // 点击“回复”后出现的面板
  replyBoxWrap: '.comment-item-reply-box-wrap',
  replyBoxShowed: '.comment-item-reply-box-wrap.comment-item-reply-box-showed',
  // 输入框（原生 textarea，placeholder="积极回复可吸引更多人评论"）
  replyTextarea: '.comment-item-reply-box-wrap .reply-box textarea.byte-textarea',
  // 发布按钮（未输入 disabled=true，输入后 disabled=false）
  replySubmitButton: '.comment-item-reply-box-wrap .reply-box-action-wrap button.byte-btn-primary',
  // 取消回复按钮（另一个状态下，带文本“取消回复”的 actions-item）
  cancelReplyAction: '.comment-item-actions-item',  // 需同样按 innerText 过滤
}

/**
 * 创作者中心多入口选择器（2026-05-04 真实 DOM 实测 mp.toutiao.com 已登录）
 *
 * 实测发现：
 *   - profile_v4/index 页主要内容是侧边栏 garr-menu，「创作」是分组 header（byte-menu-inline.base_creation_tab）
 *   - 「创作」分组需要展开后才能看到具体「发布微头条」「发布文章」等子项；当前页面初始可能折叠
 *   - 顶栏没有显眼的"创作中心"入口，dashboard 模式由展开侧栏达成
 *   - 标 isPlaceholder=true 提示后续展开侧栏后再做二次校准
 */
export const CREATOR_ENTRY_SELECTORS = {
  creatorHomeUrl: 'https://mp.toutiao.com/profile_v4/index',

  // 侧边栏「创作」分组 header（hover 或 click 后展开子项）
  sideMenuCreatorGroup: [
    'div.byte-menu-inline.base_creation_tab > div.byte-menu-inline-header',
    'div.byte-menu-inline.advance_creation_tab > div.byte-menu-inline-header'
  ],
  sideMenuCreatorGroupText: ['创作', '进阶创作'],

  // 「创作权益」「创作灵感」等次级链接（不直接是发布入口，但用于 nav 验证）
  sideMenuCreatorLinks: [
    'div.byte-menu-inline.guide_tab a',
    'div.byte-menu-inline.tools_tab a'
  ],

  // ⚠️ 头条具体发布入口需要先点开侧栏「创作」二级菜单才能命中
  isPlaceholder: true
}
