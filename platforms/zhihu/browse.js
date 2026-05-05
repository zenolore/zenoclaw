/**
 * 知乎养号/浏览执行器
 *
 * 继承 BrowseRunnerBase，提供知乎特定的 feed 选择器。
 * 行为：滚动首页推荐 feed → 随机点击问答/文章 → 阅读详情 → 返回 → 循环
 *
 * 注意：知乎首页使用 React，feed 渲染较慢，需要等待 6-8 秒
 */
import { BrowseRunnerBase } from '../browse-base.js'

export class ZhihuBrowseRunner extends BrowseRunnerBase {
  constructor(page) {
    super(page)
    this.platformName = 'zhihu'
  }

  getBrowseSelectors() {
    return {
      homeUrl: 'https://www.zhihu.com/',
      // feed 容器 & 单条内容卡片
      feedContainer: '.Topstory-recommend',
      feedItem: '.Feed .ContentItem, .TopstoryItem',
      // 搜索框
      searchInput: '#Popover1-toggle, input[aria-label="搜索"]',
      // 滚动目标（默认 window）
      scrollTarget: null,
    }
  }
}

export default ZhihuBrowseRunner
