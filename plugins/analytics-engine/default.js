/**
 * 默认数据分析引擎 — 基础统计分析
 */
import fs from 'fs'
import path from 'path'
import { AnalyticsEngine } from './interface.js'

export class DefaultAnalyticsEngine extends AnalyticsEngine {
  constructor(dataDir) {
    super()
    this.dataDir = dataDir || './data/stats'
  }

  _loadStats(platform) {
    const dir = path.resolve(this.dataDir)
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    const allStats = []
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
        const items = Array.isArray(data) ? data : [data]
        allStats.push(...items)
      } catch { /* skip bad files */ }
    }
    if (platform) return allStats.filter(s => s.platform === platform)
    return allStats
  }

  /**
   * 按 post_id 去重，保留每个帖子的最新快照
   * 无 post_id 的记录视为独立帖子
   */
  _deduplicateByPostId(stats) {
    const byId = new Map()
    for (const s of stats) {
      const key = s.post_id || s.id
      if (!key) {
        // 无 ID 的记录作为独立条目
        byId.set(`_anon_${byId.size}`, s)
        continue
      }
      const existing = byId.get(key)
      if (!existing) {
        byId.set(key, s)
      } else {
        // 保留时间戳更新的快照
        const existTime = new Date(existing.timestamp || existing.published_at || 0).getTime()
        const newTime = new Date(s.timestamp || s.published_at || 0).getTime()
        if (newTime > existTime) byId.set(key, s)
      }
    }
    return [...byId.values()]
  }

  async analyzePerformance(stats) {
    if (!stats || stats.length === 0) {
      return { summary: { total_posts: 0 }, trends: {}, insights: [] }
    }

    // 按 post_id 去重，避免同一帖子多次快照被重复计算
    const uniquePosts = this._deduplicateByPostId(stats)

    const totalViews = uniquePosts.reduce((s, p) => s + (p.views || 0), 0)
    const totalLikes = uniquePosts.reduce((s, p) => s + (p.likes || 0), 0)
    const totalComments = uniquePosts.reduce((s, p) => s + (p.comments || 0), 0)
    const totalCollects = uniquePosts.reduce((s, p) => s + (p.collects || 0), 0)
    const totalShares = uniquePosts.reduce((s, p) => s + (p.shares || 0), 0)

    const avgEngagement = totalViews > 0
      ? ((totalLikes + totalComments + totalCollects) / totalViews * 100).toFixed(2)
      : '0.00'

    const bestPost = uniquePosts.reduce((best, p) =>
      (p.views || 0) > (best.views || 0) ? p : best, uniquePosts[0])

    // 计算周环比变化（近 7 天 vs 前 7 天，基于去重后数据）
    const changes = this._calcChanges(uniquePosts)

    return {
      summary: {
        total_posts: uniquePosts.length,
        total_snapshots: stats.length,
        total_views: totalViews,
        total_likes: totalLikes,
        total_comments: totalComments,
        total_collects: totalCollects,
        total_shares: totalShares,
        avg_engagement_rate: `${avgEngagement}%`,
        best_post: bestPost ? { id: bestPost.post_id, title: bestPost.title, views: bestPost.views } : null,
        posts_change: changes.posts,
        views_change: changes.views,
        likes_change: changes.likes,
        comments_change: changes.comments,
      },
      trends: {
        views: stats.map(s => s.views || 0),
        likes: stats.map(s => s.likes || 0),
        comments: stats.map(s => s.comments || 0),
      },
      insights: this._generateInsights(stats, avgEngagement),
    }
  }

  _calcChanges(stats) {
    const now = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const recent = stats.filter(s => {
      const t = new Date(s.timestamp || s.published_at || 0).getTime()
      return now - t < weekMs
    })
    const older = stats.filter(s => {
      const t = new Date(s.timestamp || s.published_at || 0).getTime()
      return now - t >= weekMs && now - t < weekMs * 2
    })

    const pct = (curr, prev) => {
      if (prev === 0) return curr > 0 ? 100 : undefined
      return Math.round(((curr - prev) / prev) * 100)
    }

    const sumField = (arr, field) => arr.reduce((s, p) => s + (p[field] || 0), 0)

    if (older.length === 0) {
      return { posts: undefined, views: undefined, likes: undefined, comments: undefined }
    }

    return {
      posts: pct(recent.length, older.length),
      views: pct(sumField(recent, 'views'), sumField(older, 'views')),
      likes: pct(sumField(recent, 'likes'), sumField(older, 'likes')),
      comments: pct(sumField(recent, 'comments'), sumField(older, 'comments')),
    }
  }

  _generateInsights(stats, avgEngagement) {
    const insights = []
    if (parseFloat(avgEngagement) > 5) {
      insights.push('互动率高于 5%，内容质量优秀')
    } else if (parseFloat(avgEngagement) < 1) {
      insights.push('互动率低于 1%，建议优化内容策略')
    }
    if (stats.length >= 7) {
      const recent = stats.slice(-7)
      const older = stats.slice(-14, -7)
      if (older.length > 0) {
        const recentAvgViews = recent.reduce((s, p) => s + (p.views || 0), 0) / recent.length
        const olderAvgViews = older.reduce((s, p) => s + (p.views || 0), 0) / older.length
        if (recentAvgViews > olderAvgViews * 1.2) {
          insights.push('近 7 天浏览量呈上升趋势')
        } else if (recentAvgViews < olderAvgViews * 0.8) {
          insights.push('近 7 天浏览量呈下降趋势，建议调整内容方向')
        }
      }
    }
    return insights
  }

  async suggestBestTime(historicalData) {
    if (!historicalData || historicalData.length === 0) {
      return ['08:00-09:00', '12:00-13:00', '20:00-21:00']
    }
    const hourBuckets = {}
    for (const item of historicalData) {
      if (!item.published_at) continue
      const hour = new Date(item.published_at).getHours()
      if (!hourBuckets[hour]) hourBuckets[hour] = { count: 0, totalViews: 0 }
      hourBuckets[hour].count++
      hourBuckets[hour].totalViews += item.views || 0
    }
    const sorted = Object.entries(hourBuckets)
      .map(([h, d]) => ({ hour: parseInt(h), avgViews: d.totalViews / d.count }))
      .sort((a, b) => b.avgViews - a.avgViews)
    return sorted.slice(0, 3).map(s => `${String(s.hour).padStart(2, '0')}:00-${String(s.hour + 1).padStart(2, '0')}:00`)
  }

  async generateReport(params) {
    const stats = this._loadStats(params.platform)
    const analysis = await this.analyzePerformance(stats)
    const bestTimes = await this.suggestBestTime(stats)
    return {
      period: params.period || 'all',
      platform: params.platform || 'all',
      generated_at: new Date().toISOString(),
      ...analysis,
      recommended_times: bestTimes,
    }
  }

  async getTrends(params) {
    const stats = this._loadStats(params.platform)
    const metric = params.metric || 'views'
    return {
      labels: stats.map(s => s.timestamp || s.published_at || 'unknown'),
      values: stats.map(s => s[metric] || 0),
    }
  }
}
