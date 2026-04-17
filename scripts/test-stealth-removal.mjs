/**
 * 快速验证脚本：测试 puppeteer-core（去 stealth）能否正常连接 Chrome 并渲染搜狐 Vue SPA
 */
import puppeteer from 'puppeteer-core'

const PORT = 9222

async function main() {
  console.log('=== Phase 0 验证：puppeteer-core 连接 + 搜狐 Vue 渲染 ===\n')

  // 1. 连接 Chrome
  console.log('[1] 连接 Chrome...')
  const resp = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  const { webSocketDebuggerUrl } = await resp.json()
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl, defaultViewport: null })
  console.log(`[1] ✓ 已连接 Chrome (${(await browser.version())})`)

  // 2. 检查 navigator.webdriver（反检测补丁验证）
  console.log('\n[2] 检查反检测补丁...')
  const pages = await browser.pages()
  const testPage = pages[0] || await browser.newPage()
  
  // 注意：对已有 page，evaluateOnNewDocument 不会生效
  // 我们需要在新 page 上测试补丁
  const newPage = await browser.newPage()
  
  // 手动注入补丁（模拟 createConfiguredPage 的行为）
  await newPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    if (!window.chrome) window.chrome = {}
    if (!window.chrome.runtime) {
      window.chrome.runtime = { connect: () => {}, sendMessage: () => {} }
    }
  })
  
  await newPage.goto('about:blank')
  const webdriver = await newPage.evaluate(() => navigator.webdriver)
  const chromeRuntime = await newPage.evaluate(() => typeof window.chrome?.runtime?.connect)
  console.log(`[2] navigator.webdriver = ${webdriver} (期望: false) ${webdriver === false ? '✓' : '✗'}`)
  console.log(`[2] chrome.runtime.connect = ${chromeRuntime} (期望: function) ${chromeRuntime === 'function' ? '✓' : '✗'}`)

  // 3. 搜狐编辑器 Vue 渲染测试
  console.log('\n[3] 测试搜狐编辑器 Vue 渲染...')
  
  // 先检查是否已有搜狐标签页
  let sohuPage = null
  for (const p of pages) {
    if (p.url().includes('mp.sohu.com')) {
      sohuPage = p
      console.log(`[3] 找到已有搜狐标签页: ${p.url().substring(0, 80)}`)
      break
    }
  }

  if (!sohuPage) {
    console.log('[3] 无已有搜狐标签页，用新标签页导航...')
    sohuPage = newPage
    await sohuPage.goto('https://mp.sohu.com/mpfe/v4/contentManagement/news', {
      waitUntil: 'networkidle2',
      timeout: 30000
    })
  }

  await sohuPage.bringToFront()
  
  // 检查页面 DOM 元素数量
  const domInfo = await sohuPage.evaluate(() => {
    const allElements = document.querySelectorAll('*').length
    const inputs = document.querySelectorAll('input, textarea')
    const inputList = Array.from(inputs).map(el => ({
      tag: el.tagName,
      type: el.type || '',
      placeholder: el.placeholder || '',
      class: el.className?.substring(0, 50) || ''
    }))
    const buttons = document.querySelectorAll('button')
    const buttonTexts = Array.from(buttons).slice(0, 10).map(b => b.textContent?.trim().substring(0, 20))
    const vueRoot = document.querySelector('#app') || document.querySelector('[data-v-app]')
    
    return {
      totalElements: allElements,
      url: location.href.substring(0, 100),
      title: document.title,
      inputCount: inputs.length,
      inputs: inputList.slice(0, 10),
      buttonCount: buttons.length,
      buttonTexts,
      hasVueRoot: !!vueRoot,
      bodyTextLength: document.body?.innerText?.length || 0
    }
  })

  console.log(`[3] URL: ${domInfo.url}`)
  console.log(`[3] Title: ${domInfo.title}`)
  console.log(`[3] DOM 元素总数: ${domInfo.totalElements}`)
  console.log(`[3] Vue root (#app): ${domInfo.hasVueRoot ? '✓' : '✗'}`)
  console.log(`[3] input/textarea 数量: ${domInfo.inputCount}`)
  console.log(`[3] button 数量: ${domInfo.buttonCount}`)
  console.log(`[3] body 文本长度: ${domInfo.bodyTextLength}`)
  
  if (domInfo.inputs.length > 0) {
    console.log(`[3] inputs:`)
    domInfo.inputs.forEach((inp, i) => {
      console.log(`    ${i}: <${inp.tag}> type="${inp.type}" placeholder="${inp.placeholder}" class="${inp.class}"`)
    })
  }
  if (domInfo.buttonTexts.length > 0) {
    console.log(`[3] buttons (前10): ${domInfo.buttonTexts.join(' | ')}`)
  }

  // 判定结果
  const vueRendered = domInfo.totalElements > 50 && domInfo.bodyTextLength > 100
  console.log(`\n[3] Vue 渲染判定: ${vueRendered ? '✓ 正常（DOM 丰富）' : '✗ 异常（DOM 空或极少）'}`)

  // 4. 尝试导航到编辑器页面
  console.log('\n[4] 尝试导航到编辑器页面...')
  try {
    // 使用页内跳转（与 sohu publisher 一致）
    await sohuPage.evaluate(() => {
      window.location.href = 'https://mp.sohu.com/mpfe/v4/contentManagement/addarticle'
    })
    await sohuPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 3000))

    const editorInfo = await sohuPage.evaluate(() => {
      const title = document.querySelector('input[placeholder*="标题"]')
        || document.querySelector('.article-title input')
        || document.querySelector('input.title')
      const editor = document.querySelector('.ql-editor')
        || document.querySelector('[contenteditable="true"]')
      const allInputs = document.querySelectorAll('input, textarea')
      
      return {
        url: location.href.substring(0, 100),
        hasTitleInput: !!title,
        titlePlaceholder: title?.placeholder || '',
        hasEditor: !!editor,
        editorTag: editor?.tagName || '',
        totalElements: document.querySelectorAll('*').length,
        inputCount: allInputs.length,
        inputs: Array.from(allInputs).slice(0, 5).map(el => ({
          tag: el.tagName,
          placeholder: el.placeholder || '',
          class: el.className?.substring(0, 50) || ''
        }))
      }
    })

    console.log(`[4] URL: ${editorInfo.url}`)
    console.log(`[4] DOM 元素总数: ${editorInfo.totalElements}`)
    console.log(`[4] 标题输入框: ${editorInfo.hasTitleInput ? '✓' : '✗'} ${editorInfo.titlePlaceholder}`)
    console.log(`[4] 富文本编辑器: ${editorInfo.hasEditor ? '✓' : '✗'} ${editorInfo.editorTag}`)
    console.log(`[4] input/textarea 数量: ${editorInfo.inputCount}`)
    
    if (editorInfo.inputs.length > 0) {
      console.log(`[4] inputs:`)
      editorInfo.inputs.forEach((inp, i) => {
        console.log(`    ${i}: <${inp.tag}> placeholder="${inp.placeholder}" class="${inp.class}"`)
      })
    }

    const editorOK = editorInfo.hasTitleInput && editorInfo.hasEditor
    console.log(`\n[4] 编辑器渲染判定: ${editorOK ? '✓ 标题+编辑器都存在' : '✗ 缺少关键元素'}`)

  } catch (err) {
    console.log(`[4] ✗ 导航失败: ${err.message}`)
  }

  // 清理
  await newPage.close().catch(() => {})
  browser.disconnect()

  console.log('\n=== 验证完成 ===')
}

main().catch(err => {
  console.error('验证脚本出错:', err.message)
  process.exit(1)
})
