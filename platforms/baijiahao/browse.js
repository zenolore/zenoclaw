/**
 * 百家号养号/浏览执行器（骨架）
 *
 * 继承 BrowseRunnerBase。
 *
 * 注意：百家号本身没有 web 端阅读 feed（百家号是创作者后台），
 * 真实养号常见做法是在百度系的内容页面建立"自然浏览"行为：
 *   - 百度首页 / 新闻 (https://news.baidu.com)
 *   - 好看视频 (https://haokan.baidu.com)
 * 这里以"百度新闻"为代偿浏览源，让账号产生自然行为链。
 *
 * ⚠️ 选择器为起点，需在真实页面实测后调整。
 */
import { BrowseRunnerBase } from '../browse-base.js'

export class BaijiahaoBrowseRunner extends BrowseRunnerBase {
  constructor(page) {
    super(page)
    this.platformName = 'baijiahao'
    this.isPlaceholderSelectors = true
  }

  getBrowseSelectors() {
    return {
      homeUrl: 'https://news.baidu.com/',
      feedContainer: '#content_left, .hotnews, .focuslistnews',
      feedItem: '.hotnews li, .focuslistnews li, .ulist li, a[href*="baijiahao.baidu.com"]',
      searchInput: '#word, input[name="word"]',
      scrollTarget: null,
    }
  }
}

export default BaijiahaoBrowseRunner
