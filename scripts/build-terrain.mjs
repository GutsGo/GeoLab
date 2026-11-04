/**
 * 烘焙「微3D 地形视图」的静态数据，产物写入 public/data/：
 *   - terrain-elevation.png  2048×2048 Web Mercator 高程图（terrarium RGB 编码，单位：真实米，海洋=0）
 *   - terrain-texture.jpg    4096×4096 地表纹理（Natural Earth I 配色映射到暖纸色板 + 山体阴影）
 *   - terrain.json           元信息（bounds、夸张倍数、数据来源）
 *
 * 数据源（均为公有领域，构建期一次性下载，运行时零外部请求）：
 *   - 高程：AWS Open Data "Terrain Tiles"（terrarium 编码，SRTM/ETOPO/GEBCO 等聚合）
 *     https://registry.opendata.aws/terrain-tiles/
 *   - 地表：Natural Earth I with Shaded Relief & Water, 1:50m 栅格（naciscdn.org）
 *
 * 垂直夸张不在数据里做：高程图保留真实米，运行时经 elevationDecoder 的 scaler
 * 放大（见 app/components/TerrainMap.vue），烘焙数据与展示强度解耦。
 *
 * 用法：pnpm data:terrain
 * 可选参数：--zoom 3（瓦片层级，z3=8×8 张）、--quality 82（JPEG 质量）
 */
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { fromFile } from 'geotiff'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ---------- 参数与常量 ---------- */

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback
}

const Z = argOf('zoom', 3) // z3：8×8=64 张瓦片 → 高程 2048×2048（赤道 ≈19.6km/px）
const JPEG_QUALITY = argOf('quality', 82)
const TEX_SIZE = argOf('texsize', 4096) // 纹理分辨率独立于高程：放大后不糊的关键
const N = 1 << Z
const TILE = 256
const SIZE = N * TILE
const MERC_MAX_LAT = 85.0511287798066

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'data')
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'geolab-terrain')

const TERRARIUM_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
const NE1_ZIP_URL =
  'https://naciscdn.org/naturalearth/50m/raster/NE1_50M_SR_W.zip'

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(CACHE_DIR, { recursive: true })

/* ---------- 1. 下载并拼接高程瓦片 → Float32 高程场 ---------- */

async function fetchWithRetry(url, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      lastErr = e
      await new Promise((res) => setTimeout(res, 400 * (i + 1)))
    }
  }
  throw lastErr
}

/** 海洋瓦片可能缺失：下载失败按 0m 平海处理，不让整张图失败 */
async function fetchTileOrFlat(z, x, y) {
  try {
    const buf = await fetchWithRetry(TERRARIUM_URL(z, x, y))
    return PNG.sync.read(buf)
  } catch (e) {
    console.warn(`  ! 瓦片 ${z}/${x}/${y} 下载失败（${e.message}），按平海处理`)
    return null
  }
}

/** terrarium 解码：(R*256 + G + B/256) - 32768 米 */
function tileElevation(png, tx, ty) {
  const out = new Float32Array(TILE * TILE)
  if (!png) return out
  const { width, height, data } = png
  if (width !== TILE || height !== TILE) {
    console.warn(`  ! 瓦片 ${tx}/${ty} 尺寸异常 ${width}×${height}，按平海处理`)
    return out
  }
  const ch = data.length / (width * height)
  for (let i = 0; i < TILE * TILE; i++) {
    const r = data[i * ch]
    const g = data[i * ch + 1]
    const b = data[i * ch + 2]
    const e = r * 256 + g + b / 256 - 32768
    out[i] = e > 0 ? Math.min(e, 32767) : 0 // 负海拔（海沟/死海）拉平，教学图不需要海沟
  }
  return out
}

console.log(`[1/4] 下载 terrarium 高程瓦片 z${Z}（${N}×${N} 张）…`)
const elev = new Float32Array(SIZE * SIZE)
{
  const jobs = []
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) jobs.push({ x, y })
  const CONC = 8
  let cursor = 0
  let done = 0
  async function worker() {
    while (cursor < jobs.length) {
      const { x, y } = jobs[cursor++]
      const png = await fetchTileOrFlat(Z, x, y)
      const grid = tileElevation(png, x, y)
      const ox = x * TILE
      const oy = y * TILE
      for (let r = 0; r < TILE; r++) {
        elev.set(grid.subarray(r * TILE, (r + 1) * TILE), (oy + r) * SIZE + ox)
      }
      done++
      if (done % 16 === 0) console.log(`  ${done}/${jobs.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))
}

/* ---------- 1.5 拍平南极 ---------- */

// Mercator 在高纬度把面积拉得极大，南极冰盖的高程再经垂直夸张会变成一堵"雪墙"。
// 教学视图里南极应是平缓的白色大陆：南纬 63° 以南高程拍平为 1 米——
 // 既无起伏，又保留"陆地"身份（0 米会被纹理阶段当海水上纯色）。
const ANTARCTICA_LAT = -63
console.log(`[1.5/4] 拍平南纬 ${-ANTARCTICA_LAT}° 以南的冰盖高程 …`)
for (let py = 0; py < SIZE; py++) {
  if (mercatorToLat((py + 0.5) / SIZE) >= ANTARCTICA_LAT) continue
  elev.fill(1, py * SIZE, (py + 1) * SIZE)
}

/* ---------- 2. 高程场 → terrarium RGB 高程 PNG ---------- */

console.log('[2/4] 编码高程 PNG …')
{
  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = Math.round(elev[i]) + 32768
    rgba[i * 4] = (v >> 8) & 0xff
    rgba[i * 4 + 1] = v & 0xff
    rgba[i * 4 + 2] = 0
    rgba[i * 4 + 3] = 255
  }
  const png = PNG.sync.write({ data: rgba, width: SIZE, height: SIZE })
  fs.writeFileSync(path.join(OUT_DIR, 'terrain-elevation.png'), png)
}

/* ---------- 3. Natural Earth I → 暖纸纹理（重投影 + 色板映射 + 山体阴影） ---------- */

const NE1_TIF = path.join(CACHE_DIR, 'ne1', 'NE1_50M_SR_W', 'NE1_50M_SR_W.tif')

async function ensureNE1() {
  if (fs.existsSync(NE1_TIF)) return
  const zipPath = path.join(CACHE_DIR, 'NE1_50M_SR_W.zip')
  if (!fs.existsSync(zipPath)) {
    console.log('[3/4] 下载 Natural Earth I 50m 栅格（约 26MB，仅首次）…')
    const buf = await fetchWithRetry(NE1_ZIP_URL, 2)
    fs.writeFileSync(zipPath, buf)
  }
  const unzipDir = path.join(CACHE_DIR, 'ne1')
  fs.mkdirSync(unzipDir, { recursive: true })
  try {
    execFileSync('unzip', ['-o', zipPath, '-d', unzipDir], { stdio: 'pipe' })
  } catch {
    // unzip 缺失时退回 bsdtar（macOS 自带，同样能解 zip）
    execFileSync('tar', ['-xf', zipPath, '-C', unzipDir], { stdio: 'pipe' })
  }
  if (!fs.existsSync(NE1_TIF)) throw new Error('NE1 tif 解压失败')
}

/** 暖纸色板：锚点取自 NE1 典型生态区实测像素值（采样见构建记录），out 为目标暖纸色 */
const PALETTE = [
  { ref: [24, 61, 119], out: [210, 225, 231] }, // 深水（海面走高程掩膜，这里兜底）
  { ref: [52, 89, 149], out: [217, 229, 234] }, // 浅水
  { ref: [166, 198, 171], out: [126, 158, 96] }, // 热带雨林（亚马逊/刚果实测）
  { ref: [168, 191, 164], out: [140, 162, 106] }, // 针叶林/泰加林
  { ref: [203, 214, 178], out: [170, 184, 104] }, // 湿润平原/农田（四川盆地/华北/印度实测均落此档）
  { ref: [225, 222, 184], out: [190, 192, 126] }, // 干草原/大平原/巴西高原（橄榄绿黄，非土黄）
  { ref: [238, 234, 212], out: [224, 208, 158] }, // 亮沙沙漠（撒哈拉）
  { ref: [218, 203, 189], out: [214, 192, 156] }, // 石漠/半干旱（澳洲内陆）
  { ref: [239, 241, 242], out: [224, 220, 205] }, // 高原裸地（青藏）
  { ref: [116, 130, 121], out: [150, 142, 126] }, // 高山阴影/岩体
  { ref: [228, 234, 242], out: [243, 240, 230] }, // 冰雪（格陵兰/南极）
]

const OCEAN = [214, 228, 233]

function nearestAnchor(r, g, b) {
  let best = PALETTE[0]
  let bestD = Infinity
  for (const p of PALETTE) {
    const dr = r - p.ref[0]
    const dg = g - p.ref[1]
    const db = b - p.ref[2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

/** Web Mercator y ∈ [0,1]（顶部为北）→ 纬度 */
function mercatorToLat(my) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI
}

/** 单光源山体阴影：光来自西北（315°），仰角 45°，输出 0..1（在高程网格坐标上算） */
function hillshade(elev, size, x, y) {
  const l = elev[y * size + Math.max(x - 1, 0)]
  const r = elev[y * size + Math.min(x + 1, size - 1)]
  const t = elev[Math.max(y - 1, 0) * size + x]
  const b = elev[Math.min(y + 1, size - 1) * size + x]
  // 每像素约 19.6km，地形坡度被大幅抹平，这里做的是"视觉阴影"而非真实坡度
  const dzdx = (r - l) / 2
  const dzdy = (b - t) / 2
  const slope = Math.atan(Math.hypot(dzdx, dzdy) * 0.9)
  const aspect = Math.atan2(dzdy, -dzdx)
  const alt = Math.PI / 4
  const az = (315 * Math.PI) / 180
  const shade = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect)
  return clamp(shade, 0, 1)
}

console.log('[3/4] 重投影 + 暖纸化纹理 …')
await ensureNE1()
const tiff = await fromFile(NE1_TIF)
const image = await tiff.getImage()
const W1 = image.getWidth()
const H1 = image.getHeight()
const bands = await image.readRasters({ samples: [0, 1, 2] })
const [R1, G1, B1] = bands

function sampleNE1(sx, sy, out3) {
  const x0 = clamp(Math.floor(sx), 0, W1 - 2)
  const y0 = clamp(Math.floor(sy), 0, H1 - 2)
  const fx = clamp(sx - x0, 0, 1)
  const fy = clamp(sy - y0, 0, 1)
  for (let c = 0; c < 3; c++) {
    const band = bands[c]
    const a = band[y0 * W1 + x0]
    const b = band[y0 * W1 + x0 + 1]
    const d = band[(y0 + 1) * W1 + x0]
    const e = band[(y0 + 1) * W1 + x0 + 1]
    out3[c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy
  }
}

const texBuf = Buffer.alloc(TEX_SIZE * TEX_SIZE * 4)
const px3 = [0, 0, 0]
for (let py = 0; py < TEX_SIZE; py++) {
  const lat = mercatorToLat((py + 0.5) / TEX_SIZE)
  const sy = ((90 - lat) / 180) * H1
  // 纹理分辨率 > 高程分辨率：高程/阴影按最近邻上采样
  const ey = clamp(Math.floor(((py + 0.5) / TEX_SIZE) * SIZE), 0, SIZE - 1)
  for (let i = 0; i < TEX_SIZE; i++) {
    const o = (py * TEX_SIZE + i) * 4
    const ex = clamp(Math.floor(((i + 0.5) / TEX_SIZE) * SIZE), 0, SIZE - 1)
    const e = elev[ey * SIZE + ex]
    let r, g, b
    if (e <= 0) {
      ;[r, g, b] = OCEAN
    } else {
      const sx = ((i + 0.5) / TEX_SIZE) * W1
      sampleNE1(sx, sy, px3)
      if (px3[2] - px3[0] > 40 && px3[2] > 150) {
        // 高程为正的水面：南大洋拍平带（南极填 1m 连带海水）、大湖。
        // NE1 水面蓝色显著占优（实测 b-r≥80），冰盖只有 12~17，阈值 40 干净分开
        ;[r, g, b] = OCEAN
      } else {
        const anchor = nearestAnchor(px3[0], px3[1], px3[2])
        // 保留 NE1 的明暗起伏：按亮度比缩放锚点色，褶皱不至于被色板映射抹平
        const lSrc = lum(px3[0], px3[1], px3[2])
        const lRef = lum(...anchor.ref)
        const ratio = clamp(lSrc / Math.max(1, lRef), 0.6, 1.5)
        r = anchor.out[0] * ratio
        g = anchor.out[1] * ratio
        b = anchor.out[2] * ratio
        // 叠加自算山体阴影（弱强度，主光靠运行时 mesh 法线）
        const sh = hillshade(elev, SIZE, ex, ey)
        const m = 1 + (sh - 0.5) * 0.5
        r *= m
        g *= m
        b *= m
        // NE1 色调整体偏淡，温和提饱和让绿/黄可辨；锚点已校准，不需要猛加
        const lumOut = 0.299 * r + 0.587 * g + 0.114 * b
        const SAT = 1.3
        r = lumOut + (r - lumOut) * SAT
        g = lumOut + (g - lumOut) * SAT
        b = lumOut + (b - lumOut) * SAT
      }
    }
    texBuf[o] = clamp(r, 0, 255)
    texBuf[o + 1] = clamp(g, 0, 255)
    texBuf[o + 2] = clamp(b, 0, 255)
    texBuf[o + 3] = 255
  }
  if (py % 1024 === 0) console.log(`  行 ${py}/${TEX_SIZE}`)
}

const jpg = jpeg.encode({ data: texBuf, width: TEX_SIZE, height: TEX_SIZE }, JPEG_QUALITY)
fs.writeFileSync(path.join(OUT_DIR, 'terrain-texture.jpg'), jpg.data)

/* ---------- 4. 元信息 ---------- */

const meta = {
  size: SIZE,
  textureSize: TEX_SIZE,
  bounds: [-180, -MERC_MAX_LAT, 180, MERC_MAX_LAT],
  exaggeration: 60, // 默认垂直夸张，运行时可调
  decode: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 },
  sources: {
    elevation: 'AWS Open Data Terrain Tiles (terrarium), 聚合自 SRTM/ETOPO/GEBCO 等，公有领域',
    texture: 'Natural Earth I with Shaded Relief & Water, 1:50m, 公有领域 (naciscdn.org)',
  },
  generatedAt: new Date().toISOString(),
}
fs.writeFileSync(path.join(OUT_DIR, 'terrain.json'), JSON.stringify(meta, null, 2))

for (const f of ['terrain-elevation.png', 'terrain-texture.jpg', 'terrain.json']) {
  const { size } = fs.statSync(path.join(OUT_DIR, f))
  console.log(`  ✓ ${f}  ${(size / 1024).toFixed(0)} KB`)
}
console.log('[4/4] 完成')
