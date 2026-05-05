/**
 * 默认内容提供者 — 从 JSON 文件读取帖子
 */
import fs from 'fs'
import path from 'path'
import { ContentProvider } from './interface.js'
import { safeReadJson, safeWriteJson } from '../../core/safe-json.js'

export class DefaultContentProvider extends ContentProvider {
  constructor(contentFile) {
    super()
    this.contentFile = contentFile || './data/posts.json'
  }

  _loadPosts() {
    const filePath = path.resolve(this.contentFile)
    return safeReadJson(filePath, [])
  }

  async _savePosts(posts) {
    const filePath = path.resolve(this.contentFile)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    await safeWriteJson(filePath, posts)
  }

  async generateTitle(context) {
    return `[默认标题] ${context.topic || '未指定主题'}`
  }

  async generateContent(context) {
    return `[默认正文] 关于 ${context.topic || '未指定主题'} 的内容`
  }

  async suggestTags(context) {
    return ['自动发布', context.platform || '未知平台']
  }

  async generateReply(context) {
    return '谢谢你的评论！'
  }

  async getNextPost(filter = {}) {
    const posts = this._loadPosts()
    return posts.find(p =>
      p.status === 'pending' &&
      (!filter.platform || p.platform === filter.platform)
    ) || null
  }

  async listPosts(filter = {}) {
    let posts = this._loadPosts()
    if (filter.platform) posts = posts.filter(p => p.platform === filter.platform)
    if (filter.status) posts = posts.filter(p => p.status === filter.status)
    const offset = filter.offset || 0
    const limit = filter.limit || 100
    return posts.slice(offset, offset + limit)
  }

  async updatePost(postId, update) {
    const posts = this._loadPosts()
    const idx = posts.findIndex(p => p.id === postId)
    if (idx === -1) throw new Error(`Post not found: ${postId}`)
    posts[idx] = { ...posts[idx], ...update }
    await this._savePosts(posts)
  }
}
