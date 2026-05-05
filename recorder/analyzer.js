/**
 * 行为分析器 — 从原始事件提取统计参数
 *
 * 输入: 浏览器端采集的事件数组
 * 输出: 行为特征 JSON（用于替换硬编码的 randomDelay 等参数）
 */

// ── 统计工具 ──

function mean(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function std(arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.floor(sorted.length * p)
  return sorted[Math.min(idx, sorted.length - 1)]
}

function distribution(arr) {
  if (!arr.length) return { mean: 0, std: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0, p95: 0, count: 0 }
  const sorted = [...arr].sort((a, b) => a - b)
  return {
    mean: Math.round(mean(arr)),
    std: Math.round(std(arr)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: Math.round(percentile(sorted, 0.25)),
    p50: Math.round(percentile(sorted, 0.50)),
    p75: Math.round(percentile(sorted, 0.75)),
    p95: Math.round(percentile(sorted, 0.95)),
    count: arr.length
  }
}

// ── 鼠标移动分析 ──

function analyzeMouseMovement(events) {
  const moves = events.filter(e => e.type === 'mm')
  if (moves.length < 2) return null

  const speeds = []       // px/s
  const accelerations = [] // px/s²
  let prevSpeed = 0

  for (let i = 1; i < moves.length; i++) {
    const dt = (moves[i].t - moves[i - 1].t) / 1000 // 秒
    if (dt <= 0) continue
    const dx = moves[i].x - moves[i - 1].x
    const dy = moves[i].y - moves[i - 1].y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const speed = dist / dt

    // 过滤极端值（鼠标跳跃，如切窗口）
    if (speed < 10000) {
      speeds.push(Math.round(speed))
      if (prevSpeed > 0) {
        accelerations.push(Math.round((speed - prevSpeed) / dt))
      }
      prevSpeed = speed
    }
  }

  return {
    speed: distribution(speeds),
    acceleration: distribution(accelerations),
    totalPoints: moves.length
  }
}

// ── 鼠标轨迹曲线分析（点击间的路径）──

function analyzeMouseTrajectories(events) {
  // 提取从一次点击到下一次点击之间的鼠标移动路径
  const trajectories = []
  let currentPath = []

  for (const e of events) {
    if (e.type === 'mm') {
      currentPath.push({ x: e.x, y: e.y, t: e.t })
    } else if (e.type === 'md') {
      if (currentPath.length > 5) {
        // 计算路径的弯曲度: 实际距离 / 直线距离
        const start = currentPath[0]
        const end = currentPath[currentPath.length - 1]
        const straightDist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2)
        if (straightDist > 50) {  // 忽略太短的移动
          let actualDist = 0
          for (let i = 1; i < currentPath.length; i++) {
            const dx = currentPath[i].x - currentPath[i - 1].x
            const dy = currentPath[i].y - currentPath[i - 1].y
            actualDist += Math.sqrt(dx * dx + dy * dy)
          }
          const curvature = actualDist / straightDist  // 1.0=直线，>1越弯
          const duration = currentPath[currentPath.length - 1].t - currentPath[0].t
          trajectories.push({
            points: currentPath.length,
            straightDist: Math.round(straightDist),
            actualDist: Math.round(actualDist),
            curvature: Math.round(curvature * 1000) / 1000,
            durationMs: duration
          })
        }
      }
      currentPath = []
    }
  }

  if (!trajectories.length) return null

  return {
    curvature: distribution(trajectories.map(t => t.curvature * 100)),  // 百分比
    duration: distribution(trajectories.map(t => t.durationMs)),
    count: trajectories.length
  }
}

// ── 点击分析 ──

function analyzeClicks(events) {
  const downs = events.filter(e => e.type === 'md')
  const ups = events.filter(e => e.type === 'mu')

  // 点击按住时长（md → mu 配对）
  const holdDurations = []
  for (const down of downs) {
    const matchingUp = ups.find(u => u.t > down.t && u.t - down.t < 2000 && u.btn === down.btn)
    if (matchingUp) {
      holdDurations.push(matchingUp.t - down.t)
    }
  }

  // 连续点击间隔
  const clickIntervals = []
  for (let i = 1; i < downs.length; i++) {
    const gap = downs[i].t - downs[i - 1].t
    if (gap > 50 && gap < 30000) {  // 50ms ~ 30s
      clickIntervals.push(gap)
    }
  }

  return {
    holdDuration: distribution(holdDurations),
    clickInterval: distribution(clickIntervals),
    totalClicks: downs.length
  }
}

// ── 打字分析 ──

function analyzeTyping(events) {
  const keydowns = events.filter(e => e.type === 'kd')
  if (keydowns.length < 2) return null

  // 字符键间隔（只看 char 类型，排除功能键）
  const charKeys = keydowns.filter(e => e.cat === 'char')
  const charIntervals = []
  for (let i = 1; i < charKeys.length; i++) {
    const gap = charKeys[i].t - charKeys[i - 1].t
    if (gap > 10 && gap < 5000) {  // 10ms ~ 5s
      charIntervals.push(gap)
    }
  }

  // 打字中的长停顿（>1s）
  const longPauses = charIntervals.filter(g => g > 1000)
  const shortIntervals = charIntervals.filter(g => g <= 1000)

  // 退格频率
  const backspaceCount = keydowns.filter(e => e.cat === 'backspace').length
  const backspaceRate = charKeys.length > 0 ? backspaceCount / charKeys.length : 0

  // Enter 频率
  const enterCount = keydowns.filter(e => e.cat === 'enter').length

  return {
    charInterval: distribution(shortIntervals),
    longPause: distribution(longPauses),
    longPauseProb: charIntervals.length > 0
      ? Math.round(longPauses.length / charIntervals.length * 1000) / 1000
      : 0,
    backspaceRate: Math.round(backspaceRate * 1000) / 1000,
    enterCount,
    totalKeystrokes: keydowns.length,
    totalCharKeys: charKeys.length
  }
}

// ── 滚动分析 ──

function analyzeScrolling(events) {
  const wheels = events.filter(e => e.type === 'wh')
  if (wheels.length < 2) return null

  // 滚动量
  const scrollAmounts = wheels.map(e => Math.abs(e.dy))

  // 滚动间隔
  const scrollIntervals = []
  for (let i = 1; i < wheels.length; i++) {
    const gap = wheels[i].t - wheels[i - 1].t
    if (gap > 10 && gap < 10000) {
      scrollIntervals.push(gap)
    }
  }

  // 连续滚动段（间隔 <200ms 的算一段）
  let burstCount = 1
  let burstSizes = []
  let currentBurst = 1
  for (let i = 1; i < wheels.length; i++) {
    if (wheels[i].t - wheels[i - 1].t < 200) {
      currentBurst++
    } else {
      burstSizes.push(currentBurst)
      currentBurst = 1
      burstCount++
    }
  }
  burstSizes.push(currentBurst)

  return {
    amount: distribution(scrollAmounts),
    interval: distribution(scrollIntervals),
    burstSize: distribution(burstSizes),
    totalScrolls: wheels.length
  }
}

// ── 空闲时间分析 ──

function analyzeIdle(events) {
  if (events.length < 2) return null

  const gaps = []
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].t - events[i - 1].t
    if (gap > 500) {  // 只看 >500ms 的停顿
      gaps.push(gap)
    }
  }

  const shortIdle = gaps.filter(g => g <= 3000)   // 0.5-3s: 微停顿
  const mediumIdle = gaps.filter(g => g > 3000 && g <= 10000)  // 3-10s: 思考
  const longIdle = gaps.filter(g => g > 10000)    // >10s: 阅读/走神

  return {
    short: distribution(shortIdle),
    medium: distribution(mediumIdle),
    long: distribution(longIdle),
    totalPauses: gaps.length
  }
}

// ── 主分析入口 ──

export function analyzeBehavior(events) {
  const totalDuration = events.length > 0
    ? events[events.length - 1].t - events[0].t
    : 0

  return {
    meta: {
      totalEvents: events.length,
      durationMs: totalDuration,
      durationMin: Math.round(totalDuration / 60000 * 10) / 10,
      recordedAt: new Date().toISOString()
    },
    mouse: analyzeMouseMovement(events),
    trajectory: analyzeMouseTrajectories(events),
    click: analyzeClicks(events),
    typing: analyzeTyping(events),
    scroll: analyzeScrolling(events),
    idle: analyzeIdle(events)
  }
}

/**
 * 从完整分析结果中提取精简的配置参数
 * 可直接替换 zenoclaw.config.yaml 中的 timing/keyboard/mouse 参数
 */
export function extractConfigParams(profile) {
  const params = {}

  // 打字参数
  if (profile.typing) {
    const t = profile.typing
    params.keyboard = {
      delay_min: t.charInterval.p25 || 80,
      delay_max: t.charInterval.p75 || 200,
      delay_mean: t.charInterval.mean || 120,
      delay_std: t.charInterval.std || 40,
      long_pause_min: t.longPause.p25 || 1200,
      long_pause_max: t.longPause.p75 || 3000,
      long_pause_prob: t.longPauseProb || 0.03,
      backspace_rate: t.backspaceRate || 0.02
    }
  }

  // 鼠标参数
  if (profile.mouse) {
    params.mouse = {
      speed_mean: profile.mouse.speed.mean || 800,
      speed_std: profile.mouse.speed.std || 300
    }
  }

  // 轨迹曲线参数
  if (profile.trajectory) {
    params.mouse = params.mouse || {}
    params.mouse.curvature_mean = (profile.trajectory.curvature.mean || 110) / 100
    params.mouse.curvature_std = (profile.trajectory.curvature.std || 8) / 100
    params.mouse.move_duration_mean = profile.trajectory.duration.mean || 400
    params.mouse.move_duration_std = profile.trajectory.duration.std || 200
  }

  // 点击参数
  if (profile.click) {
    params.mouse = params.mouse || {}
    params.mouse.click_hold_mean = profile.click.holdDuration.mean || 80
    params.mouse.click_hold_std = profile.click.holdDuration.std || 25
    params.mouse.click_wait_min = profile.click.holdDuration.p25 || 50
    params.mouse.click_wait_max = profile.click.holdDuration.p75 || 150
  }

  // 滚动参数
  if (profile.scroll) {
    params.scroll = {
      amount_mean: profile.scroll.amount.mean || 300,
      amount_std: profile.scroll.amount.std || 150,
      interval_mean: profile.scroll.interval.mean || 800,
      interval_std: profile.scroll.interval.std || 400
    }
  }

  // 操作间隔参数
  if (profile.idle) {
    params.timing = {
      action_delay_min: profile.idle.short.p25 || 1000,
      action_delay_max: profile.idle.short.p75 || 5000,
      think_delay_min: profile.idle.medium.p25 || 3000,
      think_delay_max: profile.idle.medium.p75 || 8000,
      read_delay_min: profile.idle.long.p25 || 10000,
      read_delay_max: profile.idle.long.p75 || 25000
    }
  }

  return params
}
