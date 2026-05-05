import { useState, useEffect } from 'react'
import { Send, Plus, RefreshCw, Filter, Image, Tag, X } from 'lucide-react'
import { api } from '../lib/api'

// 默认平台列表（API 加载前的 fallback）
const DEFAULT_PLATFORMS = [
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'weibo', label: '微博' },
  { value: 'douyin', label: '抖音' },
]

function NewPostModal({ open, onClose, onSubmit, platforms }) {
  const [form, setForm] = useState({
    platform: platforms?.[0]?.value || 'xiaohongshu',
    title: '',
    content: '',
    tags: '',
    images: '',
  })
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit({
        ...form,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [],
        images: form.images ? form.images.split(',').map(t => t.trim()) : [],
      })
      onClose()
      setForm({ platform: 'xiaohongshu', title: '', content: '', tags: '', images: '' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zeno-card border border-zeno-border rounded-2xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">新建发帖任务</h2>
          <button onClick={onClose} className="text-zeno-text hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zeno-text mb-1">平台</label>
            <select
              value={form.platform}
              onChange={e => setForm({ ...form, platform: e.target.value })}
              className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white focus:border-zeno-accent focus:outline-none"
            >
              {(platforms || DEFAULT_PLATFORMS).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-zeno-text mb-1">标题</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="输入帖子标题"
              className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white placeholder-zeno-text/50 focus:border-zeno-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-zeno-text mb-1">正文</label>
            <textarea
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder="输入帖子正文"
              rows={5}
              className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white placeholder-zeno-text/50 focus:border-zeno-accent focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-zeno-text mb-1">
              <Tag className="w-3 h-3 inline mr-1" />标签（逗号分隔）
            </label>
            <input
              type="text"
              value={form.tags}
              onChange={e => setForm({ ...form, tags: e.target.value })}
              placeholder="标签1, 标签2, ..."
              className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white placeholder-zeno-text/50 focus:border-zeno-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-zeno-text mb-1">
              <Image className="w-3 h-3 inline mr-1" />图片路径（逗号分隔）
            </label>
            <input
              type="text"
              value={form.images}
              onChange={e => setForm({ ...form, images: e.target.value })}
              placeholder="/path/to/img1.jpg, /path/to/img2.jpg"
              className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white placeholder-zeno-text/50 focus:border-zeno-accent focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zeno-text hover:text-white transition-colors">
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || !form.title}
              className="px-5 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-500 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              {submitting ? '提交中...' : '提交发帖'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Posts() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [platforms, setPlatforms] = useState(DEFAULT_PLATFORMS)

  useEffect(() => {
    api.get('/platforms').then(res => {
      if (res?.platforms?.length) {
        const list = res.platforms
          .filter(p => p.capabilities?.publish)
          .map(p => ({ value: p.name, label: p.label || p.name }))
        if (list.length) setPlatforms(list)
      }
    }).catch(() => {})
  }, [])

  const loadTasks = async () => {
    setLoading(true)
    try {
      const query = {}
      if (filterPlatform) query.platform = filterPlatform
      if (filterStatus) query.status = filterStatus
      const res = await api.get('/publish', query)
      setTasks(res?.tasks || [])
    } catch { /* API 未启动 */ }
    setLoading(false)
  }

  useEffect(() => { loadTasks() }, [filterPlatform, filterStatus])

  const handlePublish = async (data) => {
    await api.post('/publish', data)
    loadTasks()
  }

  const statusColors = {
    success: 'bg-emerald-500/20 text-emerald-400',
    failed: 'bg-red-500/20 text-red-400',
    running: 'bg-blue-500/20 text-blue-400 animate-pulse',
    queued: 'bg-yellow-500/20 text-yellow-400',
    scheduled: 'bg-purple-500/20 text-purple-400',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">发帖管理</h1>
          <p className="text-sm text-zeno-text mt-1">创建和管理发帖任务</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadTasks} className="p-2 text-zeno-text hover:text-white border border-zeno-border rounded-lg hover:bg-white/5 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建任务
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select
          value={filterPlatform}
          onChange={e => setFilterPlatform(e.target.value)}
          className="bg-zeno-card border border-zeno-border rounded-lg px-3 py-2 text-sm text-white focus:border-zeno-accent focus:outline-none"
        >
          <option value="">全部平台</option>
          {platforms.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-zeno-card border border-zeno-border rounded-lg px-3 py-2 text-sm text-white focus:border-zeno-accent focus:outline-none"
        >
          <option value="">全部状态</option>
          <option value="queued">排队中</option>
          <option value="running">运行中</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
          <option value="scheduled">已安排</option>
        </select>
      </div>

      {/* Tasks Table */}
      <div className="bg-zeno-card border border-zeno-border rounded-xl overflow-hidden">
        {tasks.length === 0 ? (
          <div className="text-center py-16">
            <Send className="w-12 h-12 text-zeno-border mx-auto mb-3" />
            <p className="text-sm text-zeno-text">暂无发帖任务</p>
            <button onClick={() => setShowNew(true)} className="mt-4 text-sm text-zeno-accent hover:underline">
              创建第一个任务
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-zeno-text border-b border-zeno-border bg-zeno-dark/50">
                <th className="text-left px-5 py-3 font-medium">任务 ID</th>
                <th className="text-left px-5 py-3 font-medium">平台</th>
                <th className="text-left px-5 py-3 font-medium">标题</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
                <th className="text-left px-5 py-3 font-medium">创建时间</th>
                <th className="text-left px-5 py-3 font-medium">完成时间</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={t.task_id || i} className="border-b border-zeno-border/50 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 text-xs text-zeno-text font-mono">{t.task_id}</td>
                  <td className="px-5 py-3 text-sm text-white">{t.platform}</td>
                  <td className="px-5 py-3 text-sm text-white truncate max-w-[200px]">{t.title || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${statusColors[t.status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-zeno-text">{t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '-'}</td>
                  <td className="px-5 py-3 text-xs text-zeno-text">{t.completed_at ? new Date(t.completed_at).toLocaleString('zh-CN') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <NewPostModal open={showNew} onClose={() => setShowNew(false)} onSubmit={handlePublish} platforms={platforms} />
    </div>
  )
}
