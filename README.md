# 🐾 ZenoClaw

**English** | [中文](README_CN.md)

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Platforms](https://img.shields.io/badge/Platforms-19-orange.svg)](#supported-platforms)

**Open-source intelligent browser automation engine** — Auto-publish · Data tracking · Smart interaction · Anti-bot detection

> Powered by **Zeno** · [🌐 Website](https://zeno.babiku.xyz) · [📱 iOS App](#-zeno-ecosystem) · [💻 Mac App](#-zeno-ecosystem)

---

## ✨ Features

- **19 Platform Adapters** — Xiaohongshu / Zhihu / Weibo / Douyin / Bilibili / WeChat Official / Baijiahao / Sohu / Dayu / NetEase / QQ / Toutiao / X / Reddit / Jike / V2EX / SSPAI / Product Hunt / Channels
- **Connects to Your Running Chrome** — Attaches via debugging port to your existing browser session; operates in new tabs without interfering with your open pages
- **Multi-Layer Anti-Detection** — See [Anti-Detection Architecture](#-anti-detection-architecture) below
- **Human Behavior Simulation** — Bézier curve mouse trajectories (ghost-cursor), Gaussian-distributed random delays, typo→backspace correction, Chinese IME input simulation, thinking pauses, random scrolling
- **🆕 Behavior Recorder** — Record your real mouse trajectories, typing rhythm, click patterns, and scroll habits; auto-extract statistical parameters to replace hardcoded defaults; see [Behavior Recorder](#-behavior-recorder) below
- **🆕 Live Status Overlay** — Real-time floating status bar on the page during publishing (e.g., "Typing title...", "Uploading images..."); anti-detection design using Shadow DOM
- **Ultra-Long Random Delays** — 30–60 minutes per post; 1–5 minutes of simulated browsing between each step; all timing parameters follow Gaussian distribution
- **Non-Intrusive** — Controls the browser via CDP protocol internal events; never hijacks your physical mouse or keyboard
- **Data Collection** — Periodically reads views, likes, comments, and bookmarks from published posts
- **Fully Configurable** — 17 categories, 115 parameters; every delay, probability, and behavior is customizable
- **AI Visual Verification** — Screenshots before publishing; calls vision models (GLM-4V / GPT-4V) to verify content correctness
- **Auto Retry** — Configurable retry count and interval on publish failure
- **Scheduled Execution** — Flexible cron expressions for publishing and data collection
- **REST API** — Full HTTP API for remote control of all features
- **Web Dashboard** — Modern dark-themed UI built with React + TailwindCSS
- **SVG Poster Studio** — Paste SVG code for live preview, resize, export PNG/JPG, and publish directly
- **Plugin System** — 4 pluggable interfaces: ContentProvider / CaptchaSolver / AnalyticsEngine / Notifier
- **SDK + CLI** — Node.js SDK and CLI tool for easy integration and scripting

## Architecture

```
┌─────────────────────────────────────────────┐
│                 Web UI (React)              │  ← Dashboard
├─────────────────────────────────────────────┤
│              REST API (Express)             │  ← 7 route groups
├──────────┬──────────┬──────────┬────────────┤
│ Content  │ Captcha  │Analytics │  Notifier  │  ← Plugin layer
│ Provider │ Solver   │ Engine   │            │
├──────────┴──────────┴──────────┴────────────┤
│              Core Engine                    │  ← Browser + human behavior simulation
├─────────────────────────────────────────────┤
│      Platform Adapters (19 platforms)      │  ← Xiaohongshu/Zhihu/WeChat/Weibo/...
└─────────────────────────────────────────────┘
```

## Quick Start

### 1. Install

```bash
git clone https://github.com/zenolore/zenoclaw.git
cd zenoclaw
npm install

# Web UI (optional)
cd web && npm install && cd ..
```

### 2. Initialize

```bash
npm run setup                   # Creates data directories, example config, and sample post data
```

### 3. Configure

```bash
# If setup already copied the config, just edit it; otherwise copy manually
cp zenoclaw.config.example.yaml zenoclaw.config.yaml
```

Edit `zenoclaw.config.yaml` — **required**: `browser.chrome_user_data`.

To find the path: enter `chrome://version` in Chrome's address bar, find "Profile Path", and use its parent directory.

### 4. Run

```bash
# ─── Core Engine (CLI mode) ───
npm start                         # Start scheduled tasks
npm run post:xhs                  # Publish one post to Xiaohongshu
npm run read:xhs                  # Read post engagement data

# ─── API Server ───
npm run api                       # Start REST API (port 3200)

# ─── Web Dashboard ───
npm run web                       # Start Web UI (port 5173)

# ─── CLI ───
npm run cli -- help               # CLI help
npm run cli -- publish --platform xiaohongshu --title "Title"
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/publish` | Submit a publish task |
| `GET` | `/api/publish` | List all tasks |
| `GET` | `/api/publish/:taskId` | Get single task status |
| `GET` | `/api/stats` | Get data overview |
| `GET` | `/api/stats/:postId` | Get post statistics snapshot |
| `POST` | `/api/stats/collect` | Trigger data collection manually |
| `GET` | `/api/analytics` | Comprehensive analytics report |
| `GET` | `/api/analytics/trends` | Trend data |
| `GET` | `/api/analytics/best-time` | Best posting times |
| `POST` | `/api/interact` | Execute interaction action |
| `GET` | `/api/interact/history` | Get interaction history |
| `POST` | `/api/browse` | Start browsing / account warming task |
| `GET` | `/api/browse/history` | Get browsing history |
| `GET` | `/api/browse/active` | Get active browsing tasks |
| `POST` | `/api/account/login` | Auto-login |
| `GET` | `/api/account` | List accounts |
| `POST` | `/api/account` | Add / update account |
| `DELETE` | `/api/account/:id` | Delete account |
| `GET` | `/api/schedule` | Get scheduled tasks |
| `POST` | `/api/schedule` | Create scheduled task |
| `PATCH` | `/api/schedule/:id` | Enable / disable / modify scheduled task |
| `DELETE` | `/api/schedule/:id` | Delete scheduled task |

All endpoints support API key authentication (`X-API-Key` header) and rate limiting.

## SDK Usage

```javascript
import { ZenoClaw } from 'zenoclaw/sdk'

const client = new ZenoClaw({ apiUrl: 'http://localhost:3200', apiKey: 'your-key' })

// Publish
await client.publish({ platform: 'xiaohongshu', title: 'Title', content: 'Body text' })

// Get stats
const stats = await client.getAllStats({ platform: 'xiaohongshu' })

// Analytics
const report = await client.getAnalytics({ period: '7d' })

// Create schedule
await client.createSchedule({ platform: 'xiaohongshu', cron_expression: '0 8 * * *', type: 'publish' })
```

## Plugin System

ZenoClaw provides 4 pluggable interfaces for custom implementations:

| Interface | Default | Description |
|-----------|---------|-------------|
| `ContentProvider` | JSON file reader | Content generation (title / body / tags / replies) |
| `CaptchaSolver` | Manual handling | CAPTCHA recognition and solving |
| `AnalyticsEngine` | Basic statistics | Data analysis and insights |
| `Notifier` | Console output | Task status notifications (supports Webhook) |

## Project Structure

```
zenoclaw/
├── zenoclaw.config.example.yaml  # Config template (17 categories, 115 params)
├── package.json
├── core/                         # Core engine
│   ├── index.js                  #   Entry point
│   ├── config.js                 #   Config singleton
│   ├── browser.js                #   Browser connection + mutex + anti-detection
│   ├── human.js                  #   Human behavior simulation
│   ├── ime-simulator.js          #   Chinese IME input simulation
│   ├── vision-verify.js          #   AI visual verification
│   ├── scheduler.js              #   Scheduling + retry
│   ├── logger.js                 #   Logging
│   ├── safe-json.js              #   Concurrent-safe JSON I/O
│   ├── crypto.js                 #   AES-256-GCM encryption
│   └── store.js                  #   Memory + file persistence
├── platforms/                    # Platform adapters (19)
│   ├── base.js                   #   Adapter base class
│   ├── loader.js                 #   Dynamic platform loader
│   ├── xiaohongshu/              #   Xiaohongshu (image + text notes)
│   ├── zhihu/                    #   Zhihu (column articles)
│   ├── weibo/                    #   Weibo
│   ├── douyin/                   #   Douyin (TikTok China)
│   ├── bilibili/                 #   Bilibili
│   ├── wechat/                   #   WeChat Official Account
│   ├── x/                        #   X / Twitter
│   ├── reddit/                   #   Reddit
│   └── ...                       #   + 10 more platforms
├── plugins/                      # Plugin system
│   ├── manager.js                #   Plugin manager
│   ├── content-provider/         #   Content generation interface
│   ├── captcha-solver/           #   CAPTCHA interface
│   ├── analytics-engine/         #   Analytics interface
│   └── notifier/                 #   Notification interface
├── api/                          # REST API
│   ├── server.js                 #   Express server
│   ├── middleware/                #   Auth + rate limiting
│   └── routes/                   #   7 route modules
├── recorder/                     # Behavior recorder
│   ├── inject.js                 #   Browser injection script
│   ├── analyzer.js               #   Statistical analysis
│   └── record-behavior.js        #   CLI entry point
├── sdk/                          # Node.js SDK
├── cli/                          # CLI tool
├── web/                          # Web dashboard (React)
│   ├── src/pages/                #   6 pages (incl. SVG poster studio)
│   └── src/lib/api.js            #   API client
├── content/                      # Post templates
│   └── posts.example.json        #   Sample posts
└── data/                         # Runtime data (gitignored)
```

## 🛡 Anti-Detection Architecture

Among open-source automation tools, ZenoClaw's anti-detection design covers multiple layers from browser fingerprinting to behavioral patterns. All implementations are verifiable in the repository:

| Layer | Technology | Location | Description |
|-------|-----------|----------|-------------|
| **Browser Fingerprint** | puppeteer-extra-plugin-stealth | `core/browser.js` | Covers 20+ detection points: navigator, WebGL, canvas, etc. |
| **Viewport Fingerprint** | Gaussian random viewport size | `core/browser.js` | Random resolution on each launch to avoid fixed signatures |
| **WebRTC** | Full RTCPeerConnection disable | `core/browser.js` | Prevents real IP leakage |
| **Mouse Trajectory** | ghost-cursor Bézier curves | `core/human.js` | Non-linear movement simulating real hand motion |
| **Keyboard Rhythm** | Gaussian delay + typo simulation | `core/human.js` | Variable inter-key intervals; occasional typos with backspace |
| **Chinese Input** | IME composition event simulation | `core/ime-simulator.js` | Simulates pinyin input method word selection |
| **Behavioral Rhythm** | 1–5 min random browsing between actions | `core/human.js` | Mimics "fill one field, browse around" human habit |
| **Time Signature** | 30–60 min per post | `config: timing.*` | Avoids instant-completion bot signatures |
| **CDP Protocol** | No physical mouse/keyboard usage | `core/human.js` | Browser-internal events; invisible at OS level |
| **Behavior Recorder** | Real user behavior profiling | `recorder/` | Records your actual mouse/keyboard/scroll patterns; replaces hardcoded parameters with your personal Gaussian distributions |
| **Status Overlay** | Closed Shadow DOM + random attribute | `core/status-overlay.js` | Live step indicator invisible to page JavaScript; auto-removed after publishing |

> **Design Principle**: No single technique guarantees undetectability. ZenoClaw's strategy is multi-layer stacking so that the overall behavioral pattern statistically resembles a real human. All parameters are exposed in configuration, allowing users to fine-tune based on each platform's detection intensity.

## 🎙 Behavior Recorder

ZenoClaw includes a **behavior recorder** that captures your real interaction patterns and uses them to generate more human-like automation. Instead of relying on hardcoded random delays, the engine uses **your personal** mouse speed, typing rhythm, click patterns, and scroll habits.

### How It Works

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
│ 1. Record │ ──▶ │ 2. Analyze│ ──▶ │ 3. Profile    │ ──▶ │ 4. Apply  │
│ (browser) │     │ (stats)  │     │ (JSON file)   │     │ (auto)   │
└──────────┘     └──────────┘     └──────────────┘     └──────────┘
```

1. **Record** — Inject a recorder into your browser; browse naturally for 5–15 minutes
2. **Analyze** — Extract statistical distributions (mean, std, percentiles) from raw events
3. **Profile** — Save to `data/behavior-profile.json`
4. **Apply** — On next run, all timing parameters automatically use your recorded profile

### Step-by-Step Usage

#### 1. Start Chrome with debugging port

```bash
# Windows
chrome.exe --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

#### 2. Start the recorder

```bash
node recorder/record-behavior.js
```

The recorder will:
- Connect to Chrome via port 9222
- Inject the recording script into all open tabs
- Show a **red flashing "🔴 Recording" badge** in the bottom-right corner of each injected page
- Display a real-time event counter on the badge

#### 3. Operate naturally

Browse, click, type, scroll — do whatever you normally do on any website. **You don't need to use any specific site** — behavioral patterns generalize across websites.

Recommended minimum recording:
- **5 minutes** for basic profile (mouse + clicks only)
- **10–15 minutes** for full profile (including typing rhythm and scroll patterns)
- Type at least 50–100 characters in any input field for typing data

#### 4. Stop recording and extract

Press **Enter** in the terminal where the recorder is running, or use the emergency extraction tool:

```bash
node recorder/extract-now.js
```

Output example:
```
Total 4236 events

💾 Saved: data/behavior-profile.json

⌨️  Typing: 375ms ± 225ms, 642 keystrokes
🖱️  Mouse speed: 1043 px/s ± 1546
👆 Click hold: 109ms, 28 clicks total
📜 Scroll: 106px, 118 scrolls total
⏸️  Micro-pauses: 983ms (120x), Think: 4534ms (3x)
```

#### 5. Automatic integration

**No additional configuration needed.** On the next `initConfig()` call, the engine automatically loads `data/behavior-profile.json` and overrides default parameters.

Priority chain: **User YAML config** > **Recorded behavior profile** > **Hardcoded defaults**

For example, if you never set `keyboard.delay_min` in your config YAML, it will use your recorded value (e.g., 181ms) instead of the hardcoded default (100ms).

### What Gets Recorded

| Category | Parameters | Example Values |
|----------|-----------|---------------|
| **Typing** | delay_min, delay_max, delay_mean, delay_std, long_pause_prob, backspace_rate | 181ms–548ms, mean 375ms |
| **Mouse** | speed_mean/std, curvature, click_hold_mean/std | 1043 px/s ± 1546 |
| **Scroll** | amount_mean/std, interval_mean/std | 106px ± 35 |
| **Timing** | action_delay, think_delay, read_delay | 623ms–1183ms |

### Privacy

The recorder **never captures** the actual content you type, URLs you visit, or page content. It only records:
- Event types and timestamps
- Mouse coordinates
- Key categories (`char`, `backspace`, `enter`, `space`, `arrow`, `other`)
- Scroll distances

## Notes

1. **Browser Connection** — The program connects to Chrome via debugging port. On first run, launch Chrome with `--remote-debugging-port=9222`, or let the program auto-launch it.
2. **Login State** — Cookies expire; re-login manually when they do.
3. **Page Redesigns** — When a platform updates its UI, update `platforms/*/selectors.js`.
4. **Rate Control** — Recommended: no more than 2–3 posts per platform per day, 4+ hours apart.
5. **Anti-detection is not infallible** — Platform detection strategies evolve continuously. No tool can promise 100% undetectability. Reasonable usage frequency is the best protection.

## Disclaimer

This project is for educational research and personal lawful use only.

- Users must comply with target platforms' Terms of Service (ToS) and local laws
- Automated operations may violate certain platforms' ToS; users must assess risks independently
- All consequences arising from the use of this tool (including but not limited to account suspension, legal liability) are the user's sole responsibility
- The project authors accept no liability for any direct or indirect damages
- This project does not encourage or support any form of spamming or online harassment

## 🌐 Zeno Ecosystem

ZenoClaw is a fully standalone open-source tool. It is also part of the Zeno ecosystem — if you need AI content generation capabilities, you can use them together:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Zeno App      │     │   ZenoClaw      │     │   19 Platforms  │
│   AI copywriting│ ──▶ │   SVG Studio    │ ──▶ │   Auto-publish  │
│   + SVG posters │     │   Preview/Resize│     │   Data tracking │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- 🌐 **[zeno.babiku.xyz](https://zeno.babiku.xyz)** — Zeno Website
- 📱 **Zeno iOS** — 6 AI Agents · AI Keyboard · Knowledge Base · Long-term Memory
- 💻 **Zeno Mac** — AI Workstation · 18+ Models · Local Models · Template System

> ZenoClaw does not depend on Zeno App. You can prepare content any way you like — ZenoClaw handles the automated publishing.

<!-- TODO: Replace with real links after App Store launch -->
<!-- [📱 Download iOS App](https://apps.apple.com/app/zeno/id...) -->
<!-- [💻 Download Mac App](https://apps.apple.com/app/zeno/id...) -->

## ⭐ Star History

If this project helps you, please give it a Star ⭐

## License

[MIT](LICENSE)
