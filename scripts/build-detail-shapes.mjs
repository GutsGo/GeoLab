/**
 * 生成 public/data/detail-shapes.json —— 小国的精细轮廓 + 周边邻国补丁。
 *
 * 抽卡主图会把单个国家放大到满屏。110m 国界对面积小的国家只有十来个顶点
 * （斯里兰卡 10 个、荷兰 14 个），放大后就是一个多边形色块；
 * 新加坡、马耳他、萨摩亚在 110m 里甚至没有轮廓。
 *
 * 这些国家改用 world-atlas 10m 数据重画。简化按弧段（arc）做而不是按国家做：
 * TopoJSON 里相邻国家共享弧段，对弧统一简化之后，本国轮廓和周边邻国
 * 取的是同一批坐标，渲染时边界严丝合缝（按国家各自简化必然对不上）。
 *
 * 输出两块内容：
 * - features：92 个小国自己的精细轮廓；
 * - contexts：每个小国视口范围内的邻国陆块（同一套弧段简化后，
 *   按取景范围裁剪到 canvas ± 90px 反投影 + 0.5° 余量），
 *   给 DrawMap 的邻国层用，替代和精细轮廓对不上的 110m 粗地块。
 *
 *   node scripts/build-detail-shapes.mjs
 *
 * 依赖 node_modules 里的 world-atlas（10m 原始数据 3.7MB，不进构建产物）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as topojson from 'topojson-client'
import { geoCentroid, geoMercator } from 'd3-geo'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

/** 顶点少于这个数的国家，满屏放大时都会露出多边形棱角 */
const ROUGH_THRESHOLD = 40

/** 最细档简化容差（度），也是跨 < 2° 的小国的固定档位 */
const TOL_MIN = 0.0002

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
      if (d > best && bestIdx !== i) {
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

// 只处理已收录的国家
const ids = new Set(
  ['asia', 'europe', 'africa', 'america', 'oceania'].flatMap((f) =>
    [...read(`app/data/${f}.ts`).matchAll(/id: '(\d+)'/g)].map((m) => m[1]),
  ),
)

const w110 = JSON.parse(read('public/data/countries-110m.json'))
const f110 = topojson.feature(w110, w110.objects.countries)
const map110 = new Map()
const dense110 = new Map()
for (const f of f110.features) {
  const key = String(Number.parseInt(String(f.id), 10))
  map110.set(key, f)
  dense110.set(key, countPoints(f.geometry.coordinates))
}

const w10 = JSON.parse(read('node_modules/world-atlas/countries-10m.json'))
const f10 = topojson.feature(w10, w10.objects.countries)

/* ---------- 弧段级简化 ---------- */

const { scale, translate } = w10.transform

/** 反量化：delta 编码的整数弧段 → 绝对经纬度点列 */
function decodeArcs(topology) {
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  return topology.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * sx + tx, y * sy + ty]
    })
  })
}

/** 重新量化回原始网格（简化只删点不挪点，无损），再 delta 编码 */
function encodeArcs(absArcs) {
  const [sx, sy] = scale
  const [tx, ty] = translate
  return absArcs.map((arc) => {
    let px = 0
    let py = 0
    return arc.map(([x, y]) => {
      const qx = Math.round((x - tx) / sx)
      const qy = Math.round((y - ty) / sy)
      const d = [qx - px, qy - py]
      px = qx
      py = qy
      return d
    })
  })
}

const simplifyArcs = (arcs, tol) => arcs.map((arc) => (arc.length < 3 ? arc : simplify(arc, tol)))

const decoded = decodeArcs(w10)
// 两级简化：先全局做一次最细档，各粗档在细档结果上继续删，
// 比每个容差档都全量 DP 快，结果等价（共享弧段仍共享）
const fineArcs = simplifyArcs(decoded, TOL_MIN)

const bucketCache = new Map()
/** 某一容差档的简化拓扑 + 展开好的 feature（按数值 id 索引） */
function featuresFor(bucketTol) {
  if (bucketCache.has(bucketTol)) return bucketCache.get(bucketTol)
  const arcs = encodeArcs(bucketTol <= TOL_MIN ? fineArcs : simplifyArcs(fineArcs, bucketTol))
  const topo = { type: 'Topology', transform: w10.transform, bbox: w10.bbox, objects: w10.objects, arcs }
  const fc = topojson.feature(topo, topo.objects.countries)
  const fmap = new Map()
  for (const f of fc.features) {
    if (!f.geometry) continue
    fmap.set(String(Number.parseInt(String(f.id), 10)), f)
  }
  bucketCache.set(bucketTol, fmap)
  return fmap
}

/* ---------- 自身轮廓 ---------- */

/** 过滤简化后退化成噪点的礁环；全滤光时保留原样（极小岛国不能开天窗） */
function buildSelfGeometry(geometry, tol) {
  const minArea = (tol * 3) ** 2
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const kept = []
  for (const poly of polys) {
    const rings = []
    for (let i = 0; i < poly.length; i++) {
      const ring = poly[i]
      if (ring.length < 4) continue
      if (i === 0 && ringArea(ring) < minArea) continue
      rings.push(ring.map(round))
    }
    if (rings.length) kept.push(rings)
  }
  const source = kept.length ? kept : polys.filter((p) => p[0]?.length >= 4)
  if (!source.length) return null
  return source.length === 1 && source[0].length === 1
    ? { type: 'Polygon', coordinates: source[0] }
    : { type: 'MultiPolygon', coordinates: source }
}

/* ---------- 周边邻国：按取景范围裁剪 ---------- */

/**
 * 复刻 DrawMap 的取景：小国特写在宽窄两档 fitExtent 之下，
 * 反投影 canvas ± 90px 的四角，取两档并集再放宽 0.5°。
 */
function viewBbox(frameFeat) {
  let w = Infinity
  let e = -Infinity
  let s = Infinity
  let n = -Infinity
  let c
  try {
    c = geoCentroid(frameFeat)
  } catch {
    return null
  }
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null
  const extents = [
    [
      [96, 82],
      [752, 434],
    ],
    [
      [58, 52],
      [942, 568],
    ],
  ]
  for (const extent of extents) {
    const p = geoMercator().rotate([-c[0], 0]).center([0, c[1]])
    try {
      p.fitExtent(extent, frameFeat)
    } catch {
      continue
    }
    if (!Number.isFinite(p.scale())) continue
    for (const [x, y] of [
      [-90, -90],
      [1090, -90],
      [-90, 710],
      [1090, 710],
    ]) {
      let iv
      try {
        iv = p.invert([x, y])
      } catch {
        continue
      }
      if (!iv || !Number.isFinite(iv[0]) || !Number.isFinite(iv[1])) continue
      w = Math.min(w, iv[0])
      e = Math.max(e, iv[0])
      s = Math.min(s, iv[1])
      n = Math.max(n, iv[1])
    }
  }
  if (!Number.isFinite(w) || !Number.isFinite(s)) return null
  // 跨反子午线的取景没法用矩形 bbox 表达，放弃周边补丁，运行时退回 110m
  if (e - w > 350) return null
  const pad = 0.5
  return { w: w - pad, e: e + pad, s: s - pad, n: n + pad }
}

const lerpX = (a, b, x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]
const lerpY = (a, b, y) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y]

/** Sutherland–Hodgman：把闭合环保留到矩形 bbox 内，返回开环点列（隐式闭合） */
function clipRing(ring, bb) {
  const edges = [
    [(p) => p[0] >= bb.w, (a, b) => lerpX(a, b, bb.w)],
    [(p) => p[0] <= bb.e, (a, b) => lerpX(a, b, bb.e)],
    [(p) => p[1] >= bb.s, (a, b) => lerpY(a, b, bb.s)],
    [(p) => p[1] <= bb.n, (a, b) => lerpY(a, b, bb.n)],
  ]
  let pts = ring
  for (const [keep, cross] of edges) {
    const out = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]
      const prev = pts[(i + pts.length - 1) % pts.length]
      const ck = keep(cur)
      const pk = keep(prev)
      if (ck) {
        if (!pk) out.push(cross(prev, cur))
        out.push(cur)
      } else if (pk) {
        out.push(cross(prev, cur))
      }
    }
    pts = out
    if (pts.length < 3) return []
  }
  return pts
}

/** 裁剪一个国家的几何到取景 bbox；全裁光返回 null。共享弧段的坐标不受裁剪影响 */
function clipGeometry(geometry, bb, minArea) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  const kept = []
  for (const poly of polys) {
    if (!poly.length) continue
    const outer = clipRing(poly[0], bb)
    if (outer.length < 3 || ringArea(outer) < minArea) continue
    const rings = [outer.map(round)]
    rings[0].push(rings[0][0])
    for (let i = 1; i < poly.length; i++) {
      const hole = clipRing(poly[i], bb)
      if (hole.length < 3 || ringArea(hole) <= 0) continue
      const holeRing = hole.map(round)
      holeRing.push(holeRing[0])
      rings.push(holeRing)
    }
    kept.push(rings)
  }
  if (!kept.length) return null
  return kept.length === 1 && kept[0].length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept }
}

/* ---------- 主流程 ---------- */

const patchList = []
let rawPoints = 0
for (const f of f10.features) {
  const id = String(Number.parseInt(String(f.id), 10))
  if (!ids.has(id)) continue
  if ((dense110.get(id) ?? 0) >= ROUGH_THRESHOLD) continue
  const g = f.geometry
  if (!g) continue
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
  const tol = span < 2 ? TOL_MIN : Math.min(0.012, Math.max(0.0004, span / 700))
  const bucketTol = Math.max(TOL_MIN, Math.round(tol / TOL_MIN) * TOL_MIN)
  patchList.push({ id, tol, bucketTol })
}

const features = []
const contexts = {}
let newPoints = 0
let contextPoints = 0
let contextFeatures = 0

// 按容差档分组：同档国家共用一份简化拓扑，本国与邻国共享弧段，边界必然贴合
const buckets = new Map()
for (const p of patchList) {
  if (!buckets.has(p.bucketTol)) buckets.set(p.bucketTol, [])
  buckets.get(p.bucketTol).push(p)
}

for (const [bucketTol, entries] of buckets) {
  const fmap = featuresFor(bucketTol)
  for (const { id, tol, bucketTol: bTol } of entries) {
    const selfF = fmap.get(id)
    if (!selfF) continue
    const selfGeom = buildSelfGeometry(selfF.geometry, tol)
    if (!selfGeom) continue
    newPoints += countPoints(selfGeom.coordinates)
    features.push({ type: 'Feature', id, geometry: selfGeom })

    // 周边邻国：取景以运行时的 frame（110m）为准，没有 frame 的国家运行时会退到 10m 自身
    const frameFeat = map110.get(id) ?? selfF
    const bb = viewBbox(frameFeat)
    if (!bb) continue
    const list = []
    /** (Multi)Polygon 几何合并：contexts 里台湾并入中国用 */
    const mergeGeoms = (a, b) => {
      const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
      return { type: 'MultiPolygon', coordinates: [...polysOf(a), ...polysOf(b)] }
    }
    for (const [nid, nf] of fmap) {
      // 自己单独画；台湾要素不作为独立国家出现，几何并入中国（与运行时 110m 的合并策略一致）
      const target = nid === '158' ? '156' : nid
      if (target === id) continue
      const g = clipGeometry(nf.geometry, bb, (bTol * 3) ** 2)
      if (!g) continue
      const existing = list.find((x) => x.id === target)
      if (existing) {
        existing.geometry = mergeGeoms(existing.geometry, g)
      } else {
        list.push({ id: target, geometry: g })
      }
      contextPoints += countPoints(g.coordinates)
      contextFeatures += 1
    }
    if (list.length) contexts[id] = list
  }
}

features.sort((a, b) => a.id.localeCompare(b.id))
const json = JSON.stringify({ type: 'FeatureCollection', features, contexts })
writeFileSync(resolve(root, 'public/data/detail-shapes.json'), json)

console.log(`国家 ${features.length} 个，顶点 ${rawPoints} → ${newPoints}；周边 ${contextFeatures} 块 / ${contextPoints} 顶点`)
console.log(`文件 ${(json.length / 1024).toFixed(0)} KB`)
console.log(`ids: ${features.map((f) => f.id).join(' ')}`)
