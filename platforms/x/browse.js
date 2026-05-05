/**
 * X (Twitter) 养号/浏览执行器
 *
 * 继承 BrowseRunnerBase，提供 X 特定的 feed 选择器。
 * 行为：滚动 For You/Following feed → 随机点击推文 → 阅读详情 → 返回 → 循环
 */
import { BrowseRunnerBase } from '../browse-base.js'

export class XBrowseRunner extends BrowseRunnerBase {
  constructor(page) {
    super(page)
    this.platformName = 'x'
  }

  getBrowseSelectors() {
    return {
      homeUrl: 'https://x.com/home',
      // feed 容器 & 单条推文
      feedContainer: '[data-testid="primaryColumn"]',
      feedItem: 'article[data-testid="tweet"]',
      // 搜索框
      searchInput: '[data-testid="SearchBox_Search_Input"]',
      // 滚动目标（默认 window）
      scrollTarget: null,
    }
  }
}

export default XBrowseRunner
