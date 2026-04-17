# Changelog

All notable changes to this project will be documented in this file.

## [0.5.1] - 2026-04-17

### Fixed

- **Toutiao (`platforms/toutiao/publisher.js` / `selectors.js`)**
  - Cover upload now runs **before** body content input, preventing Toutiao from auto-selecting the first inline image as the cover
  - `setCoverMode` clicks the `<label>` element instead of the native `<input>` (byte-design radio requires label click to trigger React state update)
  - Triple-cover mode now uploads all 3 images at once via the `multiple` file input
  - Cover `file input` selector extended to cover the `.upload-handler` popup overlay
- **Baijiahao (`platforms/baijiahao/publisher.js`)**
  - Cover click strategy split into empty-slot (click text leaf node "选择封面") vs filled-slot (hover + full pointerdown/mousedown/mouseup/click event chain + Puppeteer real-mouse move+click)
  - Step order aligned with Toutiao: cover upload runs before content input
  - All four publish-option checkboxes now correctly triggered: `declareAiContent`, `declareSource`, `enableArticleToDynamic`, `disablePodcast`
- **Zhihu (`platforms/zhihu/publisher.js`)**
  - Full `contentBlocks` pipeline: text blocks via ClipboardEvent paste + image blocks via ZHSE CDN upload with `draft` API confirmation
  - Topic tag selection (up to 2) and submission-question assignment both working end-to-end
  - `normalizePostForPublish` + `verifyPageState` implemented for consistency with other platforms

### Added

- **Full-chain CDP regression script** (`scripts/test-fullchain-cdp.mjs`) — One-shot end-to-end dryRun for Toutiao / Baijiahao / Zhihu with contentBlocks + cover + all publish options
- **Platform-specific publish options** (`sdk/publish-post.js` CLI args)
  - Baijiahao: `--declareAiContent`, `--declareSource`, `--enableArticleToDynamic`, `--disablePodcast`
  - WeChat: `--author`

### Platform Test Matrix (2026-04-17 dryRun, mode=review)

| Platform | Title | contentBlocks (text + image) | Cover | Publish Options | Overall |
|----------|-------|------------------------------|-------|-----------------|---------|
| **Toutiao** | ✅ Lexical editor | ✅ 5 blocks (3 text + 2 inline images via CDN `web_uri`) | ✅ Triple-cover (3 images via `multiple` input) | ✅ `location`, `enableAd`, `declareFirstPublish`, `publishWeiToutiao`, `declarations` | ✅ **PASS** |
| **Baijiahao** | ✅ Lexical editor | ✅ 5 blocks | ⚠️ Mode toggle OK; AI-pre-generated cover cannot be replaced via CDP (known issue) | ✅ All 4 checkboxes toggled | ✅ **PASS** |
| **Zhihu** | ✅ CDP insertText | ✅ 5 blocks (223 characters) | ✅ ZHSE CDN upload | ✅ Submission question + 2 topic tags | ✅ **PASS** |

### Known Issues

- **Baijiahao AI-pre-generated cover replacement**: React `onClick` on the "编辑/换封面" button rejects synthetic mouse events (including Puppeteer `page.mouse.click`), so AI-defaulted covers cannot be swapped via CDP. Workaround: keep the AI default cover in production, or replace manually during dryRun review.
- **Word-count read-back** on Toutiao / Baijiahao `verifyPageState` reads wrong DOM node (reports 3~5 chars vs actual 200+); does not affect publishing, will be calibrated later.

---

## [0.5.0] - 2026-04-12

### Added

- **Behavior Recorder** — Record real user interaction patterns (mouse, keyboard, scroll, click) and auto-extract statistical parameters for more human-like automation
  - `recorder/inject.js` — Browser injection script with visual recording indicator
  - `recorder/analyzer.js` — Statistical analysis engine (mean, std, percentiles, distributions)
  - `recorder/record-behavior.js` — CLI entry point
  - `recorder/extract-now.js` — Emergency extraction tool
  - `core/behavior-profile.js` — Profile loader + Gaussian random generators
- **Live Status Overlay** — Real-time floating status bar during publishing
  - `core/status-overlay.js` — Anti-detection overlay using closed Shadow DOM + randomized attributes
  - Shows current step in Chinese (e.g., "正在输入标题...", "正在上传图片...")
  - Invisible to page JavaScript; auto-injected after page navigation; auto-removed after publish
  - Integrated into all 19 platform adapters
- **Behavior Profile Auto-Integration** — `cfg()` now supports 3-tier priority: User YAML > Recorded Profile > Hardcoded Defaults
- **Step Label Mapping** — `runStep()` in base adapter auto-maps English step names to Chinese status overlay text

### Changed

- `core/config.js` — `cfg()` function now checks behavior profile before falling back to defaults
- `platforms/base.js` — `init()` auto-injects status overlay; `navigateTo()` re-injects after navigation; added `showStatus()` / `hideStatus()` methods
- All 19 platform adapters updated with step-by-step Chinese status messages

### Documentation

- `README.md` — Added Behavior Recorder section with step-by-step usage guide, privacy notes, and architecture diagram
- `README_CN.md` — Added corresponding Chinese documentation
- Both READMEs updated: Features list, Project Structure, Anti-Detection Architecture table

---

## [0.4.0] - 2026-04-10

### Added

- AI Visual Verification (GLM-4V / GPT-4V) — Screenshots before publishing, cross-model validation
- Midscene AI Agent integration — Vision-based element location and popup handling
- Chinese IME input simulation (`core/ime-simulator.js`)
- Vision-based page verification and smart delay (`core/vision-locate.js`)

## [0.3.0] - 2026-04-08

### Added

- Web Dashboard (React + TailwindCSS) with dark theme
- SVG Poster Studio — live preview, resize, export PNG/JPG
- REST API with 7 route groups, API key auth, rate limiting
- Node.js SDK and CLI tool
- Plugin system: ContentProvider / CaptchaSolver / AnalyticsEngine / Notifier

## [0.2.0] - 2026-04-05

### Added

- 19 platform adapters
- Human behavior simulation: ghost-cursor, Gaussian delays, typo correction
- Ultra-long random delays (30-60 min per post)
- Data collection: views, likes, comments, bookmarks
- Scheduled execution with cron expressions
- Auto retry on publish failure

## [0.1.0] - 2026-04-01

### Added

- Initial release
- Core browser automation engine
- CDP protocol integration
- Basic anti-detection (stealth plugin, random viewport, WebRTC disable)
- Configuration system (17 categories, 115 parameters)
