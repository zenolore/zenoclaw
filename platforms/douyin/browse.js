/**
 * 抖音养号/浏览执行器（骨架）
 *
 * 继承 BrowseRunnerBase，提供抖音 web 端首页 feed 选择器。
 * 行为：滚动首页推荐 → 随机点击视频 → 观看详情 → 返回 → 循环
 *
 * ⚠️ 选择器为起点，需在真实抖音页面实测后调整：
 *   - 抖音 web 端使用 data-e2e 自定义属性，比 class 更稳定
 *   - feed 滚动可能是虚拟列表，需要专门处理
 *   - 改版后需更新
 */
import { BrowseRunnerBase } from '../browse-base.js'

export class DouyinBrowseRunner extends BrowseRunnerBase {
  constructor(page) {
    super(page)
    this.platformName = 'douyin'
    this.isPlaceholderSelectors = true
  }

  getBrowseSelectors() {
    return {
      homeUrl: 'https://www.douyin.com/',
      // feed 容器（推荐/关注/同城等 tab 内容区，待实测）
      feedContainer: '[data-e2e="feed-active-video"], main, [class*="feed"]',
      // 单条视频卡片（待实测）
      feedItem: '[data-e2e="feed-active-video"], [data-e2e*="video-card"], li[class*="video"]',
      // 搜索框（待实测）
      searchInput: '[data-e2e*="search"] input, input[data-e2e="searchbar-input"], input[placeholder*="搜索"]',
      // 滚动目标
      scrollTarget: null,
    }
  }
}

export default DouyinBrowseRunner
