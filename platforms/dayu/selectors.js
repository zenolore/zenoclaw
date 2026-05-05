/**
 * 大鱼号(UC) CSS 选择器集中管理（2026-04-09 实测验证）
 *
 * 大鱼号使用 UEditor iframe 富文本编辑器 + Ant Design 组件
 * 文章发布页: https://mp.dayu.com/dashboard/article/write
 */

export const PUBLISH_SELECTORS = {
  // 标题输入（input.article-write_box-title-input）
  titleInput: 'input.article-write_box-title-input',
  titleInputAlt: 'input[placeholder*="标题"]',
  titleInputAlt2: 'input[placeholder*="输入文章标题"]',

  // 正文输入（iframe 内 body contenteditable, class="view simple-ui"）
  contentIframeBody: 'body[contenteditable="true"]',
  contentIframeBodyAlt: 'body.view',

  // 封面选项（ant-radio-input）
  coverRadioSingle: '.ant-radio-input',
  coverSingleText: '单封面',
  coverTripleText: '三封面',

  // 封面上传
  coverFileInput: 'input[type="file"][accept*="image"]',
  coverFileInputAlt: 'input[type="file"]',

  // 保存按钮
  saveButtonText: '保存',

  // 预览按钮
  previewButtonText: '预览',

  // 发布按钮（大鱼号可能需先保存再从管理页发布）
  publishButtonText: '发布',

  // 分类选择
  categorySelect: '.ant-select',

  // 登录检测
  loginPageIndicator: '/login',
}

export const BROWSE_SELECTORS = {
  homeUrl: 'https://mp.dayu.com/dashboard',
  scrollTarget: 'body',
}

export const INTERACT_SELECTORS = {
  like: [],
  comment_input: [],
  comment_submit: [],
  follow: [],
}
