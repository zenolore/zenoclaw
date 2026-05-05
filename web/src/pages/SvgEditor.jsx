import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Code2, Eye, Download, Copy, Check, ImageIcon, Maximize2,
  RotateCcw, ZoomIn, ZoomOut, Send, Clipboard, Save, Trash2,
  Smartphone, Monitor, Square, RectangleHorizontal
} from 'lucide-react'

const PRESETS = [
  { label: '小红书竖版', width: 1080, height: 1440, icon: Smartphone },
  { label: '小红书方形', width: 1080, height: 1080, icon: Square },
  { label: '公众号头图', width: 900, height: 383, icon: RectangleHorizontal },
  { label: '微博配图', width: 1080, height: 720, icon: Monitor },
  { label: '自定义', width: null, height: null, icon: Maximize2 },
]

const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1440">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1440" fill="url(#bg)" rx="40"/>
  <text x="540" y="600" text-anchor="middle" fill="white" font-size="72" font-weight="bold" font-family="system-ui">在这里粘贴</text>
  <text x="540" y="700" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="42" font-family="system-ui">Zeno App 生成的 SVG 代码</text>
  <text x="540" y="820" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="32" font-family="system-ui">支持实时预览 · 调整尺寸 · 下载图片</text>
  <circle cx="540" cy="1050" r="80" fill="rgba(255,255,255,0.15)"/>
  <text x="540" y="1065" text-anchor="middle" fill="white" font-size="48" font-family="system-ui">🐾</text>
</svg>`

// 本地存储管理
const STORAGE_KEY = 'zenoclaw_svg_saves'
function loadSaves() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveSaves(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 50)))
}

export default function SvgEditor() {
  const [svgCode, setSvgCode] = useState(DEMO_SVG)
  const [activeTab, setActiveTab] = useState('preview') // preview | code
  const [copied, setCopied] = useState(false)
  const [scale, setScale] = useState(0.5)
  const [customW, setCustomW] = useState(1080)
  const [customH, setCustomH] = useState(1440)
  const [activePreset, setActivePreset] = useState(0)
  const [saves, setSaves] = useState(loadSaves)
  const [showSaves, setShowSaves] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const previewRef = useRef(null)
  const canvasRef = useRef(null)

  // 从SVG中提取viewBox尺寸
  const parseSvgSize = useCallback((code) => {
    const vbMatch = code.match(/viewBox=["'](\d+)\s+(\d+)\s+(\d+)\s+(\d+)["']/)
    if (vbMatch) return { w: +vbMatch[3], h: +vbMatch[4] }
    const wMatch = code.match(/width=["'](\d+)/)
    const hMatch = code.match(/height=["'](\d+)/)
    if (wMatch && hMatch) return { w: +wMatch[1], h: +hMatch[1] }
    return { w: 1080, h: 1440 }
  }, [])

  // 当前显示尺寸
  const currentSize = activePreset === PRESETS.length - 1
    ? { w: customW, h: customH }
    : PRESETS[activePreset]
      ? { w: PRESETS[activePreset].width, h: PRESETS[activePreset].height }
      : parseSvgSize(svgCode)

  // 应用尺寸到SVG代码
  const applySizeToSvg = useCallback((code, w, h) => {
    let result = code
    // 更新 viewBox
    if (result.includes('viewBox')) {
      result = result.replace(/viewBox=["'][^"']*["']/, `viewBox="0 0 ${w} ${h}"`)
    }
    // 更新 width/height
    if (result.match(/width=["']\d+/)) {
      result = result.replace(/width=["']\d+["']?/, `width="${w}"`)
      result = result.replace(/height=["']\d+["']?/, `height="${h}"`)
    }
    return result
  }, [])

  // 获取渲染用的SVG（应用当前尺寸）
  const renderSvg = useCallback(() => {
    if (!svgCode.trim()) return ''
    return applySizeToSvg(svgCode, currentSize.w, currentSize.h)
  }, [svgCode, currentSize, applySizeToSvg])

  // 复制SVG代码
  const handleCopy = async () => {
    await navigator.clipboard.writeText(renderSvg())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 从剪贴板粘贴
  const handlePaste = async () => {
    const text = await navigator.clipboard.readText()
    if (text && (text.includes('<svg') || text.includes('<?xml'))) {
      setSvgCode(text)
      // 自动检测尺寸
      const size = parseSvgSize(text)
      setCustomW(size.w)
      setCustomH(size.h)
    }
  }

  // 下载为PNG
  const handleDownload = async (format = 'png') => {
    const svg = renderSvg()
    const { w, h } = currentSize

    const canvas = document.createElement('canvas')
    // 2x 分辨率
    canvas.width = w * 2
    canvas.height = h * 2
    const ctx = canvas.getContext('2d')
    ctx.scale(2, 2)

    const img = new Image()
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const link = document.createElement('a')
      link.download = `zenoclaw-poster-${w}x${h}.${format}`
      link.href = canvas.toDataURL(`image/${format}`, 0.95)
      link.click()
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      // fallback: 下载SVG
      const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
      const svgUrl = URL.createObjectURL(svgBlob)
      const link = document.createElement('a')
      link.download = `zenoclaw-poster-${w}x${h}.svg`
      link.href = svgUrl
      link.click()
      URL.revokeObjectURL(svgUrl)
    }
    img.src = url
  }

  // 保存到本地
  const handleSave = () => {
    const item = {
      id: Date.now(),
      code: svgCode,
      size: currentSize,
      preview: svgCode.slice(0, 200),
      savedAt: new Date().toISOString(),
    }
    const newSaves = [item, ...saves]
    setSaves(newSaves)
    saveSaves(newSaves)
  }

  // 加载保存的代码
  const handleLoadSave = (item) => {
    setSvgCode(item.code)
    if (item.size) {
      setCustomW(item.size.w)
      setCustomH(item.size.h)
      setActivePreset(PRESETS.length - 1)
    }
    setShowSaves(false)
  }

  // 删除保存
  const handleDeleteSave = (id) => {
    const newSaves = saves.filter(s => s.id !== id)
    setSaves(newSaves)
    saveSaves(newSaves)
  }

  // 发布到平台（调用ZenoClaw API）
  const handlePublish = async () => {
    setPublishing(true)
    try {
      // 生成临时图片并转为 base64 data URL
      const svg = renderSvg()
      const { w, h } = currentSize
      const canvas = document.createElement('canvas')
      canvas.width = w * 2
      canvas.height = h * 2
      const ctx = canvas.getContext('2d')
      ctx.scale(2, 2)

      const img = new Image()
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)

      await new Promise((resolve, reject) => {
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h)
          URL.revokeObjectURL(url)
          resolve()
        }
        img.onerror = reject
        img.src = url
      })

      // 跳转到发帖页面，将图片信息存入 sessionStorage
      const dataUrl = canvas.toDataURL('image/png', 0.95)
      sessionStorage.setItem('zenoclaw_svg_image', dataUrl)
      sessionStorage.setItem('zenoclaw_svg_code', svgCode)
      window.location.hash = ''
      window.location.pathname = '/posts'
    } catch (err) {
      console.error('发布准备失败:', err)
    } finally {
      setPublishing(false)
    }
  }

  const displayW = currentSize.w * scale
  const displayH = currentSize.h * scale

  return (
    <div className="h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">SVG 海报工作台</h1>
          <p className="text-sm text-zeno-text mt-1">粘贴 SVG 代码，实时预览、调整尺寸、下载图片或直接发布</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePaste} className="flex items-center gap-2 px-3 py-2 text-sm text-zeno-text hover:text-white border border-zeno-border rounded-lg hover:bg-white/5 transition-colors">
            <Clipboard className="w-4 h-4" /> 粘贴 SVG
          </button>
          <button onClick={handleSave} className="flex items-center gap-2 px-3 py-2 text-sm text-zeno-text hover:text-white border border-zeno-border rounded-lg hover:bg-white/5 transition-colors">
            <Save className="w-4 h-4" /> 保存
          </button>
          <button onClick={() => setShowSaves(!showSaves)} className="flex items-center gap-2 px-3 py-2 text-sm text-zeno-text hover:text-white border border-zeno-border rounded-lg hover:bg-white/5 transition-colors relative">
            <ImageIcon className="w-4 h-4" /> 已保存
            {saves.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-600 rounded-full text-[10px] flex items-center justify-center text-white">{saves.length}</span>}
          </button>
        </div>
      </div>

      {/* Saved list dropdown */}
      {showSaves && saves.length > 0 && (
        <div className="absolute right-8 top-32 z-50 w-80 bg-zeno-card border border-zeno-border rounded-xl shadow-2xl max-h-96 overflow-y-auto">
          <div className="p-3 border-b border-zeno-border">
            <span className="text-sm font-medium text-white">已保存的海报 ({saves.length})</span>
          </div>
          {saves.map(s => (
            <div key={s.id} className="flex items-center gap-3 p-3 hover:bg-white/5 border-b border-zeno-border/50 cursor-pointer group" onClick={() => handleLoadSave(s)}>
              <div className="w-10 h-10 bg-zeno-dark rounded overflow-hidden flex-shrink-0" dangerouslySetInnerHTML={{ __html: s.code.replace(/width=["']\d+["']?/g, 'width="40"').replace(/height=["']\d+["']?/g, 'height="40"') }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white truncate">{s.size?.w}×{s.size?.h}</div>
                <div className="text-xs text-zeno-text">{new Date(s.savedAt).toLocaleString('zh-CN')}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleDeleteSave(s.id) }} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4 h-[calc(100%-5rem)]">
        {/* Left: Code Editor */}
        <div className="w-[45%] flex flex-col bg-zeno-card border border-zeno-border rounded-xl overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center border-b border-zeno-border">
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-b-2 ${activeTab === 'code' ? 'border-zeno-accent text-zeno-accent' : 'border-transparent text-zeno-text hover:text-white'}`}
            >
              <Code2 className="w-4 h-4" /> SVG 代码
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-b-2 ${activeTab === 'preview' ? 'border-zeno-accent text-zeno-accent' : 'border-transparent text-zeno-text hover:text-white'}`}
            >
              <Eye className="w-4 h-4" /> 预览
            </button>
            <div className="flex-1" />
            <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-1.5 mr-2 text-xs text-zeno-text hover:text-white transition-colors">
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>

          {/* Content */}
          {activeTab === 'code' ? (
            <textarea
              value={svgCode}
              onChange={e => setSvgCode(e.target.value)}
              placeholder="在此粘贴 SVG 代码..."
              spellCheck={false}
              className="flex-1 w-full bg-zeno-dark text-green-300 font-mono text-xs p-4 resize-none focus:outline-none leading-relaxed"
            />
          ) : (
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[#1a1a2e]">
              <div
                ref={previewRef}
                style={{ width: displayW, height: displayH }}
                className="shadow-2xl rounded-lg overflow-hidden bg-white flex-shrink-0"
                dangerouslySetInnerHTML={{ __html: renderSvg() }}
              />
            </div>
          )}
        </div>

        {/* Right: Live Preview + Controls */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Size Presets */}
          <div className="bg-zeno-card border border-zeno-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Maximize2 className="w-4 h-4 text-zeno-accent" />
              <span className="text-sm font-medium text-white">尺寸预设</span>
              <span className="text-xs text-zeno-text ml-auto">{currentSize.w} × {currentSize.h}</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESETS.map((p, i) => {
                const Icon = p.icon
                return (
                  <button
                    key={i}
                    onClick={() => setActivePreset(i)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      activePreset === i
                        ? 'border-zeno-accent bg-brand-600/20 text-zeno-accent'
                        : 'border-zeno-border text-zeno-text hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {p.label}
                  </button>
                )
              })}
            </div>
            {activePreset === PRESETS.length - 1 && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-zeno-text">宽</span>
                  <input type="number" value={customW} onChange={e => setCustomW(+e.target.value || 100)}
                    className="w-20 bg-zeno-dark border border-zeno-border rounded px-2 py-1 text-xs text-white text-center focus:border-zeno-accent focus:outline-none" />
                </div>
                <span className="text-zeno-text">×</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-zeno-text">高</span>
                  <input type="number" value={customH} onChange={e => setCustomH(+e.target.value || 100)}
                    className="w-20 bg-zeno-dark border border-zeno-border rounded px-2 py-1 text-xs text-white text-center focus:border-zeno-accent focus:outline-none" />
                </div>
              </div>
            )}
            {/* Zoom */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zeno-border/50">
              <span className="text-xs text-zeno-text">缩放</span>
              <button onClick={() => setScale(s => Math.max(0.1, s - 0.1))} className="p-1 text-zeno-text hover:text-white"><ZoomOut className="w-3 h-3" /></button>
              <input type="range" min="0.1" max="1.5" step="0.05" value={scale} onChange={e => setScale(+e.target.value)}
                className="flex-1 h-1 bg-zeno-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-zeno-accent [&::-webkit-slider-thumb]:rounded-full" />
              <button onClick={() => setScale(s => Math.min(1.5, s + 0.1))} className="p-1 text-zeno-text hover:text-white"><ZoomIn className="w-3 h-3" /></button>
              <span className="text-xs text-zeno-text w-10 text-right">{Math.round(scale * 100)}%</span>
            </div>
          </div>

          {/* Live Preview Area */}
          <div className="flex-1 bg-zeno-card border border-zeno-border rounded-xl overflow-auto flex items-center justify-center p-4"
               style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
            {svgCode.trim() ? (
              <div
                style={{ width: displayW, height: displayH }}
                className="shadow-2xl rounded-lg overflow-hidden bg-white flex-shrink-0 transition-all duration-200"
                dangerouslySetInnerHTML={{ __html: renderSvg() }}
              />
            ) : (
              <div className="text-center">
                <Code2 className="w-16 h-16 text-zeno-border mx-auto mb-3" />
                <p className="text-sm text-zeno-text">粘贴 SVG 代码开始预览</p>
                <p className="text-xs text-zeno-text/50 mt-1">支持从 Zeno App 复制的 SVG 海报代码</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button onClick={() => handleDownload('png')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zeno-card border border-zeno-border rounded-xl text-sm text-white hover:bg-white/5 transition-colors">
              <Download className="w-4 h-4" /> 下载 PNG
            </button>
            <button onClick={() => handleDownload('jpeg')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zeno-card border border-zeno-border rounded-xl text-sm text-white hover:bg-white/5 transition-colors">
              <Download className="w-4 h-4" /> 下载 JPG
            </button>
            <button onClick={handlePublish} disabled={publishing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 rounded-xl text-sm text-white hover:bg-brand-500 disabled:opacity-50 transition-colors">
              <Send className="w-4 h-4" /> {publishing ? '准备中...' : '去发布'}
            </button>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
