/**
 * 成绩分享卡：纯 canvas 绘制，输出 PNG dataURL。
 * 不引第三方库、不发网络请求——分享行为完全在本地完成。
 */

export interface ShareStat {
  label: string
  value: string
}

export interface ShareBar {
  name: string
  got: number
  total: number
  hue: string
}

export interface ShareCardData {
  /** 卡片主标题，如「每日挑战 · 2026-11-03」 */
  title: string
  /** 副标题一句话 */
  subtitle: string
  date: string
  stats: ShareStat[]
  bars: ShareBar[]
  /** 徽章进度（n/m），不展示可传 null */
  badges: { got: number; total: number } | null
  seen: number
  total: number
}

const W = 720
const H = 1010

const INK = '#191712'
const INK2 = '#46402f'
const MUTED = '#6f6753'
const LINE = '#e3dccb'
const PAPER = '#f7f4ec'
const CARD = '#fffefb'

const SERIF = '"Noto Serif SC", "Songti SC", "STSong", serif'
const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const MONO = '"SF Mono", ui-monospace, Menlo, monospace'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function renderShareCard(data: ShareCardData): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // ---- 底色与双线画框 ----
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.strokeRect(18, 18, W - 36, H - 36)
  ctx.strokeStyle = '#cfc5ad'
  ctx.lineWidth = 0.8
  ctx.strokeRect(26, 26, W - 52, H - 52)

  // ---- 品牌行 ----
  ctx.fillStyle = INK
  roundRect(ctx, 56, 60, 44, 44, 10)
  ctx.fill()
  ctx.fillStyle = '#fdf9ee'
  ctx.font = `500 24px ${SERIF}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('G', 78, 84)
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.font = `500 22px ${SERIF}`
  ctx.fillText('GeoLab', 114, 78)
  ctx.fillStyle = MUTED
  ctx.font = `400 11px ${SANS}`
  ctx.fillText('抽 取 式 地 理 学 习', 114, 98)

  // ---- 标题与日期 ----
  ctx.fillStyle = INK
  ctx.font = `500 40px ${SERIF}`
  ctx.fillText(data.title, 56, 176)
  ctx.fillStyle = MUTED
  ctx.font = `400 13px ${MONO}`
  ctx.fillText(data.date, 56, 206)
  ctx.fillStyle = INK2
  ctx.font = `400 14px ${SANS}`
  ctx.fillText(data.subtitle, 56, 236)

  // ---- 统计块 ----
  const statY = 280
  const statW = (W - 112 - 24 * (data.stats.length - 1)) / data.stats.length
  data.stats.forEach((s, i) => {
    const x = 56 + i * (statW + 24)
    ctx.fillStyle = CARD
    roundRect(ctx, x, statY, statW, 96, 12)
    ctx.fill()
    ctx.strokeStyle = LINE
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.font = `500 30px ${MONO}`
    ctx.fillText(s.value, x + statW / 2, statY + 38)
    ctx.fillStyle = MUTED
    ctx.font = `400 11.5px ${SANS}`
    ctx.fillText(s.label, x + statW / 2, statY + 70)
  })
  ctx.textAlign = 'left'

  // ---- 大洲进度条 ----
  let y = statY + 132
  ctx.fillStyle = INK2
  ctx.font = `500 12px ${SANS}`
  ctx.fillText('各大洲解锁进度', 56, y)
  y += 26
  for (const b of data.bars) {
    ctx.fillStyle = INK
    ctx.font = `400 13px ${SANS}`
    ctx.fillText(b.name, 56, y + 10)
    ctx.fillStyle = MUTED
    ctx.font = `400 11px ${MONO}`
    ctx.textAlign = 'right'
    ctx.fillText(`${b.got}/${b.total}`, W - 56, y + 10)
    ctx.textAlign = 'left'
    const trackX = 150
    const trackW = W - 220
    ctx.fillStyle = '#f1ece0'
    roundRect(ctx, trackX, y + 2, trackW, 8, 4)
    ctx.fill()
    const pct = b.total ? b.got / b.total : 0
    if (pct > 0) {
      ctx.fillStyle = b.hue
      roundRect(ctx, trackX, y + 2, Math.max(8, trackW * pct), 8, 4)
      ctx.fill()
    }
    y += 30
  }

  // ---- 徽章与解锁 ----
  y += 18
  ctx.strokeStyle = LINE
  ctx.setLineDash([3, 5])
  ctx.beginPath()
  ctx.moveTo(56, y)
  ctx.lineTo(W - 56, y)
  ctx.stroke()
  ctx.setLineDash([])
  y += 30

  ctx.fillStyle = INK2
  ctx.font = `400 13px ${SANS}`
  const badgeText = data.badges
    ? `成就徽章 ${data.badges.got} / ${data.badges.total}    ·    `
    : ''
  ctx.fillText(`${badgeText}已解锁国家 ${data.seen} / ${data.total}`, 56, y)

  // ---- 页脚 ----
  ctx.fillStyle = MUTED
  ctx.font = `400 11px ${SANS}`
  ctx.fillText('GeoLab · 抽取式地理学习 · 边界以官方地图为准', 56, H - 56)

  return canvas.toDataURL('image/png')
}

/** 触发浏览器下载（dataURL → a[download]） */
export function downloadDataUrl(dataUrl: string, filename: string) {
  if (!dataUrl) return
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
