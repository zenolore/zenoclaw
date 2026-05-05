import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Send, CalendarClock, BarChart3, Settings, Code2,
  MessageSquare, Globe, UserCircle, PawPrint, Layers
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Posts from './pages/Posts'
import Schedule from './pages/Schedule'
import Analytics from './pages/Analytics'
import SettingsPage from './pages/Settings'
import SvgEditor from './pages/SvgEditor'
import PlatformsPage from './pages/Platforms'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/posts', label: '发帖管理', icon: Send },
  { path: '/schedule', label: '定时任务', icon: CalendarClock },
  { path: '/analytics', label: '数据分析', icon: BarChart3 },
  { path: '/platforms', label: '平台健康', icon: Layers },
  { path: '/svg-editor', label: 'SVG 工作台', icon: Code2 },
  { path: '/settings', label: '设置', icon: Settings },
]

function Sidebar() {
  return (
    <aside className="w-64 h-screen bg-zeno-card border-r border-zeno-border flex flex-col fixed left-0 top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-zeno-border">
        <PawPrint className="w-8 h-8 text-zeno-accent" />
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">ZenoClaw</h1>
          <p className="text-xs text-zeno-text">v0.1.0</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-brand-600/20 text-zeno-accent font-medium'
                  : 'text-zeno-text hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Icon className="w-5 h-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-zeno-border space-y-2">
        <div className="flex items-center gap-2 text-xs text-zeno-text">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>API Server 运行中</span>
        </div>
        <a
          href="https://zeno.babiku.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-zeno-text/50 hover:text-zeno-text transition-colors"
        >
          <PawPrint className="w-3 h-3" />
          <span>Zeno Ecosystem</span>
          <span className="text-[10px]">·</span>
          <span>zeno.babiku.xyz</span>
        </a>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <div className="flex min-h-screen bg-zeno-dark">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/posts" element={<Posts />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/platforms" element={<PlatformsPage />} />
          <Route path="/svg-editor" element={<SvgEditor />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
