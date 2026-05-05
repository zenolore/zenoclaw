/**
 * zenoclaw/sdk/publish-post.js
 *
 * CLI bridge：通过 CDP 连接已打开的 Chrome，调用 zenoclaw 适配器发布内容
 * 由 executor 通过 child_process.spawn 调用，无需启动 zenoclaw API server
 *
 * 用法:
 *   node zenoclaw/sdk/publish-post.js \
 *     --platform xiaohongshu \
 *     --title "标题" \
 *     --content "正文内容" \
 *     --images "/path/a.jpg,/path/b.jpg" \
 *     --tags "宝藏APP,AI助手" \
 *     --mode publish \
 *     [--schedule "2026-04-10T10:00:00Z"] \
 *     [--port 9222]
 *
 * 输出 (stdout):
 *   成功: { "success": true, "message": "发布成功", "taskStatus": "completed", "publishedUrl": "https://..." }
 *   审核: { "success": true, "message": "内容已填写，等待人工确认", "taskStatus": "review_required", "publishedUrl": null }
 *   失败: { "success": false, "message": "错误信息", "taskStatus": "failed" }
 *
 * 退出码: 0 成功/审核, 1 失败
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'
import { loadAdapter } from '../platforms/loader.js'
import { initConfig } from '../core/config.js'

function parseArgs() {
  const args = process.argv.slice(2)
  const result = {
    platform: null,
    title: '',
    content: '',
    description: '',
    images: [],
    tags: [],
    videoPath: null,
    coverPath: null,
    coverLandscapePath: null,
    coverPortraitPath: null,
    contentType: null,
    coverType: undefined,
    enableAd: undefined,
    declarations: [],
    location: null,
    declareFirstPublish: undefined,
    autoRightsProtection: undefined,
    collection: null,
    publishWeiToutiao: undefined,
    // 百家号特有
    declareAiContent: undefined,
    declareSource: undefined,
    enableArticleToDynamic: undefined,
    disablePodcast: undefined,
    // 微信特有
    author: null,
    mode: 'review',
    schedule: null,
    port: 9222,
    subreddit: null,
    contentBlocksFile: null
  }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platform': result.platform  = args[++i]; break
      case '--title':    result.title     = args[++i]; break
      case '--content':  result.content   = args[++i]; break
      case '--description': result.description = args[++i]; break
      case '--images':   result.images = (args[++i] || '').split(',').filter(Boolean); break
      case '--tags':     result.tags      = (args[++i] || '').split(',').filter(Boolean); break
      case '--videoPath': result.videoPath = args[++i]; break
      case '--coverPath': result.coverPath = args[++i]; break
      case '--coverLandscapePath': result.coverLandscapePath = args[++i]; break
      case '--coverPortraitPath': result.coverPortraitPath = args[++i]; break
      case '--contentType': result.contentType = args[++i]; break
      case '--coverType': result.coverType = args[++i]; break
      case '--enableAd': result.enableAd = args[++i] === 'true'; break
      case '--declarations': result.declarations = (args[++i] || '').split(',').filter(Boolean); break
      case '--location': result.location = args[++i]; break
      case '--declareFirstPublish': result.declareFirstPublish = args[++i] === 'true'; break
      case '--autoRightsProtection': result.autoRightsProtection = args[++i] === 'true'; break
      case '--collection': result.collection = args[++i]; break
      case '--publishWeiToutiao': result.publishWeiToutiao = args[++i] === 'true'; break
      // 百家号特有
      case '--declareAiContent': result.declareAiContent = args[++i] === 'true'; break
      case '--declareSource': result.declareSource = args[++i] === 'true'; break
      case '--enableArticleToDynamic': result.enableArticleToDynamic = args[++i] === 'true'; break
      case '--disablePodcast': result.disablePodcast = args[++i] === 'true'; break
      // 微信特有
      case '--author': result.author = args[++i]; break
      case '--mode':     result.mode      = args[++i]; break
      case '--schedule': result.schedule  = args[++i]; break
      case '--port':     result.port      = parseInt(args[++i], 10); break
      case '--subreddit': result.subreddit = args[++i]; break
      case '--contentBlocksFile': result.contentBlocksFile = args[++i]; break
    }
  }
  return result
}

function output(data) {
  process.stdout.write(JSON.stringify(data))
}

async function connectChrome(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
  if (!resp.ok) throw new Error(`Chrome 调试端口 ${port} 不可用`)
  const data = await resp.json()
  if (!data.webSocketDebuggerUrl) throw new Error('未找到 Chrome webSocketDebuggerUrl')
  return puppeteer.connect({
    browserWSEndpoint: data.webSocketDebuggerUrl,
    defaultViewport: null
  })
}

/**
 * fast-mode 配置：关闭所有 browseForStep 和使用模拟延迟
 * executor 按需调用时不需要数分钟的人工模拟，快速完成即可
 */
function initFastMode() {
  initConfig({
    steps: {
      open_page:     { browse_min: 0, browse_max: 0 },
      upload_images: { browse_min: 0, browse_max: 0 },
      input_title:   { browse_min: 0, browse_max: 0 },
      input_content: { browse_min: 0, browse_max: 0 },
      add_tags:      { browse_min: 0, browse_max: 0, search_delay_min: 800, search_delay_max: 1200, select_delay_min: 1500, select_delay_max: 2500 },
      publish:       { browse_min: 0, browse_max: 0, review_delay_min: 1500, review_delay_max: 3000, wait_after_min: 3000, wait_after_max: 6000 },
    },
    timing: {
      action_delay_min: 300,
      action_delay_max: 800,
      total_duration_min: 0,
      total_duration_max: 0,
      post_navigation_delay_min: 1000,
      post_navigation_delay_max: 2000,
      warmup_browse_enabled: false,
    },
    tab: {
      post_publish_browse_min: 0,
      post_publish_browse_max: 0,
    },
    keyboard: {
      delay_min: 50,
      delay_max: 120,
      pause_chance: 0.03,
      pre_type_delay_min: 200,
      pre_type_delay_max: 500,
    },
    scroll: {
      times_min: 0,
      times_max: 1,
    },
    screenshot: {
      on_each_step: false,
      on_error: true,
      on_before_publish: false,
      on_after_publish: false,
    },
    browser: {
      navigation_timeout: 30000,
      element_timeout: 15000,
    },
    upload: {
      wait_after_select_min: 1000,
      wait_after_select_max: 2000,
      processing_poll_interval: 3000,
      processing_poll_max_attempts: 10,
    },
    mouse: {
      click_offset_percent: 10,
      click_wait_min: 50,
      click_wait_max: 150,
    },
  })
}

async function main() {
  initFastMode()
  const args = parseArgs()

  if (!args.platform) {
    output({ success: false, message: '缺少 --platform 参数', taskStatus: 'failed' })
    process.exit(1)
  }
  const isVideoTask = args.contentType === 'video' || !!args.videoPath
  const noTitlePlatforms = ['x', 'twitter', 'jike']
  if (!args.title && !noTitlePlatforms.includes(args.platform) && !isVideoTask) {
    output({ success: false, message: '缺少 --title 参数', taskStatus: 'failed' })
    process.exit(1)
  }
  if (isVideoTask && !args.videoPath) {
    output({ success: false, message: '视频任务缺少 --videoPath 参数', taskStatus: 'failed' })
    process.exit(1)
  }

  // 规范化平台名：xiaohongshu-2 → xiaohongshu（zenoclaw按目录名加载）
  const zenocrawPlatform = args.platform.replace(/-\d+$/, '')

  let browser = null
  let page = null
  let post = null

  try {
    browser = await connectChrome(args.port)
    // 记住发布前的活跃页面，发布完成后切回去（通用机制，不绑定特定 URL）
    const prevPages = await browser.pages()
    const prevPage = prevPages.length > 0 ? prevPages[prevPages.length - 1] : null
    page = await browser.newPage()

    const AdapterClass = await loadAdapter(zenocrawPlatform)
    const adapter = new AdapterClass(page)
    await adapter.init()

    // 读取 contentBlocks（从临时 JSON 文件）
    let contentBlocks = undefined
    if (args.contentBlocksFile) {
      try {
        const raw = fs.readFileSync(args.contentBlocksFile, 'utf8')
        contentBlocks = JSON.parse(raw)
        console.log(`[publish-post] 加载 contentBlocks: ${contentBlocks.length} 块`)
      } catch (e) {
        console.warn(`[publish-post] contentBlocks 文件读取失败: ${e.message}`)
      }
    }

    post = {
      contentType:   isVideoTask ? 'video' : undefined,
      title:        args.title,
      content:      args.content || args.description,
      description:  args.description || args.content,
      contentBlocks,
      images:       args.images,
      tags:         args.tags,
      videoPath:    args.videoPath || undefined,
      coverPath:    args.coverPath || undefined,
      coverLandscapePath: args.coverLandscapePath || undefined,
      coverPortraitPath: args.coverPortraitPath || undefined,
      coverPaths:   args.coverLandscapePath || args.coverPortraitPath ? {
        landscape4x3: args.coverLandscapePath || undefined,
        portrait3x4: args.coverPortraitPath || undefined,
      } : undefined,
      coverType:    args.coverType,
      enableAd:     args.enableAd,
      declarations: args.declarations,
      location:     args.location || undefined,
      declareFirstPublish: args.declareFirstPublish,
      autoRightsProtection: args.autoRightsProtection,
      collection:   args.collection || undefined,
      publishWeiToutiao: args.publishWeiToutiao,
      // 百家号特有
      declareAiContent: args.declareAiContent,
      declareSource: args.declareSource,
      enableArticleToDynamic: args.enableArticleToDynamic,
      disablePodcast: args.disablePodcast,
      // 微信特有
      author:       args.author || undefined,
      scheduleTime: args.schedule || undefined,
      dryRun:       args.mode !== 'publish',
      subreddit:    args.subreddit || undefined
    }

    const result = await adapter.publish(post)

    const taskStatus = !result.success
      ? 'failed'
      : post.dryRun
        ? 'review_required'
        : 'completed'

    output({ ...result, taskStatus })
    if (!result.success) process.exitCode = 1

  } catch (err) {
    output({ success: false, message: err.message, taskStatus: 'failed' })
    process.exitCode = 1
  } finally {
    // review (dryRun) 模式：保留页面供用户审核手动发布（与老流程一致）
    // publish 模式：发布完成后切回前一个标签页，再关闭发布页
    const isDryRun = post && post.dryRun
    if (page && !isDryRun) {
      // 切回发布前的标签页（通用：不管前面是什么页面都能回去）
      if (prevPage) {
        try { await prevPage.bringToFront() } catch {}
      }
      await page.close().catch(() => {})
    }
    if (browser) browser.disconnect()
  }
}

main()
