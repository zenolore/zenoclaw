/**
 * GET  /api/analytics              — 获取综合分析报告
 * GET  /api/analytics/trends       — 获取趋势数据
 * GET  /api/analytics/best-time    — 获取最佳发帖时间
 */
import { Router } from 'express'
import { getAnalyticsEngine } from '../../plugins/manager.js'

export const analyticsRouter = Router()

// GET /api/analytics — 综合分析报告
analyticsRouter.get('/', async (req, res) => {
  try {
    const { platform, period } = req.query
    const engine = getAnalyticsEngine()
    const report = await engine.generateReport({ platform, period: period || '7d' })
    res.json(report)
  } catch (err) {
    res.status(500).json({ error: 'AnalyticsError', message: err.message })
  }
})

// GET /api/analytics/trends — 趋势数据
analyticsRouter.get('/trends', async (req, res) => {
  try {
    const { platform, metric, period } = req.query
    const engine = getAnalyticsEngine()
    const trends = await engine.getTrends({
      platform,
      metric: metric || 'views',
      period: period || '7d',
    })
    res.json(trends)
  } catch (err) {
    res.status(500).json({ error: 'TrendsError', message: err.message })
  }
})

// GET /api/analytics/best-time — 最佳发帖时间
analyticsRouter.get('/best-time', async (req, res) => {
  try {
    const engine = getAnalyticsEngine()
    const times = await engine.suggestBestTime([])
    res.json({ recommended_times: times })
  } catch (err) {
    res.status(500).json({ error: 'BestTimeError', message: err.message })
  }
})
