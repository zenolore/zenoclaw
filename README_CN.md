# 🐾 ZenoClaw

[English](README.md) | **中文**

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Platforms](https://img.shields.io/badge/Platforms-19-orange.svg)](#支持平台)

**开源智能浏览器自动化引擎** — 自动发帖 · 数据追踪 · 智能互动 · 反机器人检测

> Powered by **Zeno** · [🌐 官网](https://zeno.babiku.xyz) · [📱 iOS App](#-zeno-app) · [💻 Mac App](#-zeno-app)

---

## ✨ 特性

- **19 个平台支持**：小红书 / 知乎 / 微博 / 抖音 / B站 / 微信公众号 / 百家号 / 搜狐号 / 大鱼号 / 网易号 / 企鹅号 / 今日头条 / X / Reddit / 即刻 / V2EX / 少数派 / Product Hunt / 视频号
- **连接已运行的 Chrome**：通过调试端口连接你正在使用的浏览器，在新标签页中操作，不影响已打开的页面
- **多层反检测**：详见下方 [反检测架构](#-反检测架构)
- **人类行为模拟**：ghost-cursor 贝塞尔曲线鼠标轨迹、高斯分布随机延迟、打错字→退格修正、中文 IME 输入法模拟、思考停顿、随机滚动
- **🆕 行为录制器**：录制你真实的鼠标轨迹、打字节奏、点击模式、滚动习惯，自动提取统计参数替换默认值；详见 [行为录制器](#-行为录制器)
- **🆕 实时状态浮窗**：发布过程中页面顶部居中显示平台任务标签、步骤计数器、当前/下一步操作预览，橙红渐变进行中 + 绿色脉冲完成状态；Shadow DOM 反检测设计
- **超长随机延迟**：单次发帖 30-60 分钟，每个步骤后模拟浏览 1-5 分钟，所有时间参数高斯分布
- **不影响使用**：通过 CDP 协议控制浏览器内部事件，不抢占物理鼠标和键盘
- **数据读取**：定时读取已发布帖子的阅读量、点赞、评论、收藏数据
- **全参数可配**：17 大类 115 个配置项，每一个延迟、概率、行为都可自定义
- **AI 视觉验证**：发布前截图，调用视觉模型（GLM-4V / GPT-4V）验证内容填写是否正确
- **失败重试**：发帖失败自动重试，可配置次数和间隔
- **定时执行**：cron 表达式灵活调度发帖和数据读取
- **REST API**：完整的 HTTP API，支持所有功能的远程调用
- **Web 管理面板**：基于 React + TailwindCSS 的现代化暗色 UI
- **SVG 海报工作台**：粘贴 SVG 代码实时预览、调整尺寸比例、下载 PNG/JPG、直接发布
- **插件系统**：ContentProvider / CaptchaSolver / AnalyticsEngine / Notifier 四大可插拔接口
- **SDK + CLI**：Node.js SDK 和命令行工具，方便集成和脚本化

## 架构

```
┌─────────────────────────────────────────────┐
│                 Web UI (React)              │  ← 管理面板
├─────────────────────────────────────────────┤
│              REST API (Express)             │  ← 7 个端点组
├──────────┬──────────┬──────────┬────────────┤
│ Content  │ Captcha  │Analytics │  Notifier  │  ← 插件层
│ Provider │ Solver   │ Engine   │            │
├──────────┴──────────┴──────────┴────────────┤
│              Core Engine                    │  ← 浏览器 + 人类行为模拟
├─────────────────────────────────────────────┤
│      Platform Adapters (19 platforms)      │  ← 小红书/知乎/微信/微博/百家号/搜狐/网易/企鹅/大鱼...
└─────────────────────────────────────────────┘
```

## 快速开始

### 1. 安装

```bash
git clone https://github.com/zenolore/zenoclaw.git
cd zenoclaw
npm install

# Web UI（可选）
cd web && npm install && cd ..
```

### 2. 初始化

```bash
npm run setup                   # 创建 data 目录、示例配置文件、示例帖子数据
```

### 3. 配置

```bash
# 如果 setup 已自动复制，直接编辑即可；否则手动复制
cp zenoclaw.config.example.yaml zenoclaw.config.yaml
```

编辑 `zenoclaw.config.yaml`，**必填**：`browser.chrome_user_data`。

查找方法：Chrome 地址栏输入 `chrome://version`，找到「个人资料路径」，取其父目录。

### 4. 运行

```bash
# ─── 核心引擎（命令行模式） ───
npm start                         # 启动定时调度
npm run post:xhs                  # 立即发一条小红书
npm run read:xhs                  # 读取帖子数据

# ─── API 服务 ───
npm run api                       # 启动 REST API（端口 3200）

# ─── Web 管理面板 ───
npm run web                       # 启动 Web UI（端口 5173）

# ─── CLI ───
npm run cli -- help               # 命令行工具帮助
npm run cli -- publish --platform xiaohongshu --title "标题"
```

## API 端点

> 📖 完整的请求/响应格式、SDK 方法和代码示例，请参阅 **[接口参考文档 (中文)](API_REFERENCE_CN.md)** | **[API Reference (English)](API_REFERENCE.md)**

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/publish` | 提交发帖任务 |
| `GET` | `/api/publish` | 获取任务列表 |
| `GET` | `/api/publish/:taskId` | 获取单个任务状态 |
| `GET` | `/api/stats` | 获取数据概览 |
| `GET` | `/api/stats/:postId` | 获取单篇帖子统计快照 |
| `POST` | `/api/stats/collect` | 手动触发数据采集 |
| `GET` | `/api/analytics` | 综合分析报告 |
| `GET` | `/api/analytics/trends` | 趋势数据 |
| `GET` | `/api/analytics/best-time` | 最佳发帖时间 |
| `POST` | `/api/interact` | 执行互动操作 |
| `GET` | `/api/interact/history` | 获取互动历史 |
| `POST` | `/api/browse` | 浏览/养号任务 |
| `GET` | `/api/browse/history` | 获取浏览历史 |
| `GET` | `/api/browse/active` | 获取当前活跃浏览任务 |
| `POST` | `/api/account/login` | 自动登录 |
| `GET` | `/api/account` | 获取账号列表 |
| `POST` | `/api/account` | 添加/更新账号 |
| `DELETE` | `/api/account/:id` | 删除账号 |
| `GET` | `/api/schedule` | 获取定时任务 |
| `POST` | `/api/schedule` | 创建定时任务 |
| `PATCH` | `/api/schedule/:id` | 启用/禁用/修改定时任务 |
| `DELETE` | `/api/schedule/:id` | 删除定时任务 |
| `GET` | `/api/platforms` | 获取支持平台列表 |
| `GET` | `/api/platforms/health` | 平台健康矩阵 |
| `GET` | `/api/config` | 服务配置（只读） |
| `GET` | `/api/health` | 健康检查 + API Key 验证 |

所有端点支持 API Key 鉴权（`X-API-Key` 请求头）和频率限制。

## SDK 使用

```javascript
import { ZenoClaw } from 'zenoclaw/sdk'

const client = new ZenoClaw({ apiUrl: 'http://localhost:3200', apiKey: 'your-key' })

// 发帖
await client.publish({ platform: 'xiaohongshu', title: '标题', content: '正文' })

// 查看数据
const stats = await client.getAllStats({ platform: 'xiaohongshu' })

// 数据分析
const report = await client.getAnalytics({ period: '7d' })

// 创建定时任务
await client.createSchedule({ platform: 'xiaohongshu', cron_expression: '0 8 * * *', type: 'publish' })
```

## 插件系统

ZenoClaw 提供 4 个可插拔接口，用户可自定义实现：

| 接口 | 默认实现 | 说明 |
|------|----------|------|
| `ContentProvider` | JSON 文件读取 | 内容生成（标题/正文/标签/回复） |
| `CaptchaSolver` | 手动处理 | 验证码识别与解决 |
| `AnalyticsEngine` | 基础统计 | 数据分析与洞察 |
| `Notifier` | 控制台输出 | 任务状态通知（支持 Webhook） |

## 项目结构

```
zenoclaw/
├── zenoclaw.config.example.yaml  # 配置模板
├── package.json
├── core/                         # 核心引擎
│   ├── index.js                  #   入口
│   ├── config.js                 #   配置单例
│   ├── browser.js                #   浏览器连接 + 互斥锁 + 反检测
│   ├── human.js                  #   人类行为模拟
│   ├── scheduler.js              #   定时调度 + 重试
│   ├── logger.js                 #   日志
│   ├── safe-json.js              #   并发安全 JSON 读写
│   ├── crypto.js                 #   AES-256-GCM 加密
│   └── store.js                  #   内存+文件持久化存储
├── platforms/                    # 平台适配器（19 个）
│   ├── base.js                   #   适配器基类（findSelector/findByText/clickByText）
│   ├── loader.js                 #   动态平台加载器 + getPlatformMeta
│   ├── xiaohongshu/              #   小红书（图文笔记）
│   ├── zhihu/                    #   知乎（专栏文章）
│   ├── weibo/                    #   微博
│   ├── douyin/                   #   抖音
│   ├── bilibili/                 #   B站
│   ├── wechat/                   #   微信公众号
│   ├── baijiahao/                #   百家号
│   ├── sohu/                     #   搜狐号
│   ├── dayu/                     #   大鱼号
│   ├── netease/                  #   网易号
│   ├── qq/                       #   企鹅号
│   ├── toutiao/                  #   今日头条
│   ├── x/                        #   X / Twitter
│   ├── reddit/                   #   Reddit
│   ├── jike/                     #   即刻
│   ├── v2ex/                     #   V2EX
│   ├── sspai/                    #   少数派
│   ├── producthunt/              #   Product Hunt
│   └── channels/                 #   视频号
├── plugins/                      # 插件系统
│   ├── manager.js                #   插件管理器
│   ├── content-provider/         #   内容生成接口
│   ├── captcha-solver/           #   验证码接口
│   ├── analytics-engine/         #   分析接口
│   └── notifier/                 #   通知接口
├── api/                          # REST API
│   ├── server.js                 #   Express 服务
│   ├── middleware/                #   鉴权 + 限流
│   └── routes/                   #   7 个路由模块
├── recorder/                     # 行为录制器
│   ├── inject.js                 #   浏览器注入脚本
│   ├── analyzer.js               #   统计分析
│   └── record-behavior.js        #   CLI 入口
├── sdk/                          # Node.js SDK
├── cli/                          # 命令行工具
├── web/                          # Web 管理面板 (React)
│   ├── src/pages/                #   6 个页面（含 SVG 海报工作台）
│   └── src/lib/api.js            #   API 客户端
├── content/                      # 帖子模板
│   └── posts.example.json        #   帖子示例
└── data/                         # 运行数据 (gitignored)
```

## 🛡 反检测架构

在同类开源工具中，ZenoClaw 的反检测设计覆盖了从浏览器指纹到行为模式的多个层面。以下是各层技术实现，所有代码均可在仓库中验证：

| 层级 | 技术 | 实现位置 | 说明 |
|------|------|----------|------|
| **浏览器指纹** | puppeteer-extra-plugin-stealth | `core/browser.js` | 覆盖 navigator/WebGL/canvas 等 20+ 检测点 |
| **视口指纹** | 高斯随机视口尺寸 | `core/browser.js` | 每次启动随机分辨率，避免固定特征 |
| **WebRTC** | 完全禁用 RTCPeerConnection | `core/browser.js` | 防止真实 IP 泄露 |
| **鼠标轨迹** | ghost-cursor 贝塞尔曲线 | `core/human.js` | 非直线移动，模拟真人手部运动 |
| **键盘节奏** | 高斯分布延迟 + 打错字 | `core/human.js` | 每个字符间隔不同，偶尔打错再退格 |
| **中文输入** | IME composition 事件模拟 | `core/ime-simulator.js` | 模拟拼音输入法的选词过程 |
| **行为节奏** | 操作间随机浏览 1-5 分钟 | `core/human.js` | 模拟真人「填完一项，看看页面」的习惯 |
| **时间特征** | 单次发帖 30-60 分钟 | `config: timing.*` | 避免秒级完成的机器人特征 |
| **CDP 协议** | 不使用物理鼠标/键盘 | `core/human.js` | 浏览器内部事件，操作系统层无痕迹 |
| **行为录制** | 真实用户行为建模 | `recorder/` | 录制你真实的鼠标/键盘/滚动模式，用你的个人高斯分布替换默认参数 |
| **状态浮窗** | 封闭 Shadow DOM + 随机属性 | `core/status-overlay.js` | 实时步骤指示器，页面 JS 不可见，发布完自动移除 |

> **设计原则**：没有任何单一技术能保证不被检测。ZenoClaw 的策略是多层叠加，使整体行为模式在统计上接近真人。配置项暴露了所有参数，用户可以根据实际平台的检测强度调整。

## 🎤 行为录制器

ZenoClaw 内置行为录制器，采集你真实的交互习惯，生成更像真人的自动化操作。不再依赖硬编码随机延迟，而是使用**你个人的**鼠标速度、打字节奏、点击模式和滚动习惯。

### 工作原理

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
│ 1. 录制   │ ──▶ │ 2. 分析   │ ──▶ │ 3. 行为特征    │ ──▶ │ 4. 自动应用│
│ (浏览器)  │     │ (统计)   │     │ (JSON 文件)  │     │ (透明接入)│
└──────────┘     └──────────┘     └──────────────┘     └──────────┘
```

1. **录制** — 在浏览器中注入录制器，正常浏览 5–15 分钟
2. **分析** — 从原始事件提取统计分布（均值、标准差、百分位）
3. **行为特征** — 保存到 `data/behavior-profile.json`
4. **自动应用** — 下次运行时自动加载，所有时间参数使用你的录制数据

### 使用步骤

#### 1. 启动 Chrome 调试端口

```bash
# Windows
chrome.exe --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

#### 2. 启动录制器

```bash
node recorder/record-behavior.js
```

录制器会：
- 通过 9222 端口连接 Chrome
- 向所有已打开的标签页注入录制脚本
- 在每个已注入页面的**右下角**显示红色闪烁的 **“🔴 录制中”** 标记
- 标记上实时显示事件计数

#### 3. 正常操作

浏览、点击、打字、滚动 — 像平时一样操作即可。**不需要在特定网站上操作**，行为特征可以跨网站通用。

建议最低录制时间：
- **5 分钟**：基本特征（鼠标 + 点击）
- **10–15 分钟**：完整特征（含打字节奏和滚动）
- 至少在任意输入框中打 50–100 个字符

#### 4. 停止录制并提取

在终端按 **Enter** 停止，或使用紧急提取工具：

```bash
node recorder/extract-now.js
```

输出示例：
```
共 4236 个事件

💾 已保存: data/behavior-profile.json

⌨️  打字: 375ms ± 225ms, 642 次击键
🖱️  鼠标速度: 1043 px/s ± 1546
👆 点击按住: 109ms, 共 28 次
📜 滚动: 106px, 共 118 次
⏸️  微停顿: 983ms (120次), 思考: 4534ms (3次)
```

#### 5. 自动生效

**无需额外配置。** 下次启动时引擎自动加载 `data/behavior-profile.json`。

优先级：**用户 YAML 配置** > **录制行为特征** > **硬编码默认值**

例如：如果你没在 YAML 中设置 `keyboard.delay_min`，引擎会使用你的录制值（如 181ms）而不是默认值（100ms）。

### 录制内容

| 类别 | 参数 | 示例值 |
|------|------|-------|
| **打字** | delay_min/max/mean/std, long_pause_prob, backspace_rate | 181ms–548ms, 均值 375ms |
| **鼠标** | speed_mean/std, curvature, click_hold_mean/std | 1043 px/s ± 1546 |
| **滚动** | amount_mean/std, interval_mean/std | 106px ± 35 |
| **时间** | action_delay, think_delay, read_delay | 623ms–1183ms |

### 隐私保护

录制器**不会采集**你输入的实际内容、访问的 URL 或页面内容。只记录：
- 事件类型和时间戳
- 鼠标坐标
- 按键类别（`char`、`backspace`、`enter`、`space`、`arrow`、`other`）
- 滚动距离

## 注意事项

1. **浏览器连接**：程序通过调试端口连接 Chrome，首次需启动带 `--remote-debugging-port=9222` 的 Chrome，或让程序自动启动。
2. **登录态**：Cookie 有有效期，过期后需手动重新登录。
3. **页面改版**：平台 UI 更新后，需更新 `platforms/*/selectors.js`。
4. **频率控制**：建议每天每平台不超过 2-3 条，间隔 4 小时以上。
5. **反检测不是万能的**：各平台的检测策略在持续演进，没有工具能承诺 100% 不被检测。合理的使用频率是最好的防护。

## 免责声明

本项目仅供学习研究和个人合法使用。

- 使用者应遵守目标平台的服务条款（ToS）和当地法律法规
- 自动化操作可能违反某些平台的 ToS，使用者需自行评估风险
- 因使用本工具产生的一切后果（包括但不限于账号封禁、法律责任）由使用者自行承担
- 本项目作者不对任何直接或间接损失负责
- 本项目不鼓励也不支持任何形式的垃圾信息发布或网络骚扰行为

## � Zeno 生态

ZenoClaw 是完全独立可用的开源工具。同时，它也是 Zeno 生态的一部分 — 如果你需要 AI 内容生成能力，可以搭配使用：

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Zeno App      │     │   ZenoClaw      │     │   19 个平台     │
│   AI 生成文案    │ ──▶ │   SVG 工作台     │ ──▶ │   自动发布      │
│   + SVG 海报    │     │   预览 & 调整    │     │   数据追踪      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- 🌐 **[zeno.babiku.xyz](https://zeno.babiku.xyz)** — Zeno 官网
- 📱 **Zeno iOS** — 6 个 AI Agent · AI 键盘 · 知识库 · 长期记忆
- 💻 **Zeno Mac** — AI 工作台 · 18+ 模型 · 本地模型 · 模板系统

> ZenoClaw 不依赖 Zeno App，你可以用任何方式准备内容，ZenoClaw 负责自动化发布。

<!-- TODO: App Store 上架后替换真实链接 -->
<!-- [📱 下载 iOS App](https://apps.apple.com/app/zeno/id...) -->
<!-- [💻 下载 Mac App](https://apps.apple.com/app/zeno/id...) -->

## ⭐ Star History

如果这个项目对你有帮助，请给一个 Star ⭐

## License

[MIT](LICENSE)
