import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { initLogger, getLogger } from './logger.js'
import { initConfig } from './config.js'
import { startScheduler, runOnce, readOnce } from './scheduler.js'

/**
 * ZenoClaw 核心引擎入口
 *
 * 用法:
 *   node core/index.js                              # 启动定时调度
 *   node core/index.js --platform xiaohongshu --once # 立即执行一次小红书发帖
 *   node core/index.js --platform xiaohongshu --read # 立即读取帖子数据
 *   node core/index.js --help                        # 帮助
 */

// ============================================================
// 加载配置
// ============================================================

function loadConfig() {
  // 按优先级查找配置文件
  const candidates = [
    path.resolve('zenoclaw.config.yaml'),
    path.resolve('config.yaml'),
  ]
  const configPath = candidates.find(p => fs.existsSync(p))

  if (!configPath) {
    console.error('❌ 配置文件不存在')
    console.error('   请复制示例配置并修改:')
    console.error('   cp zenoclaw.config.example.yaml zenoclaw.config.yaml')
    process.exit(1)
  }

  const raw = fs.readFileSync(configPath, 'utf-8')
  const config = yaml.load(raw)

  // 验证必填项
  if (!config.browser?.chrome_user_data) {
    console.error('❌ 配置文件中 browser.chrome_user_data 未配置')
    console.error('   请在 Chrome 地址栏输入 chrome://version 查找 Profile 路径')
    process.exit(1)
  }

  return config
}

// ============================================================
// 解析命令行参数
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2)
  const result = {
    platform: null,
    once: false,
    read: false,
    help: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platform':
        result.platform = args[++i]
        break
      case '--once':
        result.once = true
        break
      case '--read':
        result.read = true
        break
      case '--help':
      case '-h':
        result.help = true
        break
    }
  }

  return result
}

function printHelp() {
  console.log(`
🐾 ZenoClaw — 开源智能浏览器自动化引擎

用法:
  node core/index.js                                # 启动定时调度模式（发帖 + 数据读取）
  node core/index.js --platform xiaohongshu --once  # 立即发一条小红书
  node core/index.js --platform xiaohongshu --read  # 立即读取小红书帖子数据
  node core/index.js --help                         # 显示帮助

API 服务:
  npm run api                                       # 启动 REST API 服务（端口 3200）
  npm run web                                       # 启动 Web 管理面板

浏览器:
  程序会自动连接你正在使用的 Chrome 浏览器（通过调试端口）
  如果 Chrome 未运行，会自动启动并加载你的 Profile
  操作在新标签页中进行，不影响你已打开的页面

配置:
  编辑 zenoclaw.config.yaml 设置浏览器、API、插件、行为模拟参数

内容:
  编辑 data/posts.json 添加待发布的帖子
  图片放到 data/images/ 目录

日志:
  运行日志保存在 logs/zenoclaw.log
  截图保存在 logs/screenshots/
`)
}

// ============================================================
// 主程序
// ============================================================

async function main() {
  const args = parseArgs()

  if (args.help) {
    printHelp()
    return
  }

  const config = loadConfig()
  initConfig(config)
  initLogger(config)
  const log = getLogger()

  log.info('═'.repeat(40))
  log.info('  🐾 ZenoClaw 核心引擎启动')
  log.info('═'.repeat(40))

  // 确保数据目录存在
  const dataDir = path.resolve('data/images')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  // 模式选择
  if (args.read && args.platform) {
    // 立即执行一次数据读取
    await readOnce(args.platform, config)
    log.info('数据读取完成，退出')
  } else if (args.once && args.platform) {
    // 立即执行一次发帖
    await runOnce(args.platform, config)
    log.info('发帖完成，退出')
  } else {
    // 定时调度模式（发帖 + 数据读取）
    startScheduler(config)
  }
}

main().catch(err => {
  console.error('程序异常退出:', err)
  process.exit(1)
})
