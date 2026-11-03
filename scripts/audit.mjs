/**
 * GeoLab 三视图冒烟审计：抽卡 / 全球 / 挑战，外加索引、测验、微型国家、移动端。
 *
 *   pnpm audit                       # 默认 http://localhost:3000/
 *   AUDIT_URL=http://localhost:4000/ pnpm audit
 *
 * 有任何一项不通过就以退出码 1 结束，可直接接 CI。
 * 截图写到系统临时目录，不要往仓库里丢 PNG。
 */
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const URL = process.env.AUDIT_URL || 'http://localhost:3000/'
const SHOT = join(tmpdir(), 'geolab-audit-mobile.png')

const CHROME =
  process.env.CHROME_PATH ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p))

if (!CHROME) {
  console.error('找不到 Chrome，设置 CHROME_PATH 环境变量后再跑')
  process.exit(1)
}

const out = {}
const errs = []
const warns = []
const checks = []

function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text())
    // Vue 的 duplicate key 之类是 warning，不抓就会漏
    if (m.type() === 'warning') warns.push(m.text())
  })

  await p.goto(URL, { waitUntil: 'load' })
  await p.evaluate(() => localStorage.clear())
  await p.reload({ waitUntil: 'load' })
  await p.waitForTimeout(2200)

  // 1. 抽卡视图：空格抽一张，轮廓描边动画确实在跑
  await p.keyboard.press('Space')
  await p.waitForTimeout(260)
  out.drawn = (await p.locator('.cur-name').innerText()).split('\n')[0]
  await p.waitForTimeout(1500)
  out.traceSegments = await p.locator('.dmap .trace').count()
  out.cardReady = await p.evaluate(() => {
    const el = document.querySelector('.card-slot > div')
    return el ? getComputedStyle(el).opacity : 'missing'
  })
  check('空格能抽出国家', !!out.drawn)
  check('抽取后显示国名而非占位', !!out.drawn && out.drawn !== '按下抽取', String(out.drawn))
  check('轮廓描边动画有路径', out.traceSegments > 0, `trace=${out.traceSegments}`)
  check('详情卡片最终不透明', out.cardReady === '1', `opacity=${out.cardReady}`)

  // 2. 索引抽屉：搜索 + 进入条目
  await p.getByRole('button', { name: '索引' }).click()
  await p.waitForTimeout(500)
  await p.locator('.s-input').fill('巴西')
  await p.waitForTimeout(400)
  out.searchHits = await p.locator('.g-item').count()
  await p.locator('.g-item').first().click()
  await p.waitForTimeout(1200)
  out.pickedFromIndex = (await p.locator('.cur-name').innerText()).split('\n')[0]
  check('索引搜索「巴西」有结果', out.searchHits >= 1, `hits=${out.searchHits}`)
  check('索引能跳转到条目', !!out.pickedFromIndex, String(out.pickedFromIndex))

  // 3. 测验：题目不能是屏上这个国家（防止开卷）
  await p.locator('.view-switch .vs-btn').nth(2).click()
  await p.waitForSelector('.g-opt', { timeout: 15000 })
  await p.waitForTimeout(500)
  const onScreen = out.pickedFromIndex
  const opts = await p.locator('.g-opt .opt-text').allInnerTexts()
  out.quizOptions = opts.length
  out.quizNotOnScreen = !opts.includes(onScreen)
  // 挑战视图是整页切换：抽卡视图整棵卸载，国名不在 DOM，天然防开卷
  out.stageHidden = await p.evaluate(() => document.querySelector('.cur-name') === null)
  await p.keyboard.press('1')
  await p.waitForTimeout(500)
  out.quizAnswered = (await p.locator('.g-result .res-main').count()) > 0
  await p.keyboard.press('Escape')
  await p.waitForTimeout(600)
  check('测验有 4 个选项', out.quizOptions === 4, `options=${out.quizOptions}`)
  check('测验题目不是屏上那个国家', out.quizNotOnScreen === true)
  check('测验时背景不可见（防开卷）', out.stageHidden === true)
  check('测验能作答并出反馈', out.quizAnswered === true)

  // 4. 全球视图：地图铺满，点击某国回到抽卡视图
  await p.locator('.vs-btn', { hasText: '全球' }).click()
  await p.waitForTimeout(1200)
  out.globeView = await p.locator('.globe-view').isVisible()
  out.globeLands = await p.locator('.world-svg .land').count()

  // 生产构建会剥掉 Vue 的 duplicate-key 警告，只能直接查 DOM：
  // 1) 全站不应该有重复的 id（FocusMap 的 defs 用实例 uid 就是为了这个）
  // 2) 地图每个可点国家的 data-id 必须唯一（world-atlas 有 3 个 feature 没有 ISO id）
  const dupIds = await p.evaluate(() => {
    const seen = new Map()
    for (const el of document.querySelectorAll('[id]')) {
      const id = el.id
      seen.set(id, (seen.get(id) || 0) + 1)
    }
    return [...seen.entries()].filter(([, n]) => n > 1).slice(0, 5)
  })
  const landIds = await p.evaluate(() => {
    const ids = [...document.querySelectorAll('.world-svg .land[data-id]')].map((e) => e.dataset.id)
    return { total: ids.length, unique: new Set(ids).size }
  })
  out.dupDomIds = dupIds
  out.landIds = landIds
  check('页面无重复 DOM id', dupIds.length === 0, JSON.stringify(dupIds))
  check('地图可点国家 id 唯一', landIds.total === landIds.unique, `${landIds.total}/${landIds.unique}`)
  // 点中国：必须是数据里收录的条目，否则只会提示"暂未收录"
  await p.locator('.world-svg .land[data-id="156"]').click({ force: true })
  await p.waitForTimeout(1400)
  out.backToDraw = await p.locator('.dmap').isVisible()
  out.afterGlobePick = (await p.locator('.cur-name').innerText()).split('\n')[0]
  check('全球视图可见', out.globeView === true)
  check('全球视图画出 >100 个国家', out.globeLands > 100, `lands=${out.globeLands}`)
  check('点国家能回到抽卡视图', out.backToDraw === true)
  check('点国家后卡片切到该国', out.afterGlobePick === '中国', `got=${out.afterGlobePick}`)

  // 5. 挑战视图：四个选项 + 作答 + 下一题
  await p.locator('.vs-btn', { hasText: '挑战' }).click()
  await p.waitForTimeout(1400)
  // 每日模式会保留作答状态，切到自由练习保证题目是新一轮
  await p.locator('.mode-switch button', { hasText: '自由练习' }).click()
  await p.waitForTimeout(800)
  // 自由模式随机出题型：地图定位题没有选项，跳过直到出选择题
  for (let i = 0; i < 5 && (await p.locator('.g-opt').count()) === 0; i++) {
    await p.locator('.skip').click().catch(() => {})
    await p.waitForTimeout(700)
  }
  out.gameOptions = await p.locator('.g-opt').count()
  out.gameQuestion = (await p.locator('.g-q h2').innerText()).slice(0, 20)
  await p.locator('.g-opt').first().click()
  await p.waitForTimeout(600)
  out.gameAnswered = await p.locator('.g-result').count()
  // 题号 chip 是「第 N 题」那枚（第一枚 hud-chip 是模式徽标，恒为「自由练习」）
  const roundChip = p.locator('.hud-chip', { hasText: '第' })
  const roundBefore = await roundChip.innerText()
  // 答对 → 首都追问：correct-pop 停顿或已自动进入首都题（res-idle），回车均可推进；
  // 答错 → 直接结算，回车进下一题。三条路都算「回车推进了流程」。
  if ((await p.locator('.correct-pop').count()) > 0) {
    await p.keyboard.press('Enter')
    await p.waitForTimeout(800)
    out.gameNext = (await p.locator('.res-idle').count()) > 0
  } else if ((await p.locator('.res-idle').count()) > 0) {
    // 停顿已过、首都题已自动出现
    out.gameNext = true
  } else {
    await p.keyboard.press('Enter')
    await p.waitForTimeout(900)
    out.gameNext = (await roundChip.innerText()) !== roundBefore
  }
  check('挑战视图有 4 个选项', out.gameOptions === 4, `options=${out.gameOptions}`)
  check('挑战能作答', out.gameAnswered > 0)
  check('回车能推进题目流程', out.gameNext === true)

  // 6. 小国特写：新加坡在 110m 里没有轮廓，必须靠 10m 补丁画出真实岛形
  await p.locator('.vs-btn', { hasText: '抽卡' }).click()
  await p.waitForTimeout(500)
  await p.getByRole('button', { name: '索引' }).click()
  await p.waitForTimeout(400)
  await p.locator('.s-input').fill('新加坡')
  await p.waitForTimeout(400)
  await p.locator('.g-item').first().click()
  await p.waitForTimeout(2000)
  out.microDot = await p.locator('.dmap .micro').count()
  out.microContext = await p.locator('.dmap .ctx path').count()
  out.microLabels = await p.$$eval('.dmap .ctx-label text', (els) =>
    els.map((e) => (e.textContent || '').trim()),
  )
  out.microShapeLen = await p.evaluate(
    () => (document.querySelector('.dmap .fill')?.getAttribute('d') || '').length,
  )
  out.microName = ((await p.locator('.dmap .corner-cap .micro-name').textContent().catch(() => '')) || '').trim()
  out.microInset = await p.locator('.dmap .inset').count()
  out.microInsetLands = await p.locator('.dmap .inset-land').count()
  out.microScale = ((await p.locator('.dmap .scale-label').textContent().catch(() => '')) || '').trim()
  check('微型国家画出真实轮廓（不是点）', out.microDot === 0 && out.microShapeLen > 200, `dot=${out.microDot} d=${out.microShapeLen}`)
  check('微型国家有邻国参照', out.microContext > 0, `ctx=${out.microContext}`)
  check('微型国家注记带真实面积', /km²/.test(out.microName), `name=${out.microName}`)
  check('微型国家有位置小图', out.microInset > 0 && out.microInsetLands > 0, `inset=${out.microInset} lands=${out.microInsetLands}`)
  check('微型国家带比例尺', /\d+\s*km/.test(out.microScale), `scale=${out.microScale}`)

  // 6b. 110m 里只有十个顶点的国家（斯里兰卡）也要换成精细轮廓
  await p.getByRole('button', { name: '索引' }).click()
  await p.waitForTimeout(400)
  await p.locator('.s-input').fill('斯里兰卡')
  await p.waitForTimeout(400)
  await p.locator('.g-item').first().click()
  await p.waitForTimeout(2000)
  out.lkShapeLen = await p.evaluate(
    () => (document.querySelector('.dmap .fill')?.getAttribute('d') || '').length,
  )
  out.lkInset = await p.locator('.dmap .inset').count()
  check('小国使用精细海岸线', out.lkShapeLen > 1500, `d=${out.lkShapeLen}`)
  check('小国有位置小图', out.lkInset > 0, `inset=${out.lkInset}`)

  // 7. 移动端布局不横向溢出
  await p.setViewportSize({ width: 390, height: 844 })
  await p.waitForTimeout(1500)
  out.mobileOverflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  // 溢出时把肇事元素揪出来，别让人再手工二分
  out.mobileOffenders =
    out.mobileOverflow > 0
      ? await p.evaluate(() => {
          const vw = window.innerWidth
          const rows = []
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.right <= vw + 0.5) continue
            const cs = getComputedStyle(el)
            if (cs.position === 'fixed') continue
            // 祖先已经在横向滚动容器里的，不算溢出源
            let inScroller = false
            for (let a = el.parentElement; a; a = a.parentElement) {
              const ox = getComputedStyle(a).overflowX
              if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
                inScroller = true
                break
              }
            }
            if (inScroller) continue
            rows.push({
              sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
              right: Math.round(r.right),
              width: Math.round(r.width),
              chain: (() => {
                const chain = []
                for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                  const cs = getComputedStyle(a)
                  chain.push(
                    `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).split(' ')[0] : ''}=${Math.round(a.getBoundingClientRect().width)}(min:${cs.minWidth})`,
                  )
                }
                return chain.slice(0, 5).join(' < ')
              })(),
            })
          }
          return rows.slice(0, 8)
        })
      : []
  await p.screenshot({ path: SHOT, fullPage: false })
  check('移动端无横向溢出', out.mobileOverflow <= 0, `overflow=${out.mobileOverflow}px ${JSON.stringify(out.mobileOffenders)}`)
} catch (e) {
  errs.push('脚本异常: ' + (e?.message || String(e)))
} finally {
  check('控制台无 error', errs.length === 0, errs.slice(0, 3).join(' | '))
  check('控制台无 warning', warns.length === 0, warns.slice(0, 3).join(' | '))

  console.log(JSON.stringify(out, null, 2))
  console.log(`\n截图: ${SHOT}`)

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n检查项 ${checks.length} 个：通过 ${checks.length - failed.length}，失败 ${failed.length}`)
  for (const c of checks) console.log(`  ${c.ok ? '✔' : '✖'} ${c.name}${c.ok ? '' : `  → ${c.detail}`}`)

  if (errs.length) console.log(`\nERRORS:\n  ${errs.slice(0, 6).join('\n  ')}`)
  if (warns.length) console.log(`\nWARNINGS:\n  ${warns.slice(0, 6).join('\n  ')}`)

  process.exitCode = failed.length ? 1 : 0
  await browser.close()
}
