#!/usr/bin/env node
/**
 * ZenoClaw CLI — 命令行工具
 *
 * 用法:
 *   zenoclaw publish --platform xiaohongshu --title "标题" --content "内容"
 *   zenoclaw stats --post-id post_001
 *   zenoclaw analytics --platform xiaohongshu --period 7d
 *   zenoclaw browse --platform xiaohongshu --duration 30
 *   zenoclaw schedule list
 *   zenoclaw server                  # 启动 API 服务
 */
import { ZenoClawClient } from '../sdk/client.js'

const BANNER = `
  🐾 ZenoClaw CLI v0.1.0
  ─────────────────────────
  开源智能浏览器自动化引擎
  Powered by Zeno
`

const HELP = `
用法: zenoclaw <command> [options]

命令:
  server                     启动 API 服务
  publish                    发帖
  stats                      查看数据
  analytics                  数据分析
  browse                     浏览/养号
  interact                   互动操作
  schedule                   定时任务管理
  help                       显示帮助

选项:
  --api-url <url>            API 地址 (默认: http://localhost:3200)
  --api-key <key>            API Key
  --platform <name>          平台名称 (xiaohongshu/weibo/douyin)
  --title <text>             帖子标题
  --content <text>           帖子正文
  --images <paths>           图片路径（逗号分隔）
  --tags <tags>              标签（逗号分隔）
  --post-id <id>             帖子 ID
  --period <period>          时间范围 (7d/30d/all)
  --duration <minutes>       浏览时长（分钟）
  --cron <expression>        cron 表达式
  --json                     JSON 格式输出
`

// ============================================================
// 参数解析
// ============================================================
function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2).replace(/-/g, '_')
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    } else {
      args._.push(argv[i])
    }
  }
  return args
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  const subcommand = args._[1]

  if (!command || command === 'help') {
    console.log(BANNER)
    console.log(HELP)
    process.exit(0)
  }

  // 启动 API 服务（特殊处理）
  if (command === 'server') {
    await import('../api/server.js')
    return
  }

  // 其他命令通过 SDK 调用 API
  const client = new ZenoClawClient({
    baseUrl: args.api_url || process.env.ZENOCLAW_API_URL || 'http://localhost:3200',
    apiKey: args.api_key || process.env.ZENOCLAW_API_KEY || '',
  })

  const output = (data) => {
    if (args.json) {
      console.log(JSON.stringify(data, null, 2))
    } else {
      prettyPrint(data)
    }
  }

  try {
    switch (command) {
      case 'publish': {
        if (!args.platform) die('缺少 --platform 参数')
        const result = await client.post('/api/publish', {
          platform: args.platform,
          title: args.title || '',
          content: args.content || '',
          images: args.images ? args.images.split(',') : [],
          tags: args.tags ? args.tags.split(',') : [],
        })
        console.log(`✅ 发帖任务已创建: ${result.task_id}`)
        output(result)
        break
      }

      case 'stats': {
        if (args.post_id) {
          const result = await client.get(`/api/stats/${args.post_id}`)
          output(result)
        } else {
          const result = await client.get('/api/stats', { platform: args.platform })
          output(result)
        }
        break
      }

      case 'analytics': {
        const result = await client.get('/api/analytics', {
          platform: args.platform,
          period: args.period || '7d',
        })
        output(result)
        break
      }

      case 'browse': {
        if (!args.platform) die('缺少 --platform 参数')
        const duration = parseInt(args.duration || '30') * 60
        const result = await client.post('/api/browse', {
          platform: args.platform,
          action: 'nurture',
          strategy: { duration_min: duration * 0.8, duration_max: duration * 1.2 },
        })
        console.log(`🌐 浏览任务已启动: ${result.task_id}`)
        output(result)
        break
      }

      case 'interact': {
        if (!args.platform || !args.action) die('缺少 --platform 或 --action 参数')
        const result = await client.post('/api/interact', {
          platform: args.platform,
          action: args.action,
          content: args.content,
          target: args.target_url ? { url: args.target_url } : undefined,
        })
        output(result)
        break
      }

      case 'schedule': {
        if (subcommand === 'list' || !subcommand) {
          const result = await client.get('/api/schedule')
          output(result)
        } else if (subcommand === 'create') {
          if (!args.platform || !args.cron) die('缺少 --platform 或 --cron 参数')
          const result = await client.post('/api/schedule', {
            platform: args.platform,
            type: args.type || 'publish',
            cron_expression: args.cron,
            name: args.name,
          })
          console.log(`⏰ 定时任务已创建: ${result.id}`)
          output(result)
        } else if (subcommand === 'delete') {
          if (!args._[2]) die('缺少任务 ID')
          await client.delete(`/api/schedule/${args._[2]}`)
          console.log('已删除')
        } else {
          die(`未知子命令: ${subcommand}`)
        }
        break
      }

      default:
        die(`未知命令: ${command}，使用 zenoclaw help 查看帮助`)
    }
  } catch (err) {
    console.error(`❌ ${err.message}`)
    if (err.status) console.error(`   HTTP ${err.status}`)
    process.exit(1)
  }
}

function die(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

function prettyPrint(data) {
  if (typeof data !== 'object' || data === null) {
    console.log(data)
    return
  }
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      console.log(`\n${key} (${value.length}):`)
      for (const item of value.slice(0, 20)) {
        if (typeof item === 'object') {
          const summary = Object.entries(item).slice(0, 5).map(([k, v]) => `${k}=${v}`).join('  ')
          console.log(`  · ${summary}`)
        } else {
          console.log(`  · ${item}`)
        }
      }
      if (value.length > 20) console.log(`  ... 还有 ${value.length - 20} 条`)
    } else if (typeof value === 'object' && value !== null) {
      console.log(`\n${key}:`)
      for (const [k, v] of Object.entries(value)) {
        console.log(`  ${k}: ${v}`)
      }
    } else {
      console.log(`${key}: ${value}`)
    }
  }
}

main()
