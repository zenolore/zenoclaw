# ZenoClaw API Reference

**English** | [中文](API_REFERENCE_CN.md)

> Complete REST API reference for ZenoClaw — the open-source intelligent browser automation engine.

---

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Health Check](#health-check)
  - [Configuration](#configuration)
  - [Publish](#publish)
  - [Data Collection (Stats)](#data-collection-stats)
  - [Analytics](#analytics)
  - [Interaction](#interaction)
  - [Browse / Account Warming](#browse--account-warming)
  - [Account Management](#account-management)
  - [Scheduled Tasks](#scheduled-tasks)
  - [Platforms](#platforms)
- [SDK Reference](#sdk-reference)
- [CLI Reference](#cli-reference)
- [Rate Limiting](#rate-limiting)
- [Changelog](#changelog)

---

## Overview

| Property | Value |
|----------|-------|
| **Base URL** | `http://localhost:3200` |
| **Protocol** | HTTP / HTTPS |
| **Content-Type** | `application/json` |
| **Auth** | API Key via `X-API-Key` header |
| **Rate Limit** | 60 req/min (configurable) |

```
┌─────────────────────────────────────────────────────┐
│                  Client (SDK / CLI / cURL)           │
├─────────────────────────────────────────────────────┤
│              REST API  (Express, port 3200)          │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬────┤
│Publi-│Stats │Analy-│Inter-│Brow- │Acco- │Sche- │Pla-│
│  sh  │      │ tics │ act  │  se  │ unt  │ dule │ t. │
├──────┴──────┴──────┴──────┴──────┴──────┴──────┴────┤
│              Core Engine  +  19 Platform Adapters    │
└─────────────────────────────────────────────────────┘
```

---

## Authentication

All `/api/*` endpoints (except `/api/health`) require authentication when `api.auth_enabled` is `true` (default).

```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3200/api/publish
```

| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | Yes | API key configured in `zenoclaw.config.yaml` → `api.key` |

**Responses:**

| Status | Meaning |
|--------|---------|
| `401` | Missing API key |
| `403` | Invalid API key |
| `429` | Rate limit exceeded |

---

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "ErrorType",
  "message": "Human-readable error description"
}
```

| HTTP Code | Meaning |
|-----------|---------|
| `200` | Success |
| `202` | Task accepted (async execution) |
| `400` | Bad request (missing/invalid parameters) |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Resource not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## Endpoints

### Health Check

#### `GET /api/health`

Check API server status and validate API key.

**Request:**
```bash
curl -H "X-API-Key: YOUR_KEY" http://localhost:3200/api/health
```

**Response (200):**
```json
{
  "status": "ok",
  "auth": "valid"
}
```

---

### Configuration

#### `GET /api/config`

Retrieve current server configuration (read-only, no secrets exposed).

**Response (200):**
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

### Publish

#### `POST /api/publish`

Submit a content publish task. Executes asynchronously and returns a task ID.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `string` | ✅ | Target platform (`xiaohongshu`, `zhihu`, `weibo`, `douyin`, etc.) |
| `title` | `string` | | Post title |
| `content` | `string` | | Post body / text content |
| `images` | `string[]` | | Array of absolute image file paths |
| `tags` | `string[]` | | Array of topic tags |
| `schedule_at` | `string` | | ISO 8601 timestamp for delayed execution |
| `contentType` | `string` | | `"article"` or `"video"` |
| `videoPath` | `string` | | Absolute path to video file (video mode only) |
| `coverPath` | `string` | | Absolute path to cover image |
| `description` | `string` | | Video description |
| `declareType` | `string` | | Content declaration type (`"original"`, `"ai"`) |
| `dryRun` | `boolean` | | `true` = fill content but don't click publish |
| `options` | `object` | | Platform-specific options |

**Example:**
```bash
curl -X POST http://localhost:3200/api/publish \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "platform": "xiaohongshu",
    "title": "My Post Title",
    "content": "Post body text with details...",
    "images": ["/path/to/image1.jpg", "/path/to/image2.jpg"],
    "tags": ["tech", "tutorial"]
  }'
```

**Response (202):**
```json
{
  "task_id": "task_a1b2c3d4",
  "status": "pending",
  "message": "任务已创建，正在排队执行"
}
```

#### `GET /api/publish`

List all publish tasks.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `platform` | `string` | Filter by platform |
| `status` | `string` | Filter by status (`pending`, `running`, `success`, `failed`) |

**Response (200):**
```json
{
  "tasks": [
    {
      "task_id": "task_a1b2c3d4",
      "platform": "xiaohongshu",
      "title": "My Post Title",
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

Get a single task's status and details.

**Response (200):**
```json
{
  "task_id": "task_a1b2c3d4",
  "platform": "xiaohongshu",
  "title": "My Post Title",
  "status": "success",
  "created_at": "2026-05-05T12:00:00.000Z",
  "completed_at": "2026-05-05T12:35:00.000Z",
  "post_url": "https://www.xiaohongshu.com/explore/...",
  "result": { "success": true, "message": "发布成功" }
}
```

---

### Data Collection (Stats)

#### `GET /api/stats`

Get data overview for all tracked posts.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `platform` | `string` | Filter by platform |

**Response (200):**
```json
{
  "posts": [
    {
      "post_id": "post_001",
      "platform": "xiaohongshu",
      "title": "My Post Title",
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

Get detailed statistics snapshot for a specific post.

**Response (200):**
```json
{
  "post_id": "post_001",
  "platform": "xiaohongshu",
  "title": "My Post Title",
  "history": [
    { "views": 500, "likes": 20, "comments": 5, "collected_at": "2026-05-04T14:00:00.000Z" },
    { "views": 1234, "likes": 56, "comments": 12, "collected_at": "2026-05-05T14:00:00.000Z" }
  ]
}
```

#### `POST /api/stats/collect`

Manually trigger data collection for specified posts or platforms.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `string` | ✅ | Target platform |
| `post_url` | `string` | | Specific post URL to collect |

**Response (202):**
```json
{
  "task_id": "collect_e5f6g7h8",
  "status": "running",
  "message": "数据采集已启动"
}
```

---

### Analytics

#### `GET /api/analytics`

Generate a comprehensive analytics report.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `platform` | `string` | all | Filter by platform |
| `period` | `string` | `7d` | Time range: `7d`, `30d`, `all` |

**Response (200):**
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

Get trend data for a specific metric.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `platform` | `string` | all | Filter by platform |
| `metric` | `string` | `views` | Metric: `views`, `likes`, `comments`, `bookmarks` |
| `period` | `string` | `7d` | Time range |

**Response (200):**
```json
{
  "metric": "views",
  "period": "7d",
  "data_points": [
    { "date": "2026-05-01", "value": 200 },
    { "date": "2026-05-02", "value": 350 }
  ]
}
```

#### `GET /api/analytics/best-time`

Get recommended posting times based on historical engagement data.

**Response (200):**
```json
{
  "recommended_times": [
    { "day": "Monday", "hour": 9, "score": 0.95 },
    { "day": "Wednesday", "hour": 20, "score": 0.88 }
  ]
}
```

---

### Interaction

#### `POST /api/interact`

Execute a social interaction action (like, comment, follow, etc.).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `string` | ✅ | Target platform |
| `action` | `string` | ✅ | Action: `like`, `collect`, `comment`, `reply`, `follow`, `share` |
| `target` | `object` | | Target post/user `{ url: "..." }` |
| `content` | `string` | | Comment/reply text |

**Example:**
```bash
curl -X POST http://localhost:3200/api/interact \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "platform": "xiaohongshu",
    "action": "comment",
    "target": { "url": "https://www.xiaohongshu.com/explore/..." },
    "content": "Great post! Thanks for sharing."
  }'
```

**Response (202):**
```json
{
  "task_id": "interact_i9j0k1l2",
  "status": "accepted",
  "message": "互动任务已接受: comment"
}
```

#### `GET /api/interact/history`

Get interaction history.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `platform` | `string` | Filter by platform |
| `action` | `string` | Filter by action type |

**Response (200):**
```json
{
  "records": [
    {
      "task_id": "interact_i9j0k1l2",
      "platform": "xiaohongshu",
      "action": "comment",
      "status": "success",
      "created_at": "2026-05-05T15:00:00.000Z"
    }
  ],
  "total": 1
}
```

---

### Browse / Account Warming

#### `POST /api/browse`

Start a browsing / account warming session that simulates natural user behavior.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `string` | ✅ | Target platform |
| `action` | `string` | | `"nurture"` (default) |
| `strategy` | `object` | | `{ duration_min, duration_max }` in seconds |

**Example:**
```bash
curl -X POST http://localhost:3200/api/browse \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "platform": "xiaohongshu",
    "action": "nurture",
    "strategy": { "duration_min": 1200, "duration_max": 1800 }
  }'
```

**Response (202):**
```json
{
  "task_id": "browse_m3n4o5p6",
  "status": "running",
  "message": "浏览任务已启动: nurture"
}
```

#### `GET /api/browse/history`

Get browsing session history.

#### `GET /api/browse/active`

Get currently active browsing tasks.

---

### Account Management

#### `GET /api/account`

List all saved accounts (passwords masked).

**Response (200):**
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

Add or update an account. Passwords are AES-256-GCM encrypted at rest.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `string` | ✅ | Target platform |
| `username` | `string` | ✅ | Login username / email / phone |
| `password` | `string` | | Login password (encrypted at rest) |
| `cookies` | `object` | | Pre-authenticated cookie data |

#### `POST /api/account/login`

Trigger automated login for a platform account.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `string` | ✅ | Target platform |
| `account_id` | `string` | | Specific account ID (or use default) |

#### `DELETE /api/account/:id`

Delete a saved account by ID.

---

### Scheduled Tasks

#### `GET /api/schedule`

List all scheduled tasks with their running status.

**Response (200):**
```json
{
  "schedules": [
    {
      "id": "sch_u1v2w3x4",
      "name": "Daily XHS Post",
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

Create a new scheduled task.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `string` | ✅ | Target platform |
| `type` | `string` | | Task type: `publish`, `stats`, `browse`, `interact` |
| `cron_expression` | `string` | ✅ | Standard cron expression (e.g. `0 9 * * *`) |
| `name` | `string` | | Human-readable task name |
| `payload` | `object` | | Task-specific parameters |

**Example:**
```bash
curl -X POST http://localhost:3200/api/schedule \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "platform": "xiaohongshu",
    "type": "publish",
    "cron_expression": "0 9 * * *",
    "name": "Morning XHS Post"
  }'
```

#### `PATCH /api/schedule/:id`

Enable, disable, or modify a scheduled task.

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Enable/disable the task |
| `cron_expression` | `string` | Update schedule |
| `name` | `string` | Update name |

#### `DELETE /api/schedule/:id`

Delete a scheduled task.

---

### Platforms

#### `GET /api/platforms`

List all supported platforms with metadata.

**Response (200):**
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

Detailed health matrix for all platforms: chain status, reader coverage, interaction selectors.

**Response (200):**
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

## SDK Reference

Install from your project:

```javascript
import { ZenoClaw } from './sdk/index.js'

const client = new ZenoClaw({
  apiUrl: 'http://localhost:3200',
  apiKey: 'your-api-key',
  timeout: 30000  // optional, default 30s
})
```

### Methods

| Category | Method | API Endpoint |
|----------|--------|-------------|
| **Publish** | `client.publish(params)` | `POST /api/publish` |
| | `client.getPublishTasks(query?)` | `GET /api/publish` |
| | `client.getPublishTask(taskId)` | `GET /api/publish/:taskId` |
| **Stats** | `client.getStats(postId)` | `GET /api/stats/:postId` |
| | `client.getAllStats(query?)` | `GET /api/stats` |
| | `client.collectStats(params)` | `POST /api/stats/collect` |
| **Analytics** | `client.getAnalytics(query?)` | `GET /api/analytics` |
| | `client.getTrends(query?)` | `GET /api/analytics/trends` |
| | `client.getBestTime()` | `GET /api/analytics/best-time` |
| **Interact** | `client.interact(params)` | `POST /api/interact` |
| | `client.getInteractHistory(query?)` | `GET /api/interact/history` |
| **Browse** | `client.browse(params)` | `POST /api/browse` |
| | `client.getBrowseHistory(query?)` | `GET /api/browse/history` |
| | `client.getActiveBrowseTasks()` | `GET /api/browse/active` |
| **Account** | `client.login(params)` | `POST /api/account/login` |
| | `client.getAccounts()` | `GET /api/account` |
| | `client.addAccount(params)` | `POST /api/account` |
| | `client.deleteAccount(id)` | `DELETE /api/account/:id` |
| **Schedule** | `client.getSchedules()` | `GET /api/schedule` |
| | `client.createSchedule(params)` | `POST /api/schedule` |
| | `client.updateSchedule(id, params)` | `PATCH /api/schedule/:id` |
| | `client.deleteSchedule(id)` | `DELETE /api/schedule/:id` |
| **Platforms** | `client.getPlatforms()` | `GET /api/platforms` |
| | `client.getPlatformsHealth()` | `GET /api/platforms/health` |
| **System** | `client.health()` | `GET /api/health` |
| | `client.getConfig()` | `GET /api/config` |

### Quick Examples

```javascript
// Publish a post
const result = await client.publish({
  platform: 'xiaohongshu',
  title: 'My Title',
  content: 'Post content...',
  images: ['/path/to/image.jpg'],
  tags: ['tech', 'tutorial']
})
console.log(`Task created: ${result.task_id}`)

// Check task status
const task = await client.getPublishTask(result.task_id)
console.log(`Status: ${task.status}`)

// Get analytics
const report = await client.getAnalytics({ period: '7d' })

// Create a daily schedule
await client.createSchedule({
  platform: 'zhihu',
  type: 'publish',
  cron_expression: '0 20 * * *',
  name: 'Evening Zhihu Post'
})

// Browse for account warming
await client.browse({
  platform: 'weibo',
  strategy: { duration_min: 1200, duration_max: 1800 }
})
```

---

## CLI Reference

```bash
# Start API server
npm run cli -- server

# Publish
npm run cli -- publish --platform xiaohongshu --title "Title" --content "Content"

# View stats
npm run cli -- stats --post-id post_001
npm run cli -- stats --platform xiaohongshu

# Analytics
npm run cli -- analytics --platform xiaohongshu --period 7d

# Browse (account warming)
npm run cli -- browse --platform xiaohongshu --duration 30

# Interactions
npm run cli -- interact --platform xiaohongshu --action like --target-url "https://..."

# Schedule management
npm run cli -- schedule list
npm run cli -- schedule create --platform xiaohongshu --cron "0 9 * * *"
npm run cli -- schedule delete SCHEDULE_ID

# Options
npm run cli -- help
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ZENOCLAW_API_URL` | API server URL (default: `http://localhost:3200`) |
| `ZENOCLAW_API_KEY` | API key for authentication |

---

## Rate Limiting

Default: **60 requests per minute** per IP address.

Configure in `zenoclaw.config.yaml`:

```yaml
api:
  rate_limit_max: 60          # Max requests per window
  rate_limit_window_ms: 60000 # Window size in milliseconds
```

Exceeded requests receive `429 Too Many Requests`.

---

## Supported Platforms

| # | Platform | ID | Content Types | Features |
|---|----------|----|---------------|----------|
| 1 | 小红书 (Xiaohongshu) | `xiaohongshu` | Image+Text Notes | Publish, Read, Browse, Interact |
| 2 | 知乎 (Zhihu) | `zhihu` | Column Articles | Publish, Read, Browse, Interact |
| 3 | 微博 (Weibo) | `weibo` | Microblog Posts | Publish, Read, Browse, Interact |
| 4 | 抖音 (Douyin) | `douyin` | Video / Image | Publish, Read, Browse |
| 5 | B站 (Bilibili) | `bilibili` | Column Articles | Publish, Read, Browse, Interact |
| 6 | 微信公众号 (WeChat) | `wechat` | Articles | Publish, Read |
| 7 | 百家号 (Baijiahao) | `baijiahao` | Articles | Publish, Read, Browse |
| 8 | 今日头条 (Toutiao) | `toutiao` | Articles | Publish, Read, Browse |
| 9 | 搜狐号 (Sohu) | `sohu` | Articles | Publish, Read |
| 10 | 大鱼号 (Dayu) | `dayu` | Articles | Publish, Read |
| 11 | 网易号 (NetEase) | `netease` | Articles | Publish, Read |
| 12 | 企鹅号 (QQ) | `qq` | Articles | Publish, Read |
| 13 | 视频号 (Channels) | `channels` | Video / Image | Publish, Read |
| 14 | X (Twitter) | `x` | Tweets | Publish, Read, Browse |
| 15 | Reddit | `reddit` | Posts | Publish, Read, Browse |
| 16 | 即刻 (Jike) | `jike` | Short Posts | Publish, Read |
| 17 | V2EX | `v2ex` | Forum Posts | Publish, Read, Browse |
| 18 | 少数派 (SSPAI) | `sspai` | Articles | Publish, Read |
| 19 | Product Hunt | `producthunt` | Products | Publish, Read |

---

## Plugin Interfaces

ZenoClaw provides 4 pluggable interfaces for custom extensions:

### ContentProvider

Provides content (title, body, tags, reply text) for publish and interact tasks.

```javascript
// plugins/content-provider/custom.js
export default {
  name: 'custom',
  async getContent(platform, options) {
    return { title: '...', content: '...', tags: [...], images: [...] }
  },
  async getReplyContent(platform, context) {
    return 'Reply text...'
  }
}
```

### CaptchaSolver

Handles CAPTCHA challenges during automation.

```javascript
// plugins/captcha-solver/custom.js
export default {
  name: 'custom',
  async solve(imageBuffer, type) {
    return { text: 'captcha_answer' }
  }
}
```

### AnalyticsEngine

Processes collected data and generates insights.

```javascript
// plugins/analytics-engine/custom.js
export default {
  name: 'custom',
  async generateReport(options) { return { ... } },
  async getTrends(options) { return { ... } },
  async suggestBestTime(posts) { return [...] }
}
```

### Notifier

Sends notifications for task status updates.

```javascript
// plugins/notifier/custom.js
export default {
  name: 'custom',
  async notify(event, data) {
    // event: 'publish_success', 'publish_failed', 'stats_collected', etc.
    // Send to webhook, Slack, email, etc.
  }
}
```

Configure in `zenoclaw.config.yaml`:

```yaml
plugins:
  content_provider: json       # json | custom
  captcha_solver: manual       # manual | custom
  analytics_engine: basic      # basic | custom
  notifier: console            # console | webhook | custom
  webhook_url: https://...     # For webhook notifier
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

<p align="center">
  <strong>ZenoClaw</strong> — Open-source intelligent browser automation engine<br>
  <a href="https://zeno.babiku.xyz">Website</a> · <a href="README.md">README</a> · <a href="API_REFERENCE_CN.md">中文文档</a> · <a href="https://github.com/zenolore/zenoclaw">GitHub</a>
</p>
