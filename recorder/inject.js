/**
 * 行为录制器 — 浏览器端注入脚本
 *
 * 通过 CDP Runtime.evaluate 注入到页面中
 * 采集: 鼠标移动、点击、键盘、滚动
 * 不关心页面内容，只采集行为特征
 *
 * 导出为字符串，供 record-behavior.js 注入
 */

export const INJECT_SCRIPT = `
(function() {
  // 防止重复注入
  if (window.__zenoBR) return;

  const events = [];
  const startTime = Date.now();
  function ts() { return Date.now() - startTime; }

  // ── 鼠标移动（节流到 ~60fps）──
  let lastMoveTs = 0;
  document.addEventListener('mousemove', function(e) {
    var now = ts();
    if (now - lastMoveTs < 16) return;
    lastMoveTs = now;
    events.push({ t: now, type: 'mm', x: e.clientX, y: e.clientY });
  }, true);

  // ── 鼠标按下/释放 ──
  document.addEventListener('mousedown', function(e) {
    events.push({ t: ts(), type: 'md', x: e.clientX, y: e.clientY, btn: e.button });
  }, true);
  document.addEventListener('mouseup', function(e) {
    events.push({ t: ts(), type: 'mu', x: e.clientX, y: e.clientY, btn: e.button });
  }, true);

  // ── 键盘按下/释放 ──
  document.addEventListener('keydown', function(e) {
    // 只记录 key 类型，不记录具体内容（隐私）
    var cat = 'other';
    if (e.key.length === 1) cat = 'char';
    else if (e.key === 'Backspace') cat = 'backspace';
    else if (e.key === 'Enter') cat = 'enter';
    else if (e.key === 'Space' || e.key === ' ') cat = 'space';
    else if (e.key.startsWith('Arrow')) cat = 'arrow';
    events.push({ t: ts(), type: 'kd', cat: cat });
  }, true);
  document.addEventListener('keyup', function(e) {
    events.push({ t: ts(), type: 'ku' });
  }, true);

  // ── 滚轮 ──
  document.addEventListener('wheel', function(e) {
    events.push({ t: ts(), type: 'wh', dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) });
  }, true);

  // ── 触摸（移动端备用）──
  document.addEventListener('scroll', function() {
    events.push({ t: ts(), type: 'sc' });
  }, true);

  // ── 暴露接口 ──
  window.__zenoBR = {
    getEvents: function() { return events; },
    count: function() { return events.length; },
    duration: function() { return ts(); },
    clear: function() { events.length = 0; },
    // 分块提取（避免超大数据一次性传输卡死）
    getChunk: function(start, size) {
      return events.slice(start, start + (size || 5000));
    }
  };

  // ── 可视标记：右下角浮动标签 ──
  var badge = document.createElement('div');
  badge.id = '__zenoBR_badge';
  badge.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:999999;'
    + 'background:rgba(220,38,38,0.9);color:#fff;padding:6px 14px;border-radius:20px;'
    + 'font:bold 13px/1.4 system-ui,sans-serif;pointer-events:none;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;gap:6px;';
  badge.innerHTML = '<span style="display:inline-block;width:8px;height:8px;'
    + 'background:#fff;border-radius:50%;animation:__zenoBR_pulse 1.5s infinite"></span>'
    + '<span id="__zenoBR_text">录制中 0</span>';
  var style = document.createElement('style');
  style.textContent = '@keyframes __zenoBR_pulse{0%,100%{opacity:1}50%{opacity:0.3}}';
  document.head.appendChild(style);
  document.body.appendChild(badge);

  // 每 2s 更新事件计数
  setInterval(function() {
    var el = document.getElementById('__zenoBR_text');
    if (el) el.textContent = '录制中 ' + events.length;
  }, 2000);

  console.log('[ZenoBR] 行为录制器已注入，开始采集...');
})();
`;
