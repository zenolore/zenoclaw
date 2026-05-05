/**
 * 头条养号/浏览执行器
 *
 * 选择器来源：2026-05-02 在用户已登录的 Chrome 9222 里真实探测 www.toutiao.com。
 *
 * 实测记录：
 *   - feed-card-wrapper.feed-card-article-wrapper  → 99 个卡片命中
 *   - a[href*="/article/"]                          → 43 个文章链接命中
 *   - .feed-m-nav                                  → 顶部分类 nav（关注/推荐/视频/财经...）
 *   - .feed-five-wrapper > .five-item              → 顶部精选条目
 *
 * 头条不使用 main / article 标签。不要使用这些选择器。
 */
import { BrowseRunnerBase } from '../browse-base.js'

export class ToutiaoBrowseRunner extends BrowseRunnerBase {
  constructor(page) {
    super(page)
    this.platformName = 'toutiao'
    // 已在真实头条首页实测过，不再是占位
    this.isPlaceholderSelectors = false
  }

  getBrowseSelectors() {
    return {
      homeUrl: 'https://www.toutiao.com/',
      // feed 列表容器：头条未提供明确外层容器选择器，用顶部导航作为错错位置参考
      feedContainer: '.feed-m-nav, .feed-five-wrapper',
      // 文章卡片：实测主要是 .feed-card-wrapper，补充三个 fallback
      feedItem: '.feed-card-wrapper, .feed-card-article-wrapper, .five-item, a[href*="/article/"]',
      // 头条首页顶部不提供可输入的搜索框（需要先点击搜索图标展开），留空表示不可用
      searchInput: null,
      // 顶部分类入口（关注/推荐/视频/财经...）
      categoryNav: '.feed-m-nav',
      // 滚动目标为 window
      scrollTarget: null,
    }
  }
}

export default ToutiaoBrowseRunner
