import { useState, useEffect } from 'react'
import { Settings, Key, Globe, Bell, Shield, Database, Save, UserCircle, Plus, Trash2, Eye, EyeOff, ScanEye } from 'lucide-react'
import { api } from '../lib/api'

function Section({ icon: Icon, title, children }) {
  return (
    <div className="bg-zeno-card border border-zeno-border rounded-xl p-6 mb-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center">
          <Icon className="w-4 h-4 text-brand-400" />
        </div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function InputRow({ label, description, value, onChange, type = 'text', placeholder, readOnly }) {
  return (
    <div className="flex items-start justify-between gap-8 py-3 border-b border-zeno-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        {description && <p className="text-xs text-zeno-text mt-0.5">{description}</p>}
      </div>
      {readOnly ? (
        <span className="w-64 text-sm text-zeno-text bg-zeno-dark/30 border border-zeno-border/30 rounded-lg px-3 py-1.5 shrink-0 select-all cursor-default">
          {value || '-'}
        </span>
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-64 bg-zeno-dark border border-zeno-border rounded-lg px-3 py-1.5 text-sm text-white placeholder-zeno-text/50 focus:border-zeno-accent focus:outline-none shrink-0"
        />
      )}
    </div>
  )
}

function ReadOnlyBadge({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-8 py-3 border-b border-zeno-border/50 last:border-0">
      <p className="text-sm text-white">{label}</p>
      <span className="text-sm text-zeno-text bg-zeno-dark/30 border border-zeno-border/30 rounded-lg px-3 py-1.5 shrink-0">
        {value}
      </span>
    </div>
  )
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-8 py-3 border-b border-zeno-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        {description && <p className="text-xs text-zeno-text mt-0.5">{description}</p>}
      </div>
      <button onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-brand-600' : 'bg-zeno-border'}`}>
        <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-1 ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [settings, setSettings] = useState({
    apiPort: '3200',
    corsOrigin: '*',
    authEnabled: true,
    rateLimit: '60',
    notifierType: 'console',
    webhookUrl: '',
    captchaSolver: 'manual',
    dataDir: './data',
  })
  const [accounts, setAccounts] = useState([])
  const [saved, setSaved] = useState(false)
  const [vision, setVision] = useState({ enabled: false, has_key: false, key_source: 'none', model: '', base_url: '', timeout: 0 })

  const [validating, setValidating] = useState(false)
  const [keyStatus, setKeyStatus] = useState('')  // '', 'valid', 'invalid'

  useEffect(() => {
    const stored = api.getStoredKey()
    if (stored) setApiKey(stored)

    api.get('/account').then(res => setAccounts(res?.accounts || [])).catch(() => {})

    // 从后端读取实际服务配置
    api.get('/config').then(res => {
      if (res) {
        setSettings(prev => ({
          ...prev,
          apiPort: String(res.api?.port || prev.apiPort),
          corsOrigin: res.api?.cors_origin || prev.corsOrigin,
          rateLimit: String(res.api?.rate_limit_max || prev.rateLimit),
          authEnabled: res.api?.auth_enabled ?? prev.authEnabled,
          notifierType: res.plugins?.notifier || prev.notifierType,
          captchaSolver: res.plugins?.captcha_solver || prev.captchaSolver,
          dataDir: res.data_dir || prev.dataDir,
        }))
        if (res.vision) setVision(res.vision)
      }
    }).catch(() => {})
  }, [])

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      api.setStoredKey('')
      setSaved(true)
      setKeyStatus('')
      setTimeout(() => setSaved(false), 2000)
      return
    }
    // 保存前先验证 key 有效性
    setValidating(true)
    setKeyStatus('')
    const result = await api.validateApiKey(apiKey)
    setValidating(false)
    if (result.valid) {
      api.setStoredKey(apiKey)
      setKeyStatus('valid')
      setSaved(true)
      setTimeout(() => { setSaved(false); setKeyStatus('') }, 3000)
    } else {
      setKeyStatus('invalid')
      // 仍然保存（用户可能知道自己在做什么），但提示警告
      api.setStoredKey(apiKey)
      setTimeout(() => setKeyStatus(''), 5000)
    }
  }

  const handleDeleteAccount = async (id) => {
    if (!confirm('确定删除此账号？')) return
    try {
      await api.del(`/account/${id}`)
      setAccounts(accounts.filter(a => a.id !== id))
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">设置</h1>
          <p className="text-sm text-zeno-text mt-1">API 配置、账号管理、通知设置</p>
        </div>
      </div>

      {/* API Key */}
      <Section icon={Key} title="API 认证">
        <div className="flex items-start justify-between gap-8 py-3">
          <div>
            <p className="text-sm text-white">API Key</p>
            <p className="text-xs text-zeno-text mt-0.5">用于 Web UI 与 API Server 之间的鉴权</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="输入 API Key"
                className="w-64 bg-zeno-dark border border-zeno-border rounded-lg px-3 py-1.5 pr-9 text-sm text-white placeholder-zeno-text/50 focus:border-zeno-accent focus:outline-none"
              />
              <button onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zeno-text hover:text-white">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={handleSaveApiKey} disabled={validating}
              className={`px-3 py-1.5 text-white text-sm rounded-lg flex items-center gap-1.5 ${validating ? 'bg-gray-600 cursor-wait' : 'bg-brand-600 hover:bg-brand-500'}`}>
              <Save className="w-3 h-3" />
              {validating ? '验证中...' : saved ? '已保存' : '保存'}
            </button>
          </div>
          {keyStatus === 'valid' && (
            <p className="text-xs text-emerald-400 mt-2 text-right">API Key 验证通过</p>
          )}
          {keyStatus === 'invalid' && (
            <p className="text-xs text-amber-400 mt-2 text-right">API Key 验证未通过（已保存，请检查服务端配置）</p>
          )}
        </div>
        <p className="text-xs text-zeno-text/60 mt-3">
          API Key 存储在浏览器会话中（标签页关闭即清除），不会持久化到磁盘。
        </p>
      </Section>

      {/* Server Settings (read-only from server config) */}
      <Section icon={Globe} title="服务配置">
        <p className="text-xs text-amber-400/80 mb-4 flex items-center gap-1.5">
          <Shield className="w-3 h-3" />
          以下为服务端当前配置（只读），修改请编辑 zenoclaw.config.yaml 并重启服务
        </p>
        <InputRow label="API 端口" description="API Server 监听端口" value={settings.apiPort} readOnly />
        <InputRow label="CORS Origin" description="允许的跨域来源" value={settings.corsOrigin} readOnly />
        <InputRow label="请求频率限制" description="每分钟最大请求数" value={`${settings.rateLimit} 次/分`} readOnly />
        <ReadOnlyBadge label="API 鉴权" value={settings.authEnabled ? '已启用' : '已关闭'} />
      </Section>

      {/* Notification (read-only) */}
      <Section icon={Bell} title="通知设置">
        <p className="text-xs text-amber-400/80 mb-4 flex items-center gap-1.5">
          <Shield className="w-3 h-3" />
          修改请编辑 zenoclaw.config.yaml 的 plugins.notifier 配置项
        </p>
        <ReadOnlyBadge label="通知方式" value={settings.notifierType === 'webhook' ? 'Webhook (HTTP POST)' : '控制台输出'} />
      </Section>

      {/* Captcha (read-only) */}
      <Section icon={Shield} title="验证码处理">
        <p className="text-xs text-amber-400/80 mb-4 flex items-center gap-1.5">
          <Shield className="w-3 h-3" />
          修改请编辑 zenoclaw.config.yaml 的 plugins.captcha_solver 配置项
        </p>
        <ReadOnlyBadge label="处理方式" value={
          settings.captchaSolver === '2captcha' ? '2Captcha API'
          : settings.captchaSolver === 'custom' ? '自定义插件'
          : '手动处理（暂停等待）'
        } />
      </Section>

      {/* Vision AI Verification */}
      <Section icon={ScanEye} title="AI 视觉验证">
        <p className="text-xs text-zeno-text/80 mb-4">
          发布前自动截图页面，调用视觉 AI 模型验证内容是否正确填写。支持 GLM-4V / GPT-4V / Qwen-VL 等 OpenAI 兼容接口。
        </p>
        <ReadOnlyBadge label="功能状态" value={
          vision.enabled
            ? <span className="text-emerald-400">已启用</span>
            : <span className="text-zeno-text/60">未启用</span>
        } />
        <ReadOnlyBadge label="API Key" value={
          vision.has_key
            ? <span className="text-emerald-400">已配置（来源: {vision.key_source === 'env' ? '环境变量 VISION_API_KEY' : 'config.yaml'}）</span>
            : <span className="text-amber-400">未配置</span>
        } />
        <ReadOnlyBadge label="模型" value={vision.model || '-'} />
        <ReadOnlyBadge label="API 端点" value={vision.base_url ? vision.base_url.replace(/\/chat\/completions$/, '/...') : '-'} />
        <ReadOnlyBadge label="超时" value={vision.timeout ? `${vision.timeout / 1000}s` : '-'} />
        <div className="mt-4 p-3 bg-zeno-dark/50 rounded-lg">
          <p className="text-xs text-zeno-text">配置方法（二选一）：</p>
          <p className="text-xs text-zeno-text/60 mt-1 font-mono">1. 编辑 zenoclaw.config.yaml → vision.api_key 和 vision.enabled: true</p>
          <p className="text-xs text-zeno-text/60 mt-0.5 font-mono">2. 设置环境变量: VISION_API_KEY=你的密钥</p>
          <p className="text-xs text-amber-400/60 mt-2">修改后需重启 API Server 生效</p>
        </div>
      </Section>

      {/* Accounts */}
      <Section icon={UserCircle} title="账号管理">
        {accounts.length === 0 ? (
          <div className="text-center py-8">
            <UserCircle className="w-10 h-10 text-zeno-border mx-auto mb-2" />
            <p className="text-sm text-zeno-text">暂无已保存的账号</p>
            <p className="text-xs text-zeno-text/60 mt-1">通过 API 添加账号: POST /api/account</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between bg-zeno-dark/50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-600/20 flex items-center justify-center text-xs text-brand-300 font-medium">
                    {acc.platform?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm text-white">{acc.username}</p>
                    <div className="flex items-center gap-2 text-xs text-zeno-text mt-0.5">
                      <span>{acc.platform}</span>
                      {acc.last_login && <span>| 上次登录: {new Date(acc.last_login).toLocaleDateString('zh-CN')}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${acc.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                    {acc.status}
                  </span>
                  <button onClick={() => handleDeleteAccount(acc.id)}
                    className="p-1.5 text-zeno-text hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Data Storage (read-only) */}
      <Section icon={Database} title="数据存储">
        <InputRow label="数据目录" description="统计数据、历史记录存储位置" value={settings.dataDir} readOnly />
      </Section>

      {/* Info */}
      <div className="bg-zeno-card border border-zeno-border rounded-xl p-5 text-center">
        <p className="text-xs text-zeno-text">
          ZenoClaw v0.1.0 | 开源智能浏览器自动化引擎 | Powered by Zeno
        </p>
        <p className="text-xs text-zeno-text/50 mt-1">
          部分设置需要修改 zenoclaw.config.yaml 并重启 API Server 生效
        </p>
      </div>
    </div>
  )
}
