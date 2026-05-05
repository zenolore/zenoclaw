# ZenoClaw 接口参考文档

[English](API_REFERENCE.md) | **中文**

> ZenoClaw 开源智能浏览器自动化引擎 — 完整 REST API 接口参考

---

## 目录

- [概述](#概述)
- [鉴权](#鉴权)
- [错误处理](#错误处理)
- [接口列表](#接口列表)
  - [健康检查](#健康检查)
  - [配置查看](#配置查看)
  - [内容发布](#内容发布)
  - [数据采集](#数据采集)
  - [数据分析](#数据分析)
  - [社交互动](#社交互动)
  - [浏览养号](#浏览养号)
  - [账号管理](#账号管理)
  - [定时任务](#定时任务)
  - [平台管理](#平台管理)
- [SDK 参考](#sdk-参考)
- [CLI 参考](#cli-参考)
- [限流策略](#限流策略)
- [支持平台](#支持平台)
- [插件接口](#插件接口)

---

## 概述

| 属性 | 值 |
|------|---|
| **基础地址** | `http://localhost:3200` |
| **协议** | HTTP / HTTPS |
| **数据格式** | `application/json` |
| **鉴权方式** | API Key（`X-API-Key` 请求头） |
| **默认限流** | 60 次/分钟（可配置） |

```
┌─────────────────────────────────────────────────────┐
│              客户端 (SDK / CLI / cURL / Web)          │
├─────────────────────────────────────────────────────┤
│              REST API  (Express, 端口 3200)           │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬────┤
│ 发布 │ 数据 │ 分析 │ 互动 │ 浏览 │ 账号 │ 定时 │平台│
├──────┴──────┴──────┴──────┴──────┴──────┴──────┴────┤
│         核心引擎  +  19 个平台适配器                    │
└─────────────────────────────────────────────────────┘
```

---

## 鉴权

当 `api.auth_enabled` 为 `true`（默认开启）时，所有 `/api/*` 接口（`/api/health` 除外）均需携带 API Key。

```bash
curl -H "X-API-Key: 你的密钥" http://localhost:3200/api/publish
```

| 请求头 | 必填 | 说明 |
|--------|------|------|
| `X-API-Key` | 是 | 在 `zenoclaw.config.yaml` → `api.key` 中配置 |

**异常响应：**

| 状态码 | 含义 |
|--------|------|
| `401` | 缺少 API Key |
| `403` | API Key 无效 |
| `429` | 超出限流 |

---

## 错误处理

所有错误响应遵循统一格式：

```json
{
  "error": "ErrorType",
  "message": "人类可读的错误描述"
}
```

| HTTP 状态码 | 含义 |
|-------------|------|
| `200` | 请求成功 |
| `202` | 任务已接受（异步执行） |
| `400` | 参数缺失或无效 |
| `401` | 未授权 |
| `403` | 禁止访问 |
| `404` | 资源不存在 |
| `429` | 请求过于频繁 |
| `500` | 服务器内部错误 |

---

## 接口列表

### 健康检查

#### `GET /api/health`

检查 API 服务状态，验证 API Key 是否有效。

**请求示例：**
```bash
curl -H "X-API-Key: 你的密钥" http://localhost:3200/api/health
```

**响应 (200)：**
```json
{
  "status": "ok",
  "auth": "valid"
}
```

---

### 配置查看

#### `GET /api/config`

获取当前服务配置（只读，不暴露敏感信息）。

**响应 (200)：**
```json
{
  "api": {
    "port": 3200,
    "cors_origin": "*",
    "rate_limit_max": 60,
    "auth_enabled": true
  },
  "plugins": {
    "notifier": "console",
    "captcha_solver": "manual"
  },
  "vision": {
    "enabled": false,
    "has_key": true,
    "key_source": "env",
    "base_url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "model": "glm-4v-flash",
    "timeout": 30000
  },
  "data_dir": "./data/stats"
}
```

---

### 内容发布

#### `POST /api/publish`

提交内容发布任务。异步执行，立即返回任务 ID。

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `string` | ✅ | 目标平台（`xiaohongshu`、`zhihu`、`weibo`、`douyin` 等） |
| `title` | `string` | | 帖子标题 |
| `content` | `string` | | 帖子正文 |
| `images` | `string[]` | | 图片绝对路径数组 |
| `tags` | `string[]` | | 话题标签数组 |
| `schedule_at` | `string` | | ISO 8601 定时执行时间 |
| `contentType` | `string` | | 内容类型：`"article"` 或 `"video"` |
| `videoPath` | `string` | | 视频文件绝对路径（视频模式） |
| `coverPath` | `string` | | 封面图绝对路径 |
| `description` | `string` | | 视频描述 |
| `declareType` | `string` | | 内容声明：`"original"`、`"ai"` |
| `dryRun` | `boolean` | | `true` = 仅填写内容，不点击发布 |
| `options` | `object` | | 平台特定选项 |

**请求示例：**
```bash
curl -X POST http://localhost:3200/api/publish \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 你的密钥" \
  -d '{
    "platform": "xiaohongshu",
    "title": "我的帖子标题",
    "content": "帖子正文内容...",
    "images": ["/path/to/image1.jpg", "/path/to/image2.jpg"],
    "tags": ["科技", "教程"]
  }'
```

**响应 (202)：**
```json
{
  "task_id": "task_a1b2c3d4",
  "status": "pending",
  "message": "任务已创建，正在排队执行"
}
```

#### `GET /api/publish`

获取所有发布任务列表。

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `platform` | `string` | 按平台过滤 |
| `status` | `string` | 按状态过滤（`pending`、`running`、`success`、`failed`） |

**响应 (200)：**
```json
{
  "tasks": [
    {
      "task_id": "task_a1b2c3d4",
      "platform": "xiaohongshu",
      "title": "我的帖子标题",
      "status": "success",
      "created_at": "2026-05-05T12:00:00.000Z",
      "completed_at": "2026-05-05T12:35:00.000Z",
      "post_url": "https://www.xiaohongshu.com/explore/..."
    }
  ],
  "total": 1
}
```

#### `GET /api/publish/:taskId`

获取单个任务的状态和详情。

**响应 (200)：**
```json
{
  "task_id": "task_a1b2c3d4",
  "platform": "xiaohongshu",
  "title": "我的帖子标题",
  "status": "success",
  "created_at": "2026-05-05T12:00:00.000Z",
  "completed_at": "2026-05-05T12:35:00.000Z",
  "post_url": "https://www.xiaohongshu.com/explore/...",
  "result": { "success": true, "message": "发布成功" }
}
```

---

### 数据采集

#### `GET /api/stats`

获取所有已追踪帖子的数据概览。

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `platform` | `string` | 按平台过滤 |

**响应 (200)：**
```json
{
  "posts": [
    {
      "post_id": "post_001",
      "platform": "xiaohongshu",
      "title": "我的帖子标题",
      "views": 1234,
      "likes": 56,
      "comments": 12,
      "bookmarks": 8,
      "collected_at": "2026-05-05T14:00:00.000Z"
    }
  ],
  "total": 1
}
```

#### `GET /api/stats/:postId`

获取指定帖子的详细数据快照（含历史记录）。

**响应 (200)：**
```json
{
  "post_id": "post_001",
  "platform": "xiaohongshu",
  "title": "我的帖子标题",
  "history": [
    { "views": 500, "likes": 20, "comments": 5, "collected_at": "2026-05-04T14:00:00.000Z" },
    { "views": 1234, "likes": 56, "comments": 12, "collected_at": "2026-05-05T14:00:00.000Z" }
  ]
}
```

#### `POST /api/stats/collect`

手动触发数据采集。

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `string` | ✅ | 目标平台 |
| `post_url` | `string` | | 指定帖子 URL |

**响应 (202)：**
```json
{
  "task_id": "collect_e5f6g7h8",
  "status": "running",
  "message": "数据采集已启动"
}
```

---

### 数据分析

#### `GET /api/analytics`

生成综合数据分析报告。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `platform` | `string` | 全部 | 按平台过滤 |
| `period` | `string` | `7d` | 时间范围：`7d`、`30d`、`all` |

**响应 (200)：**
```json
{
  "period": "7d",
  "total_views": 15000,
  "total_likes": 320,
  "total_comments": 85,
  "top_posts": [...],
  "platform_breakdown": {...}
}
```

#### `GET /api/analytics/trends`

获取指标趋势数据。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `platform` | `string` | 全部 | 按平台过滤 |
| `metric` | `string` | `views` | 指标：`views`、`likes`、`comments`、`bookmarks` |
| `period` | `string` | `7d` | 时间范围 |

#### `GET /api/analytics/best-time`

基于历史互动数据推荐最佳发帖时间。

**响应 (200)：**
```json
{
  "recommended_times": [
    { "day": "Monday", "hour": 9, "score": 0.95 },
    { "day": "Wednesday", "hour": 20, "score": 0.88 }
  ]
}
```

---

### 社交互动

#### `POST /api/interact`

执行社交互动操作（点赞、评论、关注等）。

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `string` | ✅ | 目标平台 |
| `action` | `string` | ✅ | 操作类型：`like`、`collect`、`comment`、`reply`、`follow`、`share` |
| `target` | `object` | | 目标帖子/用户 `{ url: "..." }` |
| `content` | `string` | | 评论/回复内容 |

**请求示例：**
```bash
curl -X POST http://localhost:3200/api/interact \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 你的密钥" \
  -d '{
    "platform": "xiaohongshu",
    "action": "comment",
    "target": { "url": "https://www.xiaohongshu.com/explore/..." },
    "content": "写得真好，感谢分享！"
  }'
```

**响应 (202)：**
```json
{
  "task_id": "interact_i9j0k1l2",
  "status": "accepted",
  "message": "互动任务已接受: comment"
}
```

#### `GET /api/interact/history`

获取互动历史记录。

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `platform` | `string` | 按平台过滤 |
| `action` | `string` | 按操作类型过滤 |

---

### 浏览养号

#### `POST /api/browse`

启动浏览/养号任务，模拟真实用户行为。

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `string` | ✅ | 目标平台 |
| `action` | `string` | | `"nurture"`（默认） |
| `strategy` | `object` | | `{ duration_min, duration_max }` 浏览时长（秒） |

**请求示例：**
```bash
curl -X POST http://localhost:3200/api/browse \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 你的密钥" \
  -d '{
    "platform": "xiaohongshu",
    "action": "nurture",
    "strategy": { "duration_min": 1200, "duration_max": 1800 }
  }'
```

**响应 (202)：**
```json
{
  "task_id": "browse_m3n4o5p6",
  "status": "running",
  "message": "浏览任务已启动: nurture"
}
```

#### `GET /api/browse/history`

获取浏览历史记录。

#### `GET /api/browse/active`

获取当前活跃的浏览任务。

---

### 账号管理

#### `GET /api/account`

获取已保存的账号列表（密码已脱敏）。

**响应 (200)：**
```json
{
  "accounts": [
    {
      "id": "acc_q7r8s9t0",
      "platform": "xiaohongshu",
      "username": "user@example.com",
      "password": "********",
      "status": "active"
    }
  ],
  "total": 1
}
```

#### `POST /api/account`

添加或更新账号。密码使用 AES-256-GCM 加密存储。

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `string` | ✅ | 目标平台 |
| `username` | `string` | ✅ | 登录用户名/邮箱/手机号 |
| `password` | `string` | | 登录密码（加密存储） |
| `cookies` | `object` | | 预认证的 Cookie 数据 |

#### `POST /api/account/login`

触发指定平台的自动登录流程。

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `string` | ✅ | 目标平台 |
| `account_id` | `string` | | 指定账号 ID（不填则使用默认） |

#### `DELETE /api/account/:id`

按 ID 删除已保存的账号。

---

### 定时任务

#### `GET /api/schedule`

获取所有定时任务及运行状态。

**响应 (200)：**
```json
{
  "schedules": [
    {
      "id": "sch_u1v2w3x4",
      "name": "每日小红书发帖",
      "platform": "xiaohongshu",
      "type": "publish",
      "cron_expression": "0 9 * * *",
      "enabled": true,
      "is_running": false,
      "created_at": "2026-05-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

#### `POST /api/schedule`

创建定时任务。

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `string` | ✅ | 目标平台 |
| `type` | `string` | | 任务类型：`publish`、`stats`、`browse`、`interact` |
| `cron_expression` | `string` | ✅ | 标准 cron 表达式（如 `0 9 * * *`） |
| `name` | `string` | | 任务名称 |
| `payload` | `object` | | 任务参数 |

**请求示例：**
```bash
curl -X POST http://localhost:3200/api/schedule \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 你的密钥" \
  -d '{
    "platform": "xiaohongshu",
    "type": "publish",
    "cron_expression": "0 9 * * *",
    "name": "每日早间发帖"
  }'
```

#### `PATCH /api/schedule/:id`

启用、禁用或修改定时任务。

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | `boolean` | 启用/禁用 |
| `cron_expression` | `string` | 更新调度时间 |
| `name` | `string` | 更新名称 |

#### `DELETE /api/schedule/:id`

删除定时任务。

---

### 平台管理

#### `GET /api/platforms`

获取所有支持平台的列表及元信息。

**响应 (200)：**
```json
{
  "platforms": [
    {
      "name": "xiaohongshu",
      "label": "小红书",
      "has_publisher": true,
      "has_reader": true,
      "has_browser": true
    }
  ],
  "total": 19
}
```

#### `GET /api/platforms/health`

获取所有平台的详细健康矩阵：发布链路、数据链路、浏览链路、互动选择器覆盖。

**响应 (200)：**
```json
{
  "platforms": [
    {
      "name": "xiaohongshu",
      "label": "小红书",
      "publisher": { "exists": true, "runSteps": ["openPublishPage", "uploadImages", "inputTitle", "inputContent", "addTags", "declareOriginal", "publish"] },
      "reader": { "exists": true },
      "browser": { "exists": true },
      "interact": { "selectors": { "like": true, "comment_input": true, "comment_submit": true, "follow": true } }
    }
  ]
}
```

---

## SDK 参考

### 初始化

```javascript
import { ZenoClaw } from './sdk/index.js'

const client = new ZenoClaw({
  apiUrl: 'http://localhost:3200',
  apiKey: '你的密钥',
  timeout: 30000  // 可选，默认 30 秒
})
```

### 完整方法列表

| 模块 | 方法 | 对应接口 |
|------|------|---------|
| **发布** | `client.publish(params)` | `POST /api/publish` |
| | `client.getPublishTasks(query?)` | `GET /api/publish` |
| | `client.getPublishTask(taskId)` | `GET /api/publish/:taskId` |
| **数据采集** | `client.getStats(postId)` | `GET /api/stats/:postId` |
| | `client.getAllStats(query?)` | `GET /api/stats` |
| | `client.collectStats(params)` | `POST /api/stats/collect` |
| **数据分析** | `client.getAnalytics(query?)` | `GET /api/analytics` |
| | `client.getTrends(query?)` | `GET /api/analytics/trends` |
| | `client.getBestTime()` | `GET /api/analytics/best-time` |
| **社交互动** | `client.interact(params)` | `POST /api/interact` |
| | `client.getInteractHistory(query?)` | `GET /api/interact/history` |
| **浏览养号** | `client.browse(params)` | `POST /api/browse` |
| | `client.getBrowseHistory(query?)` | `GET /api/browse/history` |
| | `client.getActiveBrowseTasks()` | `GET /api/browse/active` |
| **账号管理** | `client.login(params)` | `POST /api/account/login` |
| | `client.getAccounts()` | `GET /api/account` |
| | `client.addAccount(params)` | `POST /api/account` |
| | `client.deleteAccount(id)` | `DELETE /api/account/:id` |
| **定时任务** | `client.getSchedules()` | `GET /api/schedule` |
| | `client.createSchedule(params)` | `POST /api/schedule` |
| | `client.updateSchedule(id, params)` | `PATCH /api/schedule/:id` |
| | `client.deleteSchedule(id)` | `DELETE /api/schedule/:id` |
| **平台** | `client.getPlatforms()` | `GET /api/platforms` |
| | `client.getPlatformsHealth()` | `GET /api/platforms/health` |
| **系统** | `client.health()` | `GET /api/health` |
| | `client.getConfig()` | `GET /api/config` |

### 快速示例

```javascript
// 发布帖子
const result = await client.publish({
  platform: 'xiaohongshu',
  title: '我的标题',
  content: '帖子正文内容...',
  images: ['/path/to/image.jpg'],
  tags: ['科技', '教程']
})
console.log(`任务已创建: ${result.task_id}`)

// 查询任务状态
const task = await client.getPublishTask(result.task_id)
console.log(`状态: ${task.status}`)

// 获取数据分析
const report = await client.getAnalytics({ period: '7d' })

// 创建定时发帖
await client.createSchedule({
  platform: 'zhihu',
  type: 'publish',
  cron_expression: '0 20 * * *',
  name: '每日晚间知乎发文'
})

// 浏览养号
await client.browse({
  platform: 'weibo',
  strategy: { duration_min: 1200, duration_max: 1800 }
})

// 检查平台健康状态
const health = await client.getPlatformsHealth()
```

---

## CLI 参考

```bash
# 启动 API 服务
npm run cli -- server

# 发布帖子
npm run cli -- publish --platform xiaohongshu --title "标题" --content "正文"

# 查看数据
npm run cli -- stats --post-id post_001
npm run cli -- stats --platform xiaohongshu

# 数据分析
npm run cli -- analytics --platform xiaohongshu --period 7d

# 浏览养号（分钟）
npm run cli -- browse --platform xiaohongshu --duration 30

# 社交互动
npm run cli -- interact --platform xiaohongshu --action like --target-url "https://..."

# 定时任务
npm run cli -- schedule list
npm run cli -- schedule create --platform xiaohongshu --cron "0 9 * * *"
npm run cli -- schedule delete 任务ID

# 帮助
npm run cli -- help
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `ZENOCLAW_API_URL` | API 服务地址（默认：`http://localhost:3200`） |
| `ZENOCLAW_API_KEY` | API 鉴权密钥 |

---

## 限流策略

默认：每个 IP 地址 **每分钟 60 次**请求。

在 `zenoclaw.config.yaml` 中配置：

```yaml
api:
  rate_limit_max: 60          # 每个窗口最大请求数
  rate_limit_window_ms: 60000 # 窗口大小（毫秒）
```

超出限流的请求会收到 `429 Too Many Requests` 响应。

---

## 支持平台

| # | 平台 | ID | 内容类型 | 支持功能 |
|---|------|----|----------|----------|
| 1 | 小红书 | `xiaohongshu` | 图文笔记 | 发布 · 数据 · 浏览 · 互动 |
| 2 | 知乎 | `zhihu` | 专栏文章 | 发布 · 数据 · 浏览 · 互动 |
| 3 | 微博 | `weibo` | 微博动态 | 发布 · 数据 · 浏览 · 互动 |
| 4 | 抖音 | `douyin` | 视频 / 图文 | 发布 · 数据 · 浏览 |
| 5 | B站 | `bilibili` | 专栏文章 | 发布 · 数据 · 浏览 · 互动 |
| 6 | 微信公众号 | `wechat` | 文章 | 发布 · 数据 |
| 7 | 百家号 | `baijiahao` | 文章 | 发布 · 数据 · 浏览 |
| 8 | 今日头条 | `toutiao` | 文章 | 发布 · 数据 · 浏览 |
| 9 | 搜狐号 | `sohu` | 文章 | 发布 · 数据 |
| 10 | 大鱼号 | `dayu` | 文章 | 发布 · 数据 |
| 11 | 网易号 | `netease` | 文章 | 发布 · 数据 |
| 12 | 企鹅号 | `qq` | 文章 | 发布 · 数据 |
| 13 | 视频号 | `channels` | 视频 / 图文 | 发布 · 数据 |
| 14 | X (Twitter) | `x` | 推文 | 发布 · 数据 · 浏览 |
| 15 | Reddit | `reddit` | 帖子 | 发布 · 数据 · 浏览 |
| 16 | 即刻 | `jike` | 短动态 | 发布 · 数据 |
| 17 | V2EX | `v2ex` | 论坛帖子 | 发布 · 数据 · 浏览 |
| 18 | 少数派 | `sspai` | 文章 | 发布 · 数据 |
| 19 | Product Hunt | `producthunt` | 产品 | 发布 · 数据 |

---

## 插件接口

ZenoClaw 提供 4 个可插拔接口，支持自定义扩展：

### ContentProvider（内容提供器）

为发布和互动任务提供内容（标题、正文、标签、回复文案）。

```javascript
// plugins/content-provider/custom.js
export default {
  name: 'custom',
  async getContent(platform, options) {
    return { title: '...', content: '...', tags: [...], images: [...] }
  },
  async getReplyContent(platform, context) {
    return '回复内容...'
  }
}
```

### CaptchaSolver（验证码求解器）

处理自动化过程中遇到的验证码挑战。

```javascript
// plugins/captcha-solver/custom.js
export default {
  name: 'custom',
  async solve(imageBuffer, type) {
    return { text: 'captcha_answer' }
  }
}
```

### AnalyticsEngine（分析引擎）

处理采集数据并生成洞察报告。

```javascript
// plugins/analytics-engine/custom.js
export default {
  name: 'custom',
  async generateReport(options) { return { ... } },
  async getTrends(options) { return { ... } },
  async suggestBestTime(posts) { return [...] }
}
```

### Notifier（通知器）

发送任务状态变更通知。

```javascript
// plugins/notifier/custom.js
export default {
  name: 'custom',
  async notify(event, data) {
    // event: 'publish_success', 'publish_failed', 'stats_collected' 等
    // 可发送到 Webhook、Slack、邮件等
  }
}
```

在 `zenoclaw.config.yaml` 中配置：

```yaml
plugins:
  content_provider: json       # json | custom
  captcha_solver: manual       # manual | custom
  analytics_engine: basic      # basic | custom
  notifier: console            # console | webhook | custom
  webhook_url: https://...     # 用于 webhook 通知器
```

---

<p align="center">
  <strong>ZenoClaw</strong> — 开源智能浏览器自动化引擎<br>
  <a href="https://zeno.babiku.xyz">官网</a> · <a href="README_CN.md">中文 README</a> · <a href="API_REFERENCE.md">English Docs</a> · <a href="https://github.com/zenolore/zenoclaw">GitHub</a>
</p>
