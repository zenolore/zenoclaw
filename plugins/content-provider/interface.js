/**
 * 内容生成接口（Content Provider）
 *
 * 用户可实现此接口对接自己的内容系统：
 * - Zeno 主软件已有内容生成 → 直接对接
 * - 使用 OpenAI/Claude → 用 openai.js 实现
 * - 从数据库读取 → 自定义实现
 * - 从 JSON 文件读取 → 使用默认实现 (default.js)
 */
export class ContentProvider {
  /**
   * 生成帖子标题
   * @param {Object} context - { platform, topic, keywords, style }
   * @returns {Promise<string>}
   */
  async generateTitle(context) {
    throw new Error('ContentProvider.generateTitle() not implemented')
  }

  /**
   * 生成帖子正文
   * @param {Object} context - { platform, topic, title, keywords, maxLength }
   * @returns {Promise<string>}
   */
  async generateContent(context) {
    throw new Error('ContentProvider.generateContent() not implemented')
  }

  /**
   * 推荐标签
   * @param {Object} context - { platform, title, content }
   * @returns {Promise<string[]>}
   */
  async suggestTags(context) {
    throw new Error('ContentProvider.suggestTags() not implemented')
  }

  /**
   * 生成评论/回复
   * @param {Object} context - { platform, originalComment, postContent, tone }
   * @returns {Promise<string>}
   */
  async generateReply(context) {
    throw new Error('ContentProvider.generateReply() not implemented')
  }

  /**
   * 获取下一条待发布内容
   * @param {Object} filter - { platform, status }
   * @returns {Promise<Object|null>} { id, title, content, images, tags } or null
   */
  async getNextPost(filter) {
    throw new Error('ContentProvider.getNextPost() not implemented')
  }

  /**
   * 获取所有帖子列表
   * @param {Object} filter - { platform, status, limit, offset }
   * @returns {Promise<Object[]>}
   */
  async listPosts(filter) {
    throw new Error('ContentProvider.listPosts() not implemented')
  }

  /**
   * 更新帖子状态
   * @param {string} postId
   * @param {Object} update - { status, published_at, error, stats }
   * @returns {Promise<void>}
   */
  async updatePost(postId, update) {
    throw new Error('ContentProvider.updatePost() not implemented')
  }
}
