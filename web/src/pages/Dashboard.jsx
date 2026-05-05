import { useState, useEffect } from 'react'
import { Send, Eye, Heart, MessageSquare, Bookmark, TrendingUp, Clock, AlertCircle, X, Sparkles, ArrowRight } from 'lucide-react'
import { api } from '../lib/api'

function StatCard({ icon: Icon, label, value, change, color }) {
  return (
    <div className="bg-zeno-card border border-zeno-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {change && (
          <span className={`text-xs font-medium ${change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {change > 0 ? '+' : ''}{change}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-zeno-text mt-1">{label}</p>
    </div>
  )
}

function RecentTaskRow({ task }) {
  const statusColors = {
    success: 'bg-emerald-500/20 text-emerald-400',
    failed: 'bg-red-500/20 text-red-400',
    running: 'bg-blue-500/20 text-blue-400',
    queued: 'bg-yellow-500/20 text-yellow-400',
    scheduled: 'bg-purple-500/20 text-purple-400',
  }
  return (
    <tr className="border-b border-zeno-border/50 hover:bg-white/[0.02]">
      <td className="py-3 pr-4">
        <p className="text-sm text-white truncate max-w-[200px]">{task.title || '(无标题)'}</p>
        <p className="text-xs text-zeno-text">{task.platform}</p>
      </td>
      <td className="py-3 pr-4">
        <span className={`text-xs px-2 py-1 rounded-full ${statusColors[task.status] || 'bg-gray-500/20 text-gray-400'}`}>
          {task.status}
        </span>
      </td>
      <td className="py-3 text-xs text-zeno-text">
        {task.created_at ? new Date(task.created_at).toLocaleString('zh-CN') : '-'}
      </td>
    </tr>
  )
}

function WorkflowTip({ onDismiss }) {
  return (
    <div className="relative bg-gradient-to-r from-brand-600/10 via-violet-600/10 to-brand-600/5 border border-brand-500/20 rounded-xl p-5 mb-6">
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-zeno-text/40 hover:text-zeno-text transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-5 h-5 text-brand-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white mb-1">AI 内容创作 + 自动发布工作流</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zeno-text mt-2">
            <span className="bg-white/5 px-2.5 py-1 rounded-md">AI 生成文案</span>
            <ArrowRight className="w-3 h-3 text-zeno-text/40" />
            <span className="bg-white/5 px-2.5 py-1 rounded-md">SVG 海报设计</span>
            <ArrowRight className="w-3 h-3 text-zeno-text/40" />
            <span className="bg-brand-600/20 text-brand-300 px-2.5 py-1 rounded-md">ZenoClaw 一键发布</span>
          </div>
          <p className="text-xs text-zeno-text/60 mt-2.5">
            配合
            <a href="https://zeno.babiku.xyz" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 mx-1">
              Zeno App
            </a>
            的 AI Agent 生成内容，在 SVG 工作台调整海报，然后自动发布到 19 个平台。
          </p>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [tasks, setTasks] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showTip, setShowTip] = useState(() => localStorage.getItem('zenoclaw_tip_dismissed') !== '1')

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, tasksRes, analyticsRes] = await Promise.allSettled([
          api.get('/stats'),
          api.get('/publish', { limit: 10 }),
          api.get('/analytics'),
        ])
        if (statsRes.status === 'fulfilled') setStats(statsRes.value)
        if (tasksRes.status === 'fulfilled') setTasks(tasksRes.value?.tasks || [])
        if (analyticsRes.status === 'fulfilled') setAnalytics(analyticsRes.value)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const summary = analytics?.summary || {}

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-zeno-text mt-1">ZenoClaw 运营数据概览</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zeno-text">
          <Clock className="w-4 h-4" />
          {new Date().toLocaleString('zh-CN')}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm text-red-300">API 连接失败</p>
            <p className="text-xs text-red-400/70 mt-1">请确认 API Server 已启动 (npm run api)。错误: {error}</p>
          </div>
        </div>
      )}

      {showTip && (
        <WorkflowTip onDismiss={() => { setShowTip(false); localStorage.setItem('zenoclaw_tip_dismissed', '1') }} />
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Send} label="总发帖数" value={summary.total_posts || 0} change={summary.posts_change} color="bg-brand-600" />
        <StatCard icon={Eye} label="总浏览量" value={summary.total_views?.toLocaleString() || 0} change={summary.views_change} color="bg-violet-600" />
        <StatCard icon={Heart} label="总点赞数" value={summary.total_likes?.toLocaleString() || 0} change={summary.likes_change} color="bg-rose-600" />
        <StatCard icon={MessageSquare} label="总评论数" value={summary.total_comments?.toLocaleString() || 0} change={summary.comments_change} color="bg-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Tasks */}
        <div className="lg:col-span-2 bg-zeno-card border border-zeno-border rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">最近任务</h2>
          {tasks.length === 0 ? (
            <div className="text-center py-12">
              <Send className="w-12 h-12 text-zeno-border mx-auto mb-3" />
              <p className="text-sm text-zeno-text">暂无任务</p>
              <p className="text-xs text-zeno-text/60 mt-1">通过 API 或「发帖管理」页面创建第一个任务</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-xs text-zeno-text border-b border-zeno-border">
                  <th className="text-left pb-2 font-medium">帖子</th>
                  <th className="text-left pb-2 font-medium">状态</th>
                  <th className="text-left pb-2 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => <RecentTaskRow key={t.task_id || i} task={t} />)}
              </tbody>
            </table>
          )}
        </div>

        {/* Quick Stats */}
        <div className="bg-zeno-card border border-zeno-border rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">运营概要</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-zeno-text">互动率</span>
              <span className="text-sm font-medium text-white">{summary.avg_engagement_rate || '0%'}</span>
            </div>
            <div className="w-full bg-zeno-border/50 rounded-full h-2">
              <div className="bg-zeno-accent rounded-full h-2" style={{ width: `${Math.min(parseFloat(summary.avg_engagement_rate) || 0, 100)}%` }} />
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm text-zeno-text">总收藏</span>
              <span className="text-sm font-medium text-white">{summary.total_collects?.toLocaleString() || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-zeno-text">总分享</span>
              <span className="text-sm font-medium text-white">{summary.total_shares?.toLocaleString() || 0}</span>
            </div>

            {analytics?.insights?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zeno-border">
                <p className="text-xs text-zeno-text mb-2">AI 洞察</p>
                {analytics.insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-2 mb-2">
                    <TrendingUp className="w-3 h-3 text-zeno-accent mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-300">{insight}</p>
                  </div>
                ))}
              </div>
            )}

            {analytics?.recommended_times?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zeno-border">
                <p className="text-xs text-zeno-text mb-2">推荐发帖时间</p>
                <div className="flex flex-wrap gap-2">
                  {analytics.recommended_times.map((t, i) => (
                    <span key={i} className="text-xs bg-brand-600/20 text-brand-300 px-2 py-1 rounded">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
