import { useState, useEffect } from 'react'
import { CalendarClock, Plus, Trash2, PlayCircle, PauseCircle, RefreshCw, X } from 'lucide-react'
import { api } from '../lib/api'

const DEFAULT_PLATFORMS = [
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'weibo', label: '微博' },
  { value: 'douyin', label: '抖音' },
]

const TASK_TYPES = [
  { value: 'publish', label: '自动发帖' },
  { value: 'collect_stats', label: '数据采集' },
  { value: 'browse', label: '浏览养号' },
  { value: 'interact', label: '自动互动' },
]

const CRON_PRESETS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每 2 小时', value: '0 */2 * * *' },
  { label: '每天 8:00', value: '0 8 * * *' },
  { label: '每天 12:00', value: '0 12 * * *' },
  { label: '每天 20:00', value: '0 20 * * *' },
  { label: '每天 8:00/12:00/20:00', value: '0 8,12,20 * * *' },
  { label: '工作日 9:00', value: '0 9 * * 1-5' },
  { label: '每周一 10:00', value: '0 10 * * 1' },
]

function NewScheduleModal({ open, onClose, onSubmit, platforms }) {
  const [form, setForm] = useState({
    name: '',
    platform: 'xiaohongshu',
    type: 'publish',
    cron_expression: '0 8 * * *',
  })
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit(form)
      onClose()
      setForm({ name: '', platform: 'xiaohongshu', type: 'publish', cron_expression: '0 8 * * *' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zeno-card border border-zeno-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">新建定时任务</h2>
          <button onClick={onClose} className="text-zeno-text hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zeno-text mb-1">任务名称</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="例如：每日小红书发帖"
              className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white placeholder-zeno-text/50 focus:border-zeno-accent focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-zeno-text mb-1">平台</label>
              <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}
                className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white focus:border-zeno-accent focus:outline-none">
                {(platforms || DEFAULT_PLATFORMS).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zeno-text mb-1">类型</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white focus:border-zeno-accent focus:outline-none">
                {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm text-zeno-text mb-1">Cron 表达式</label>
            <input
              type="text"
              value={form.cron_expression}
              onChange={e => setForm({ ...form, cron_expression: e.target.value })}
              className="w-full bg-zeno-dark border border-zeno-border rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-zeno-accent focus:outline-none"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setForm({ ...form, cron_expression: p.value })}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    form.cron_expression === p.value
                      ? 'bg-brand-600/20 border-brand-500 text-brand-300'
                      : 'border-zeno-border text-zeno-text hover:text-white hover:border-white/20'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zeno-text hover:text-white">取消</button>
            <button type="submit" disabled={submitting}
              className="px-5 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-500 disabled:opacity-50 flex items-center gap-2">
              <CalendarClock className="w-4 h-4" />
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Schedule() {
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [platforms, setPlatforms] = useState(DEFAULT_PLATFORMS)

  useEffect(() => {
    api.get('/platforms').then(res => {
      if (res?.platforms?.length) {
        const list = res.platforms.map(p => ({ value: p.name, label: p.label || p.name }))
        if (list.length) setPlatforms(list)
      }
    }).catch(() => {})
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/schedule')
      setSchedules(res?.schedules || [])
    } catch { /* API offline */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (data) => {
    await api.post('/schedule', data)
    load()
  }

  const handleToggle = async (id, enabled) => {
    await api.patch(`/schedule/${id}`, { enabled: !enabled })
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除此定时任务？')) return
    await api.del(`/schedule/${id}`)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">定时任务</h1>
          <p className="text-sm text-zeno-text mt-1">管理自动化定时任务</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="p-2 text-zeno-text hover:text-white border border-zeno-border rounded-lg hover:bg-white/5">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-500">
            <Plus className="w-4 h-4" />
            新建定时任务
          </button>
        </div>
      </div>

      {schedules.length === 0 ? (
        <div className="bg-zeno-card border border-zeno-border rounded-xl text-center py-16">
          <CalendarClock className="w-12 h-12 text-zeno-border mx-auto mb-3" />
          <p className="text-sm text-zeno-text">暂无定时任务</p>
          <button onClick={() => setShowNew(true)} className="mt-4 text-sm text-zeno-accent hover:underline">
            创建第一个定时任务
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {schedules.map(s => (
            <div key={s.id} className="bg-zeno-card border border-zeno-border rounded-xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.enabled ? 'bg-brand-600/20' : 'bg-gray-600/20'}`}>
                  <CalendarClock className={`w-5 h-5 ${s.enabled ? 'text-brand-400' : 'text-gray-500'}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{s.name || s.id}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-zeno-text">{s.platform}</span>
                    <span className="text-xs text-zeno-text">|</span>
                    <span className="text-xs text-zeno-text">{s.type}</span>
                    <span className="text-xs text-zeno-text">|</span>
                    <span className="text-xs text-zeno-text font-mono">{s.cron_expression}</span>
                  </div>
                  {s.last_run && (
                    <p className="text-xs text-zeno-text/60 mt-1">
                      上次运行: {new Date(s.last_run).toLocaleString('zh-CN')} ({s.run_count || 0} 次)
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggle(s.id, s.enabled)}
                  className={`p-2 rounded-lg border transition-colors ${s.enabled ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10' : 'border-zeno-border text-zeno-text hover:bg-white/5'}`}>
                  {s.enabled ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                </button>
                <button onClick={() => handleDelete(s.id)}
                  className="p-2 rounded-lg border border-zeno-border text-zeno-text hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <NewScheduleModal open={showNew} onClose={() => setShowNew(false)} onSubmit={handleCreate} platforms={platforms} />
    </div>
  )
}
