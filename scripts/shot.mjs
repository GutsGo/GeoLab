import { chromium } from 'playwright-core'

const url = process.argv[2] || 'http://localhost:3000/'
const out = process.argv[3] || '/tmp/shot.png'
const width = Number(process.argv[4] || 1440)
const height = Number(process.argv[5] || 1000)
const waitMs = Number(process.argv[6] || 2500)

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(600)
await page.waitForTimeout(waitMs)
await page.screenshot({ path: out, fullPage: process.env.FULL === '1' })
console.log('shot ->', out)
if (errors.length) console.log(errors.slice(0, 12).join('\n'))
await browser.close()
