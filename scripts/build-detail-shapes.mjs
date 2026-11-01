/**
 * 生成 public/data/detail-shapes.json —— 小国的精细海岸线补丁。
 *
 * 抽卡主图会把单个国家放大到满屏。110m 国界对面积小的国家只有十来个顶点
 * （斯里兰卡 10 个、荷兰 14 个），放大后就是一个多边形色块；
 * 新加坡、马耳他、萨摩亚在 110m 里甚至没有轮廓。
 *
 * 这些国家改用 world-atlas 10m 数据重画，并按「该国在 700px 见方的画幅里占多宽」
 * 做 Douglas-Peucker 简化，保证 1px 级的精度，体积可控（约 200KB，gzip 68KB）。
 *
 *   node scripts/build-detail-shapes.mjs
 *
 * 依赖 node_modules 里的 world-atlas（10m 原始数据 3.7MB，不进构建产物）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as topojson from 'topojson-client'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

/** 顶点少于这个数的国家，满屏放大时都会露出多边形棱角 */
const ROUGH_THRESHOLD = 40

const countPoints = (a) => a.reduce((n, c) => n + (typeof c[0] === 'number' ? 1 : countPoints(c)), 0)

/** Douglas-Peucker，容差单位为度 */
function simplify(points, tol) {
  if (points.length < 3) return points
  const sqTol = tol * tol
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    let best = 0
    let bestIdx = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      let d
      if (len === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len))
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
      }
      if (d > best) {
        best = d
        bestIdx = i
      }
    }
    if (best > sqTol && bestIdx > 0) {
      keep[bestIdx] = 1
      stack.push([a, bestIdx], [bestIdx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

const ringArea = (ring) => {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return Math.abs(s / 2)
}

const round = (c) => [Number(c[0].toFixed(4)), Number(c[1].toFixed(4))]

// 只处理已收录的 82 个国家
const ids = new Set(
  ['asia', 'europe', 'africa', 'america', 'oceania'].flatMap((f) =>
    [...read(`app/data/${f}.ts`).matchAll(/id: '(\d+)'/g)].map((m) => m[1]),
  ),
)

const w110 = JSON.parse(read('public/data/countries-110m.json'))
const f110 = topojson.feature(w110, w110.objects.countries)
const dense110 = new Map()
for (const f of f110.features) {
  dense110.set(String(Number.parseInt(String(f.id), 10)), countPoints(f.geometry.coordinates))
}

const w10 = JSON.parse(read('node_modules/world-atlas/countries-10m.json'))
const f10 = topojson.feature(w10, w10.objects.countries)

let rawPoints = 0
let newPoints = 0
const features = []

for (const f of f10.features) {
  const id = String(Number.parseInt(String(f.id), 10))
  if (!ids.has(id)) continue
  if ((dense110.get(id) ?? 0) >= ROUGH_THRESHOLD) continue

  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  rawPoints += countPoints(g.coordinates)

  // 画幅按 700px 算：容差取国境跨度 / 700 就是 1px 的误差；
  // 跨度不到 2° 的小国源数据本来就没几个点，全留着也占不了多少体积
  let w = 180
  let e = -180
  let so = 90
  let no = -90
  const scan = (a) =>
    a.forEach((c) => {
      if (typeof c[0] === 'number') {
        w = Math.min(w, c[0])
        e = Math.max(e, c[0])
        so = Math.min(so, c[1])
        no = Math.max(no, c[1])
      } else scan(c)
    })
  scan(g.coordinates)
  const span = Math.max(e - w, no - so)
  const tol = span < 2 ? 0.0002 : Math.min(0.012, Math.max(0.0004, span / 700))
  const minArea = (tol * 3) ** 2

  const kept = []
  for (const poly of polys) {
    const rings = []
    for (let i = 0; i < poly.length; i++) {
      const simplified = simplify(poly[i], tol)
      if (simplified.length < 4) continue
      // 外环过小说明是礁石：满屏视图里只是噪点
      if (i === 0 && ringArea(poly[i]) < minArea) continue
      rings.push(simplified.map(round))
    }
    if (rings.length) kept.push(rings)
  }
  if (!kept.length) continue

  const geometry =
    kept.length === 1 && kept[0].length === 1
      ? { type: 'Polygon', coordinates: kept[0] }
      : { type: 'MultiPolygon', coordinates: kept }
  newPoints += countPoints(geometry.coordinates)
  features.push({ type: 'Feature', id, geometry })
}

features.sort((a, b) => a.id.localeCompare(b.id))
const json = JSON.stringify({ type: 'FeatureCollection', features })
writeFileSync(resolve(root, 'public/data/detail-shapes.json'), json)

console.log(`国家 ${features.length} 个，顶点 ${rawPoints} → ${newPoints}，${(json.length / 1024).toFixed(0)} KB`)
console.log(`ids: ${features.map((f) => f.id).join(' ')}`)
