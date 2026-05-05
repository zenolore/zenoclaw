/**
 * 小红书养号/浏览执行器
 *
 * 继承 BrowseRunnerBase，提供小红书特定的 feed 选择器。
 * 行为：滚动首页 feed → 随机点击笔记 → 阅读详情 → 返回 → 循环
 */
import { BrowseRunnerBase } from '../browse-base.js'

export class XiaohongshuBrowseRunner extends BrowseRunnerBase {
  constructor(page) {
    super(page)
    this.platformName = 'xiaohongshu'
  }

  getBrowseSelectors() {
    return {
      homeUrl: 'https://www.xiaohongshu.com/explore',
      // feed 容器 & 单条笔记卡片
      feedContainer: '.feeds-container',
      feedItem: '.note-item, section.note-item, [data-type="note"]',
      // 搜索框
      searchInput: '#search-input, .search-input input',
      // 滚动目标（默认 window）
      scrollTarget: null,
    }
  }
}

// 默认导出，供 loader.js 按约定 import
export default XiaohongshuBrowseRunner
