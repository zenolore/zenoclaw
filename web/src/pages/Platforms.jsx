import { useEffect, useState, Fragment } from 'react'
import {
  Layers, RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Send, Database, Compass, MessageSquare, ChevronDown, ChevronRight,
  Play, Inbox, Bot, Loader2, ShieldCheck, TerminalSquare,
} from 'lucide-react'
import { api } from '../lib/api'

// 4 条链路的可视化定义
const CHAINS = [
  { key: 'publish',  label: '发布',     icon: Send },
  { key: 'read',     label: '数据采集', icon: Database },
  { key: 'browse',   label: '养号浏览', icon: Compass },
  { key: 'interact', label: '评论互动', icon: MessageSquare },
]

const INTERACT_LABELS = {
  like:           '点赞',
  comment_input:  '评论输入框',
  comment_submit: '评论提交按钮',
  follow:         '关注按钮',
}

// 单条链路的可视化状态：good / partial / missing / na
function statusFor(platform, chainKey) {
  const h = platform.health
  if (h.chainStatus?.[chainKey]) return h.chainStatus[chainKey]
  if (chainKey === 'publish') {
    if (!h.publish.hasPublish) return 'missing'
    if (h.publish.hasDirectStep) return 'partial'
    if (h.publish.usesRunStep) return 'good'
    return 'partial'
  }
  if (chainKey === 'read') {
    if (h.verified?.accountStats) return 'good'
    if (!h.read.hasReader) return 'missing'
    return h.read.isPlaceholder ? 'partial' : 'good'
  }
  if (chainKey === 'browse') {
    if (!h.browse.needBrowse) return 'na'
    if (!h.browse.hasBrowse) return 'missing'
    return h.browse.isPlaceholderSelectors ? 'partial' : 'good'
  }
  if (chainKey === 'interact') {
    if (h.verified?.replyDryRun || h.verified?.zhihuAnswerDryRun || h.verified?.comments) return 'good'
    if (!h.interact.hasSelectors) return 'missing'
    if (h.interact.missingFields.length === 0) return 'good'
    if (h.interact.missingFields.length < 4) return 'partial'
    return 'missing'
  }
  return 'na'
}

const STATUS_STYLES = {
  good:    'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  partial: 'bg-amber-500/15  text-amber-300  border-amber-500/30',
  missing: 'bg-red-500/15    text-red-300    border-red-500/30',
  na:      'bg-zeno-border/20 text-zeno-text/40 border-zeno-border/30',
}

const STATUS_LABEL = {
  good:    '完好',
  partial: '部分',
  missing: '缺失',
  na:      '不需要',
}

function ChainCell({ status }) {
  const Icon = status === 'good' ? CheckCircle2 : status === 'na' ? AlertCircle : status === 'partial' ? AlertCircle : XCircle
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${STATUS_STYLES[status]}`}>
      <Icon className="w-3 h-3" />
      {STATUS_LABEL[status]}
    </span>
  )
}

function ScoreBadge({ score }) {
  const color = score >= 90 ? 'text-emerald-300' : score >= 70 ? 'text-amber-300' : score >= 50 ? 'text-orange-300' : 'text-red-300'
  return <span className={`font-mono text-sm ${color}`}>{score}</span>
}

function SummaryCard({ icon: Icon, label, value, total, color }) {
  return (
    <div className="bg-zeno-card border border-zeno-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <span className="text-xs text-zeno-text">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">
        {value}
        {total !== undefined && <span className="text-sm text-zeno-text/60 font-normal"> / {total}</span>}
      </p>
    </div>
  )
}

function PlatformDetail({ platform }) {
  const h = platform.health
  return (
    <div className="bg-zeno-dark/40 border-t border-zeno-border/50 p-4 space-y-4">
      {/* 发布链路细节 */}
      <div>
        <p className="text-xs font-medium text-white mb-2 flex items-center gap-2">
          <Send className="w-3.5 h-3.5 text-zeno-accent" /> 发布链路
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-zeno-text">publish() 方法</span>
            <span className={`ml-2 ${h.publish.hasPublish ? 'text-emerald-400' : 'text-red-400'}`}>
              {h.publish.hasPublish ? '存在' : '缺失'}
            </span>
          </div>
          <div>
            <span className="text-zeno-text">使用统一治理外壳</span>
            <span className={`ml-2 ${h.publish.usesRunStep ? 'text-emerald-400' : 'text-amber-400'}`}>
              {h.publish.usesRunStep ? '是' : '否'}
            </span>
          </div>
          <div>
            <span className="text-zeno-text">残留直接步骤调用</span>
            <span className={`ml-2 ${h.publish.hasDirectStep ? 'text-amber-400' : 'text-emerald-400'}`}>
              {h.publish.hasDirectStep ? '有' : '无'}
            </span>
          </div>
        </div>
      </div>

      {/* 采集链路细节 */}
      <div>
        <p className="text-xs font-medium text-white mb-2 flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-zeno-accent" /> 数据采集
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-zeno-text">reader 文件</span>
            <span className={`ml-2 ${h.read.hasReader ? 'text-emerald-400' : 'text-red-400'}`}>
              {h.read.hasReader ? '存在' : '缺失'}
            </span>
          </div>
          <div>
            <span className="text-zeno-text">采集状态</span>
            <span className={`ml-2 ${h.read.hasReader && !h.read.isPlaceholder ? 'text-emerald-400' : 'text-amber-400'}`}>
              {h.read.isPlaceholder ? '占位（暂未实现）' : h.read.hasReader ? '真实采集' : '无'}
            </span>
          </div>
          {h.read.errorMessage && (
            <div className="col-span-3 text-red-400">加载错误: {h.read.errorMessage}</div>
          )}
        </div>
      </div>

      {/* 养号链路细节 */}
      <div>
        <p className="text-xs font-medium text-white mb-2 flex items-center gap-2">
          <Compass className="w-3.5 h-3.5 text-zeno-accent" /> 养号浏览
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-zeno-text">是否需要养号</span>
            <span className="ml-2 text-white">{h.browse.needBrowse ? '是' : '否'}</span>
          </div>
          <div>
            <span className="text-zeno-text">browse 文件</span>
            <span className={`ml-2 ${h.browse.hasBrowse ? 'text-emerald-400' : (h.browse.needBrowse ? 'text-red-400' : 'text-zeno-text')}`}>
              {h.browse.hasBrowse ? '存在' : '缺失'}
            </span>
          </div>
          <div>
            <span className="text-zeno-text">选择器</span>
            <span className={`ml-2 ${h.browse.hasBrowse && !h.browse.isPlaceholderSelectors ? 'text-emerald-400' : 'text-amber-400'}`}>
              {h.browse.isPlaceholderSelectors ? '占位（待真实平台实测）' : h.browse.hasBrowse ? '已实测' : '无'}
            </span>
          </div>
          {h.browse.homeUrl && (
            <div className="col-span-3 text-zeno-text/70">
              首页: <a href={h.browse.homeUrl} target="_blank" rel="noreferrer" className="text-brand-300 hover:underline">{h.browse.homeUrl}</a>
            </div>
          )}
        </div>
      </div>

      {/* 互动链路细节 */}
      <div>
        <p className="text-xs font-medium text-white mb-2 flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-zeno-accent" /> 评论互动
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
          {Object.entries(INTERACT_LABELS).map(([key, label]) => {
            const f = h.interact.fields[key]
            const filled = f?.filled
            return (
              <div key={key} className={`px-2 py-1 rounded border ${filled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                <span>{label}</span>
                <span className="ml-1 text-[10px]">{filled ? `(${f.count} 个候选)` : '空'}</span>
              </div>
            )
          })}
        </div>
        {h.interact.missingFields.length > 0 && (
          <p className="text-[11px] text-zeno-text/70 mt-2">
            缺真实选择器的字段：{h.interact.missingFields.map(f => INTERACT_LABELS[f] || f).join('、')}（需要在登录后的浏览器里 DevTools 取选择器，填到 <code className="text-brand-300">platforms/{platform.name}/selectors.js</code> 的 INTERACT_SELECTORS）
          </p>
        )}
      </div>
    </div>
  )
}


const OPERATION_PLATFORMS = [
  { name: 'toutiao', label: '头条', canComments: true, canReply: true },
  { name: 'baijiahao', label: '百家号', canComments: true, canReply: true },
  { name: 'douyin', label: '抖音', canComments: false, canReply: false },
  { name: 'channels', label: '视频号', canComments: false, canReply: false },
  { name: 'zhihu', label: '知乎', canComments: false, canReply: false, canAnswer: true },
  { name: 'bilibili', label: 'B站', canComments: true, canReply: true },
  { name: 'wechat', label: '公众号', canComments: true, canReply: false },
]

function MiniJson({ value }) {
  if (!value) return null
  return (
    <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-black/30 border border-zeno-border p-3 text-[11px] text-zeno-text whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function OperationButton({ children, icon: Icon = Play, loading, disabled, onClick, tone = 'brand' }) {
  const toneClass = tone === 'green'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
    : tone === 'amber'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
      : 'border-brand-500/40 bg-brand-500/10 text-brand-200 hover:bg-brand-500/20'
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneClass}`}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  )
}

function StatChips({ data }) {
  if (!data || data.error) return null
  const entries = Object.entries(data)
    .filter(([k, v]) => v !== null && v !== undefined && !['probedAt'].includes(k))
    .slice(0, 10)
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {entries.map(([k, v]) => (
        <span key={k} className="px-2 py-1 rounded-md bg-white/5 border border-zeno-border text-[11px] text-zeno-text">
          <span className="text-zeno-text/60">{k}</span>: <span className="text-white font-mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </span>
      ))}
    </div>
  )
}

function buildReplyMatcher(comment) {
  if (!comment) return {}
  return {
    author: comment.author,
    videoTitle: comment.videoTitle,
    articleTitle: comment.articleTitle,
    content: comment.content?.slice(0, 20),
  }
}

function OperationsConsole() {
  const [activePlatform, setActivePlatform] = useState('toutiao')
  const [loadingKey, setLoadingKey] = useState('')
  const [accountResults, setAccountResults] = useState({})
  const [commentsResults, setCommentsResults] = useState({})
  const [replyResults, setReplyResults] = useState({})
  const [zhihuQuestions, setZhihuQuestions] = useState([])
  const [zhihuResult, setZhihuResult] = useState(null)
  const [replyText, setReplyText] = useState('感谢留言，已阅')
  const [zhihuAnswer, setZhihuAnswer] = useState('这是一条 dryRun 测试回答，不会真正发布。')
  const [error, setError] = useState('')

  const active = OPERATION_PLATFORMS.find(p => p.name === activePlatform) || OPERATION_PLATFORMS[0]
  const firstComment = commentsResults[activePlatform]?.comments?.[0]
  const loading = (key) => loadingKey === key

  const run = async (key, fn) => {
    setLoadingKey(key)
    setError('')
    try { await fn() }
    catch (e) { setError(e.message) }
    finally { setLoadingKey('') }
  }

  const collectAccount = (platform) => run(`account:${platform}`, async () => {
    const res = await api.post('/platforms/operations/account-stats', { platform })
    setAccountResults(prev => ({ ...prev, [platform]: res }))
  })

  const loadComments = (platform) => run(`comments:${platform}`, async () => {
    const res = await api.post('/platforms/operations/comments', { platform, limit: 10 })
    setCommentsResults(prev => ({ ...prev, [platform]: res }))
  })

  const replyDryRun = (platform) => run(`reply:${platform}`, async () => {
    const matcher = buildReplyMatcher(commentsResults[platform]?.comments?.[0])
    const res = await api.post('/platforms/operations/reply-dryrun', { platform, matcher, replyText })
    setReplyResults(prev => ({ ...prev, [platform]: res }))
  })

  const loadZhihuQuestions = () => run('zhihu:questions', async () => {
    const res = await api.post('/platforms/operations/zhihu-questions', { limit: 10 })
    setZhihuQuestions(res.questions || [])
  })

  const zhihuAnswerDryRun = () => run('zhihu:answer', async () => {
    const questionUrl = zhihuQuestions[0]?.questionUrl
    if (!questionUrl) throw new Error('请先获取知乎问题列表')
    const res = await api.post('/platforms/operations/zhihu-answer-dryrun', { questionUrl, answerText: zhihuAnswer })
    setZhihuResult(res)
  })

  return (
    <div className="bg-zeno-card border border-zeno-border rounded-xl p-4 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <TerminalSquare className="w-5 h-5 text-zeno-accent" /> 平台操作控制台
          </h2>
          <p className="text-xs text-zeno-text mt-1">
            连接 Chrome 9222，直接调用已实测的 reader / replier / answerer；所有回评和知乎回答默认 dryRun，不会真正发布。
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-[11px] text-emerald-300 border border-emerald-500/30 rounded-lg px-2 py-1 bg-emerald-500/10">
          <ShieldCheck className="w-3.5 h-3.5" /> dryRun 安全默认
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[220px_1fr] gap-4">
        <div className="space-y-2">
          {OPERATION_PLATFORMS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => setActivePlatform(p.name)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                activePlatform === p.name
                  ? 'bg-brand-600/20 border-brand-500/40 text-white'
                  : 'bg-white/[0.02] border-zeno-border text-zeno-text hover:text-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{p.label}</span>
                <span className="text-[10px] font-mono opacity-60">{p.name}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-zeno-border bg-zeno-dark/30 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <OperationButton
                icon={Database}
                loading={loading(`account:${active.name}`)}
                onClick={() => collectAccount(active.name)}
              >
                采集账号数据
              </OperationButton>
              {active.canComments && (
                <OperationButton
                  icon={Inbox}
                  tone="green"
                  loading={loading(`comments:${active.name}`)}
                  onClick={() => loadComments(active.name)}
                >
                  查看读者评论
                </OperationButton>
              )}
              {active.canReply && (
                <OperationButton
                  icon={MessageSquare}
                  tone="amber"
                  disabled={!firstComment}
                  loading={loading(`reply:${active.name}`)}
                  onClick={() => replyDryRun(active.name)}
                >
                  回评 dryRun（第一条）
                </OperationButton>
              )}
            </div>

            {active.canReply && (
              <div className="mt-3">
                <label className="text-[11px] text-zeno-text">dryRun 回复内容</label>
                <input
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-black/20 border border-zeno-border px-3 py-2 text-xs text-white outline-none focus:border-brand-500"
                />
              </div>
            )}

            <StatChips data={accountResults[active.name]?.data} />
            <MiniJson value={accountResults[active.name]} />
          </div>

          {active.canComments && (
            <div className="rounded-xl border border-zeno-border bg-zeno-dark/30 p-4">
              <h3 className="text-sm font-medium text-white mb-3">评论列表</h3>
              <div className="space-y-2 max-h-64 overflow-auto">
                {(commentsResults[active.name]?.comments || []).map((c, i) => (
                  <div key={i} className="rounded-lg border border-zeno-border bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-white">{c.author || '(未知作者)'}</span>
                      <span className="text-zeno-text/60">{c.time || c.publishTime || ''}</span>
                    </div>
                    <p className="text-xs text-zeno-text mt-1">{c.content || c.comment || '(无内容)'}</p>
                    {(c.articleTitle || c.videoTitle) && (
                      <p className="text-[11px] text-zeno-text/60 mt-1">作品：{c.articleTitle || c.videoTitle}</p>
                    )}
                  </div>
                ))}
                {commentsResults[active.name] && (commentsResults[active.name]?.comments || []).length === 0 && (
                  <p className="text-xs text-zeno-text">未读到评论或当前账号无评论。</p>
                )}
              </div>
              <MiniJson value={replyResults[active.name]} />
            </div>
          )}

          {active.canAnswer && (
            <div className="rounded-xl border border-zeno-border bg-zeno-dark/30 p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <OperationButton icon={Bot} loading={loading('zhihu:questions')} onClick={loadZhihuQuestions}>
                  获取知乎问题列表
                </OperationButton>
                <OperationButton icon={Play} tone="amber" disabled={!zhihuQuestions[0]} loading={loading('zhihu:answer')} onClick={zhihuAnswerDryRun}>
                  回答第一题 dryRun
                </OperationButton>
              </div>
              <textarea
                value={zhihuAnswer}
                onChange={e => setZhihuAnswer(e.target.value)}
                className="w-full min-h-20 rounded-lg bg-black/20 border border-zeno-border px-3 py-2 text-xs text-white outline-none focus:border-brand-500"
              />
              <div className="space-y-2 mt-3 max-h-64 overflow-auto">
                {zhihuQuestions.map((q, i) => (
                  <div key={q.questionUrl || i} className="rounded-lg border border-zeno-border bg-white/[0.02] p-3">
                    <p className="text-xs text-white">{i + 1}. {q.title}</p>
                    <p className="text-[11px] text-zeno-text/60 mt-1">{q.answerCount ?? '-'} 回答 / {q.followCount ?? '-'} 关注</p>
                  </div>
                ))}
              </div>
              <MiniJson value={zhihuResult} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PlatformsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(new Set())

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/platforms/health')
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleExpand = (name) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const platforms = data?.platforms || []
  const summary = data?.summary || {}

  const filtered = platforms.filter(p => {
    if (filter === 'all') return true
    if (filter === 'core') return ['toutiao', 'baijiahao', 'douyin', 'channels', 'wechat'].includes(p.name)
    if (filter === 'incomplete') {
      return Object.values(p.health).some(v =>
        (v.isPlaceholder === true) ||
        (v.isPlaceholderSelectors === true) ||
        (v.missingFields && v.missingFields.length > 0) ||
        (v.hasDirectStep === true)
      )
    }
    return true
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">平台健康</h1>
          <p className="text-sm text-zeno-text mt-1">
            19 个平台 × 4 条链路（发布 / 数据采集 / 养号浏览 / 评论互动）的当前覆盖情况
          </p>
        </div>
        <button onClick={load} className="p-2 text-zeno-text hover:text-white border border-zeno-border rounded-lg hover:bg-white/5">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm text-red-300">健康数据加载失败</p>
            <p className="text-xs text-red-400/70 mt-1">错误: {error}</p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <SummaryCard icon={Layers}    label="平台总数"            value={summary.totalPlatforms}            color="bg-brand-600" />
          <SummaryCard icon={Send}      label="发布链路统一治理"     value={summary.publishUsingRunStep}       total={summary.totalPlatforms} color="bg-violet-600" />
          <SummaryCard icon={Database}  label="真实数据采集"         value={summary.realReaders}                total={summary.totalPlatforms} color="bg-emerald-600" />
          <SummaryCard icon={MessageSquare} label="互动能力可用"       value={summary.interactSelectorsComplete} total={summary.totalPlatforms} color="bg-rose-600" />
          <SummaryCard icon={Compass}   label="养号浏览就绪"         value={summary.browseReady}                total={summary.totalPlatforms} color="bg-amber-600" />
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {[
          { value: 'all',        label: '全部' },
          { value: 'core',       label: '5 核心平台' },
          { value: 'incomplete', label: '仅看待补充' },
        ].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filter === f.value
                ? 'bg-brand-600 border-brand-500 text-white'
                : 'bg-zeno-card border-zeno-border text-zeno-text hover:text-white'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      <OperationsConsole />

      {/* Table */}
      <div className="bg-zeno-card border border-zeno-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-zeno-text border-b border-zeno-border">
              <th className="text-left py-3 px-4 font-medium w-10"></th>
              <th className="text-left py-3 px-4 font-medium">平台</th>
              <th className="text-left py-3 px-4 font-medium w-20">健康分</th>
              {CHAINS.map(c => (
                <th key={c.key} className="text-left py-3 px-3 font-medium">
                  <span className="inline-flex items-center gap-1">
                    <c.icon className="w-3.5 h-3.5" />
                    {c.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const isOpen = expanded.has(p.name)
              return (
                <Fragment key={p.name}>
                  <tr onClick={() => toggleExpand(p.name)}
                    className="border-b border-zeno-border/50 hover:bg-white/[0.02] cursor-pointer">
                    <td className="py-3 px-4">
                      {isOpen
                        ? <ChevronDown className="w-4 h-4 text-zeno-text" />
                        : <ChevronRight className="w-4 h-4 text-zeno-text" />}
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-white">{p.label}</p>
                      <p className="text-[11px] text-zeno-text font-mono">{p.name}</p>
                    </td>
                    <td className="py-3 px-4">
                      <ScoreBadge score={p.health.score} />
                    </td>
                    {CHAINS.map(c => (
                      <td key={c.key} className="py-3 px-3">
                        <ChainCell status={statusFor(p, c.key)} />
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={3 + CHAINS.length} className="p-0">
                        <PlatformDetail platform={p} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={3 + CHAINS.length} className="py-8 text-center text-sm text-zeno-text">无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* External API hint */}
      <div className="mt-6 bg-zeno-card border border-zeno-border rounded-xl p-4">
        <p className="text-xs text-zeno-text">
          外部程序可直接调用 <code className="text-brand-300">GET /api/platforms/health</code> 获取此页面相同 JSON 数据，请求头需带 <code className="text-brand-300">X-API-Key</code>。
        </p>
      </div>
    </div>
  )
}
