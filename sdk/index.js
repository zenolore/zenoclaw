/**
 * ZenoClaw SDK — Node.js 客户端
 *
 * 使用方式:
 *   import { ZenoClaw } from 'zenoclaw/sdk'
 *   const client = new ZenoClaw({ apiUrl: 'http://localhost:3200', apiKey: 'xxx' })
 *   await client.publish({ platform: 'xiaohongshu', title: '...', content: '...' })
 */
import { ZenoClawClient } from './client.js'

export class ZenoClaw {
  constructor(options = {}) {
    this.client = new ZenoClawClient({
      baseUrl: options.apiUrl || options.baseUrl || 'http://localhost:3200',
      apiKey: options.apiKey || '',
      timeout: options.timeout || 30000,
    })
  }

  // ========== 发帖 ==========

  async publish(params) {
    return this.client.post('/api/publish', params)
  }

  async getPublishTasks(query = {}) {
    return this.client.get('/api/publish', query)
  }

  async getPublishTask(taskId) {
    return this.client.get(`/api/publish/${taskId}`)
  }

  // ========== 数据追踪 ==========

  async getStats(postId) {
    return this.client.get(`/api/stats/${postId}`)
  }

  async getAllStats(query = {}) {
    return this.client.get('/api/stats', query)
  }

  async collectStats(params) {
    return this.client.post('/api/stats/collect', params)
  }

  // ========== 数据分析 ==========

  async getAnalytics(query = {}) {
    return this.client.get('/api/analytics', query)
  }

  async getTrends(query = {}) {
    return this.client.get('/api/analytics/trends', query)
  }

  async getBestTime() {
    return this.client.get('/api/analytics/best-time')
  }

  // ========== 互动 ==========

  async interact(params) {
    return this.client.post('/api/interact', params)
  }

  async getInteractHistory(query = {}) {
    return this.client.get('/api/interact/history', query)
  }

  // ========== 浏览/养号 ==========

  async browse(params) {
    return this.client.post('/api/browse', params)
  }

  async getBrowseHistory(query = {}) {
    return this.client.get('/api/browse/history', query)
  }

  async getActiveBrowseTasks() {
    return this.client.get('/api/browse/active')
  }

  // ========== 账号 ==========

  async login(params) {
    return this.client.post('/api/account/login', params)
  }

  async getAccounts() {
    return this.client.get('/api/account')
  }

  async addAccount(params) {
    return this.client.post('/api/account', params)
  }

  async deleteAccount(id) {
    return this.client.delete(`/api/account/${id}`)
  }

  // ========== 定时任务 ==========

  async getSchedules() {
    return this.client.get('/api/schedule')
  }

  async createSchedule(params) {
    return this.client.post('/api/schedule', params)
  }

  async updateSchedule(id, params) {
    return this.client.patch(`/api/schedule/${id}`, params)
  }

  async deleteSchedule(id) {
    return this.client.delete(`/api/schedule/${id}`)
  }

  // ========== 平台 ==========

  async getPlatforms() {
    return this.client.get('/api/platforms')
  }

  async getPlatformsHealth() {
    return this.client.get('/api/platforms/health')
  }

  // ========== 系统 ==========

  async health() {
    return this.client.get('/api/health')
  }

  async getConfig() {
    return this.client.get('/api/config')
  }
}

export { ZenoClawClient } from './client.js'
