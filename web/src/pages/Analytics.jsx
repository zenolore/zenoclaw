import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Clock, RefreshCw, Download } from 'lucide-react'
import { api } from '../lib/api'

const PLATFORMS = [
  { value: '', label: '全部平台' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'weibo', label: '微博' },
  { value: 'bilibili', label: 'B站' },
  { value: 'zhihu', label: '知乎' },
  { value: 'jike', label: '即刻' },
  { value: 'sspai', label: '少数派' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'douyin', label: '抖音' },
]

const PERIODS = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
  { value: 'all', label: '全部' },
]

const METRICS = [
  { value: 'views', label: '浏览量', color: 'bg-blue-500' },
  { value: 'likes', label: '点赞', color: 'bg-rose-500' },
  { value: 'comments', label: '评论', color: 'bg-amber-500' },
  { value: 'collects', label: '收藏', color: 'bg-violet-500' },
  { value: 'shares', label: '分享', color: 'bg-emerald-500' },
]

function SimpleBarChart({ data, maxValue }) {
  if (!data || data.length === 0) return null
  const max = maxValue || Math.max(...data, 1)
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
          <div
            className="w-full bg-brand-500/60 rounded-t hover:bg-brand-400/80 transition-colors min-h-[2px]"
            style={{ height: `${Math.max((v / max) * 100, 2)}%` }}
            title={`${v}`}
          />
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const [platform, setPlatform] = useState('')
  const [period, setPeriod] = useState('7d')
  const [report, setReport] = useState(null)
  const [trends, setTrends] = useState(null)
  const [bestTimes, setBestTimes] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeMetric, setActiveMetric] = useState('views')

  const load = async () => {
    setLoading(true)
    try {
      const [reportRes, trendsRes, timesRes] = await Promise.allSettled([
        api.get('/analytics', { platform, period }),
        api.get('/analytics/trends', { platform, metric: activeMetric, period }),
        api.get('/analytics/best-time'),
      ])
      if (reportRes.status === 'fulfilled') setReport(reportRes.value)
      if (trendsRes.status === 'fulfilled') setTrends(trendsRes.value)
      if (timesRes.status === 'fulfilled') setBestTimes(timesRes.value?.recommended_times || [])
    } catch { /* API offline */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [platform, period, activeMetric])

  const summary = report?.summary || {}
  const insights = report?.insights || []

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">数据分析</h1>
          <p className="text-sm text-zeno-text mt-1">帖子表现分析与运营洞察</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="p-2 text-zeno-text hover:text-white border border-zeno-border rounded-lg hover:bg-white/5">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select value={platform} onChange={e => setPlatform(e.target.value)}
          className="bg-zeno-card border border-zeno-border rounded-lg px-3 py-2 text-sm text-white focus:border-zeno-accent focus:outline-none">
          {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <div className="flex border border-zeno-border rounded-lg overflow-hidden">
          {PERIODS.map(p => (
            <button key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-2 text-xs transition-colors ${period === p.value ? 'bg-brand-600 text-white' : 'text-zeno-text hover:bg-white/5'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {METRICS.map(m => (
          <button key={m.value}
            onClick={() => setActiveMetric(m.value)}
            className={`bg-zeno-card border rounded-xl p-4 text-left transition-colors ${
              activeMetric === m.value ? 'border-brand-500' : 'border-zeno-border hover:border-white/20'
            }`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${m.color}`} />
              <span className="text-xs text-zeno-text">{m.label}</span>
            </div>
            <p className="text-lg font-bold text-white">
              {(summary[`total_${m.value}`] || 0).toLocaleString()}
            </p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Chart */}
        <div className="lg:col-span-2 bg-zeno-card border border-zeno-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">
              {METRICS.find(m => m.value === activeMetric)?.label || ''}趋势
            </h2>
            <span className="text-xs text-zeno-text">{trends?.values?.length || 0} 个数据点</span>
          </div>
          {trends?.values?.length > 0 ? (
            <SimpleBarChart data={trends.values} />
          ) : (
            <div className="flex items-center justify-center h-32 text-sm text-zeno-text">
              暂无趋势数据
            </div>
          )}
        </div>

        {/* Insights & Best Times */}
        <div className="space-y-4">
          {/* Best Time */}
          <div className="bg-zeno-card border border-zeno-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-zeno-accent" />
              <h2 className="text-sm font-semibold text-white">最佳发帖时间</h2>
            </div>
            <div className="space-y-2">
              {bestTimes.length > 0 ? bestTimes.map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs w-5 h-5 rounded-full bg-brand-600/20 text-brand-300 flex items-center justify-center">{i + 1}</span>
                  <span className="text-sm text-white">{t}</span>
                </div>
              )) : (
                <p className="text-xs text-zeno-text">数据不足，无法推荐</p>
              )}
            </div>
          </div>

          {/* Insights */}
          <div className="bg-zeno-card border border-zeno-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-zeno-accent" />
              <h2 className="text-sm font-semibold text-white">运营洞察</h2>
            </div>
            {insights.length > 0 ? (
              <div className="space-y-2">
                {insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-zeno-accent mt-1.5 shrink-0" />
                    <p className="text-sm text-gray-300">{insight}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zeno-text">需要更多数据以生成洞察</p>
            )}
          </div>

          {/* Engagement Rate */}
          <div className="bg-zeno-card border border-zeno-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">互动率</h2>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-white">{summary.avg_engagement_rate || '0%'}</span>
            </div>
            <div className="w-full bg-zeno-border/50 rounded-full h-2 mt-3">
              <div className="bg-gradient-to-r from-brand-500 to-zeno-accent rounded-full h-2 transition-all"
                style={{ width: `${Math.min(parseFloat(summary.avg_engagement_rate) || 0, 100)}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
