<script lang="ts">
/**
 * 模块级共享状态（真正的跨挂载缓存）：切 tab 导致组件重挂载时，
 * 高程/网格/纹理/视角全部复用，秒开且不跳变。<script setup> 里的
 * let 变量是每实例一份，起不到缓存作用——这是踩过的坑。
 */
let DeckClass: any = null
let SimpleMeshLayerClass: any = null
let PathLayerClass: any = null
let elevation: Float32Array | null = null
let features: import('~/lib/world').WorldFeature[] = []
let bboxCache: { id: string; b: [number, number, number, number] }[] = []
let baseBitmap: ImageBitmap | null = null
let texCanvas: HTMLCanvasElement | null = null

interface MeshData {
  positions: Float32Array
  normals: Float32Array
  texCoords: Float32Array
  indices: Uint32Array
}

let terrainMesh: MeshData | null = null
let hitMesh: MeshData | null = null
let textureVersion = 0
const HOVER_TEX = 1024 // hover 高亮独立小纹理边长（只重传 4MB，不动 4096 主纹理）
let hoverCanvas: HTMLCanvasElement | null = null
let hoverVersion = 0
let savedView: { longitude: number; latitude: number; zoom: number } | null = null
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { geoContains, geoPath, geoNaturalEarth1 } from 'd3-geo'
import type { Geometry } from 'geojson'
import { loadWorld, type WorldFeature } from '~/lib/world'
import { countryById } from '~/data'

/**
 * 微3D 地形视图：SimpleMeshLayer 自建高度场网格 + 动态 canvas 纹理。
 * - 高程/纹理来自 scripts/build-terrain.mjs 的烘焙产物（public/data/terrain-*）
 * - 形状与平面视图一致：网格按 Natural Earth 投影变形——顶点的真实经纬度
 *   由 NE 投影反解（用于采样高程/纹理），渲染位置用"假经纬度"（让 deck 的
 *   Mercator 布局复现 NE 形状）；拾取到假经纬度后再反解回真实经纬度
 * - 国界与目标国高亮直接画进纹理：跟着地形走，不存在多边形穿山问题
 *   （deck.gl 9.4 没有可用的 TerrainExtension，draping 方案不可行）
 * - 拾取用一层同网格的隐形"命中面"（抬高 2% 避免被地形自身遮住），
 *   bbox 粗筛 + geoContains 反查国家
 */
const props = withDefaults(
  defineProps<{
    countryId?: string
    color?: string
  }>(),
  { countryId: '', color: '#1d4ed8' },
)

const emit = defineEmits<{ (e: 'pick', id: string): void }>()

const host = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)
const error = ref('')
const hover = ref<{ x: number; y: number; name: string } | null>(null)
const flipX = ref(false)
const flipY = ref(false)

const EXAGGERATION = 60 // 垂直夸张：珠峰 ≈ 8.85km × 60，屏幕上约十几像素的起伏
const TEX = 4096 // 地表纹理边长（build-terrain.mjs 的 textureSize），决定放大清晰度

/** 与 WorldMap.vue 同款投影：Natural Earth，适配 980×520 球体（渲染形状对齐的关键） */
const NE = geoNaturalEarth1().fitExtent(
  [
    [2, 2],
    [978, 518],
  ],
  { type: 'Sphere' } as never,
)
const NE_BOUNDS = geoPath(NE).bounds({ type: 'Sphere' } as never)
const NE_X0 = NE_BOUNDS[0][0]!
const NE_Y0 = NE_BOUNDS[0][1]!
const NE_W = NE_BOUNDS[1][0]! - NE_X0
const NE_H = NE_BOUNDS[1][1]! - NE_Y0

/** NE 投影反解（d3 类型上 invert 可选，统一收口判空） */
function neInvert(px: number, py: number): [number, number] | null {
  const inv = NE.invert?.([px, py])
  if (!inv || !Number.isFinite(inv[0]) || !Number.isFinite(inv[1])) return null
  return [inv[0]!, inv[1]!]
}

/**
 * 投影平面上的点是否落在球体（NE 椭圆）内：反解再正投，经度按 ±360
 * 取最优回绕后比较距离。椭圆外 invert 会外推出 |lat|>90 的野值。
 */
function insideSphere(px: number, py: number): boolean {
  const inv = neInvert(px, py)
  if (!inv || Math.abs(inv[1]!) > 90.5) return false
  let best = Infinity
  for (const dl of [-360, 0, 360]) {
    const back = NE([inv[0]! + dl, inv[1]!])
    if (back) best = Math.min(best, Math.hypot(back[0]! - px, back[1]! - py))
  }
  return Number.isFinite(best) && best < 2
}

/** 网格分辨率：触屏/小屏减半，控制在 10 万顶点级 */
const GRID =
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 192 : 320

/* deck.gl 按需加载：切到本视图才拉 chunk（类缓存在模块级，见文件顶部） */
type DeckLike = { setProps: (p: Record<string, unknown>) => void; finalize: () => void }
let deck: DeckLike | null = null

/* 每实例的图层引用（重挂载时随 deck 一起重建） */
let hitLayer: any = null
let hoverLayer: any = null
let hoverCountryId = ''

/* 球体描边层（PathLayer，随缩放平移走） */
let borderLayer: any = null

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/* ---------- 缩放行为对齐平面视图（WorldMap.vue） ---------- */
/** 最大放大倍率与平面一致：平面视窗最窄 300/980，即约 3.27 倍 */
const MAX_ZOOM_DELTA = Math.log2(980 / 300)
/** 地图在 Mercator 归一化空间的纵向跨度（假经纬度网格的纬向占比） */
const MH = NE_H / NE_W
/** 桌面 fit 缩放（铺满容器）= 缩小下限；onMounted 里按实际容器重算 */
let fitZoom = Math.log2(980 / 512)
let hostW = 980
let hostH = 520
let animRaf = 0
let ro: ResizeObserver | null = null
const zoomed = ref(false)

/* ---------- 窄屏「滚动地球仪」：与平面视图同一套规则 ----------
 * ≤720px（同平面断点）：fit 改为铺满高度（地图横向溢出可拖）、
 * 缩放锁定、纵向手势还给页面滚动、换国家只横向居中 */
let panMode = false
let mq: MediaQueryList | null = null

/** 放大上限：窄屏锁定在 fit（平面窄屏不可缩放），桌面放开到 ~3.27 倍 */
function maxZoomNow(): number {
  return fitZoom + (panMode ? 0 : MAX_ZOOM_DELTA)
}

/** 桌面 fit = 铺满宽度；窄屏 fit = 铺满高度。取较大者，
 * 任何容器比例下都不会露出海色 letterbox */
function recomputeFit() {
  hostW = host.value?.clientWidth || 980
  hostH = host.value?.clientHeight || 520
  fitZoom = Math.max(Math.log2(hostW / 512), Math.log2(hostH / (512 * MH)))
}

/** 控制器选项：窄屏关掉双指缩放（平面窄屏无缩放），横向单指拖拽照常 */
function controllerOptions() {
  return panMode
    ? { dragRotate: false, doubleClickZoom: false, touchZoom: false }
    : { dragRotate: false, doubleClickZoom: false }
}

/** 纬度 → Mercator 归一化 y（lngLatToPixel 的 [0,1] 版本） */
function mercatorY(lat: number): number {
  return 0.5 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / (2 * Math.PI)
}

function syncZoomed() {
  zoomed.value = (savedView?.zoom ?? fitZoom) > fitZoom + 0.01
}

/**
 * 视图钳制，和平面视图同规则：平移永远拖不出地图边缘——
 * 经度循环钳制（允许跨 ±180 走最短路），纬度按地图南北缘钳制。
 * 窄屏滚动地球仪：纬度自然锁死在 0（visH == MH），只有横向可拖，
 * 缩放锁定在 fit（maxZoom == minZoom）。
 */
function clampView(vs: any) {
  const zoom = clamp(Number(vs?.zoom) || 0, fitZoom, maxZoomNow())
  const visW = hostW / (512 * 2 ** zoom) // 可见经度跨度（世界占比）
  const visH = hostH / (512 * 2 ** zoom)
  let my = mercatorY(Number(vs?.latitude) || 0)
  const lo = 0.5 - MH / 2 + visH / 2
  const hi = 0.5 + MH / 2 - visH / 2
  my = lo > hi ? 0.5 : clamp(my, lo, hi)
  let d = ((Number(vs?.longitude) || 0) + 180) / 360 - 0.5
  d -= Math.round(d) // wrap 到 [-0.5, 0.5]
  const maxD = (1 - visW) / 2
  d = maxD <= 0 ? 0 : clamp(d, -maxD, maxD)
  return { ...vs, zoom, latitude: mercatorToLat(my), longitude: (0.5 + d) * 360 - 180 }
}

function cancelAnim() {
  if (animRaf) cancelAnimationFrame(animRaf)
  animRaf = 0
}

/** 编程移动视图：立即生效（同平面 zoomBy/reset 的即时手感）。
 * 用受控 viewState prop 而不是 initialViewState——deck 的 setProps 对
 * initialViewState 有 deepEqual 短路：复位传回的值和挂载时一样，会被
 * 当成"没变"直接忽略（复位按钮失灵的根因）。viewState 无条件生效；
 * 代代价是进入受控模式后，onViewStateChange 里必须把交互状态喂回去。 */
function applyView(vs: { longitude: number; latitude: number; zoom: number }) {
  cancelAnim()
  const c = clampView(vs)
  savedView = { longitude: c.longitude, latitude: c.latitude, zoom: c.zoom }
  syncZoomed()
  deck?.setProps({
    viewState: {
      ...c,
      pitch: 0,
      bearing: 0,
      maxPitch: 0,
      minZoom: fitZoom,
      maxZoom: maxZoomNow(),
    },
  })
}

/** 以当前中心为基准按倍率缩放（factor<1 放大，>1 缩小，同平面 zoomBy） */
function zoomBy(factor: number) {
  if (!savedView) return
  applyView({ ...savedView, zoom: savedView.zoom - Math.log2(factor) })
}

function resetZoom() {
  applyView({ longitude: 0, latitude: 0, zoom: fitZoom })
}

/** 平滑移动视图（450ms ease-out，同平面 animateView）；经度自动走最短路径 */
function animateTo(target: { longitude: number; latitude: number }) {
  if (!savedView) return
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyView({ ...savedView, ...target })
    return
  }
  cancelAnim()
  let dLng = target.longitude - savedView.longitude
  dLng -= Math.round(dLng / 360) * 360
  const fromLng = savedView.longitude
  const fromLat = savedView.latitude
  const zoom = savedView.zoom
  const t0 = performance.now()
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / 450)
    const e = 1 - (1 - p) ** 3
    applyView({
      longitude: fromLng + dLng * e,
      latitude: fromLat + (target.latitude - fromLat) * e,
      zoom,
    })
    if (p < 1) animRaf = requestAnimationFrame(step)
    else animRaf = 0
  }
  animRaf = requestAnimationFrame(step)
}

/** Web Mercator y ∈ [0,1]（顶部为北）→ 纬度 */
function mercatorToLat(my: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI
}

/** 经纬度 → Mercator 布局像素坐标（size 默认主纹理边长，y 非线性） */
function lngLatToPixel(lng: number, lat: number, size = TEX): [number, number] {
  const x = ((lng + 180) / 360) * size
  const y = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * size
  return [x, y]
}

function polygonsOf(geometry: Geometry): number[][][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates as number[][][]]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as number[][][][]
  return []
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`资源加载失败：${src}`))
    img.src = src
  })
}

/** terrarium RGB 高程 PNG → Float32 米制高程场（负值拉平） */
async function decodeElevation(url: string): Promise<Float32Array> {
  const img = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建 2D 画布')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  const n = img.width * img.height
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const e = data[i * 4]! * 256 + data[i * 4 + 1]! + data[i * 4 + 2]! / 256 - 32768
    out[i] = e > 0 ? e : 0
  }
  return out
}

/* ---------- 网格构建 ---------- */

/**
 * 从 2048² 高程场构建 NE 变形网格。
 * 网格均匀切分 NE 投影平面（nx, ny），每个格点：
 *   - 真实经纬度 = NE.invert(投影坐标)  → 采样高程、定纹理坐标
 *   - 渲染位置 = 假经纬度：fakeLng = nx 线性映射；fakeLat 令 deck 的
 *     Mercator y = 压缩后的 ny。y 压缩比 = NE_H/NE_W，使渲染形状
 *     保持 NE 原始纵横比（980:520），铺满容器刚好
 */
function buildMesh(elev: Float32Array, n: number, exag: number, heightBias = 1): MeshData {
  const verts = n * n
  const positions = new Float32Array(verts * 3)
  const normals = new Float32Array(verts * 3)
  const texCoords = new Float32Array(verts * 2)
  const heights = new Float32Array(verts)
  const pxArr = new Float32Array(verts)
  const pyArr = new Float32Array(verts)
  const M_PER_PX = 40075017 / NE_W // 赤道参考的米/投影像素，仅供光照法线用
  const EW = Math.round(Math.sqrt(elev.length)) // 高程场边长（2048），独立于纹理分辨率
  const inside = new Uint8Array(verts)

  for (let j = 0; j < n; j++) {
    const ny = j / (n - 1)
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const nx = i / (n - 1)
      const px = NE_X0 + nx * NE_W
      const py = NE_Y0 + ny * NE_H
      // 球体裁切标记：NE 椭圆外的顶点不参与三角化（见下方索引发射）
      inside[k] = insideSphere(px, py) ? 1 : 0
      pxArr[k] = px
      pyArr[k] = py

      // 真实经纬度（NE 反解），极点附近 invert 可能越界，钳制到纹理范围
      const inv = neInvert(px, py)
      const lng = inv ? inv[0]! : nx * 360 - 180
      const lat = inv ? clamp(inv[1]!, -89.5, 89.5) : 90 - ny * 180
      const [tx, ty] = lngLatToPixel(lng, lat)

      // 双线性采样高程（高程场坐标 = 纹理坐标 × EW/TEX）
      const x = clamp((tx / TEX) * (EW - 1), 0, EW - 1.001)
      const y = clamp((ty / TEX) * (EW - 1), 0, EW - 1.001)
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const dyy = y - y0
      const a = elev[y0 * EW + x0]!
      const b = elev[y0 * EW + x0 + 1]!
      const c = elev[(y0 + 1) * EW + x0]!
      const d = elev[(y0 + 1) * EW + x0 + 1]!
      const h =
        (a * (1 - fx) * (1 - dyy) + b * fx * (1 - dyy) + c * (1 - fx) * dyy + d * fx * dyy) *
        exag *
        heightBias
      heights[k] = h

      // 渲染位置：假经纬度 → deck Mercator 布局复现 NE 形状
      const fakeLat = mercatorToLat(0.5 + (ny - 0.5) * (NE_H / NE_W))
      positions[k * 3] = nx * 360 - 180
      positions[k * 3 + 1] = fakeLat
      positions[k * 3 + 2] = h
      texCoords[k * 2] = tx / TEX
      texCoords[k * 2 + 1] = ty / TEX
    }
  }

  // 法线：在 NE 投影像素空间做差分（投影距离已含纬度压缩，光照够用）
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const il = Math.max(i - 1, 0)
      const ir = Math.min(i + 1, n - 1)
      const jt = Math.max(j - 1, 0)
      const jb = Math.min(j + 1, n - 1)
      const dxM = Math.max((pxArr[j * n + ir]! - pxArr[j * n + il]!) * M_PER_PX, 1)
      const dyM = Math.max((pyArr[jb * n + i]! - pyArr[jt * n + i]!) * M_PER_PX, 1)
      const dhdx = (heights[j * n + ir]! - heights[j * n + il]!) / 2 / dxM
      const dhdy = (heights[jb * n + i]! - heights[jt * n + i]!) / 2 / dyM
      const len = Math.hypot(dhdx, dhdy, 1)
      normals[k * 3] = -dhdx / len
      normals[k * 3 + 1] = -dhdy / len
      normals[k * 3 + 2] = 1 / len
    }
  }

  const indices: number[] = []
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      // 椭圆外的 quad 整个丢弃；边缘锯齿约一个格距（≈3px），
      // 容器底色即海色，视觉上无缝
      if (!(inside[a] && inside[b] && inside[c] && inside[d])) continue
      indices.push(a, c, b, b, c, d)
    }
  }

  return { positions, normals, texCoords, indices: new Uint32Array(indices) }
}

/* ---------- 纹理画布：底图 + 全量国界 + 目标国高亮 ---------- */

interface RingPart {
  pts: [number, number][]
  /** 被日界线切开：闭合边是人造的（贴纹理边缘），描边模式不画它 */
  cut: boolean
  /** 多边形含极点（南极洲）：填充需沿纹理顶/底边闭合，否则横穿地图 */
  pole: 'top' | 'bottom' | null
}

/**
 * 把环切成不跨反子午线的若干段。跨线处按连续经度插值出 ±180 边缘点，
 * 每段在自己的纹理边缘闭合。要点：
 *  - 跨线判定用经度差（紧贴 ±180° 的两点像素只差几个 px，跳变阈值会漏切）
 *  - 闭合环从第一条跨线边开始走，数组接缝不落在切割处（否则环起点会把
 *    同一块陆地切成两截，closePath 拉出横穿海洋的长斜线——俄罗斯远东 bug）
 *  - 分母退化（斐济 ring 里有 lng 恰为 ±180 的点）回退中点，防 NaN 污染路径
 */
function splitRing(ring: number[][], size: number): RingPart[] {
  const closed =
    ring.length > 2 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1]
  const pts = closed ? ring.slice(0, -1) : ring
  const n = pts.length
  if (n < 3) return []

  const isCross = (a: number[], b: number[]) => {
    const d = b[0]! - a[0]!
    return d > 180 || d < -180
  }

  let start = 0
  if (closed) {
    for (let i = 0; i < n; i++) {
      if (isCross(pts[i]!, pts[(i + 1) % n]!)) {
        start = i
        break
      }
    }
  }

  const parts: RingPart[] = []
  let cur: [number, number][] = []
  let curCut = false
  let curPole: RingPart['pole'] = null
  let prevLng = 0
  let prevLat = 0
  let hasPrev = false

  const flush = () => {
    if (cur.length > 1) parts.push({ pts: cur, cut: curCut, pole: curPole })
    cur = []
    curPole = null
  }

  const step = (p: number[]) => {
    const lng = p[0]!
    const lat = p[1]!
    const [x, y] = lngLatToPixel(lng, lat, size)
    if (hasPrev && (lng - prevLng > 180 || lng - prevLng < -180)) {
      const goLeft = lng < prevLng // 跨到 -180 侧
      const prevEdge = goLeft ? size : 0
      const nextEdge = goLeft ? 0 : size
      const edgeLng = goLeft ? 180 : -180
      const lng2 = goLeft ? lng + 360 : lng - 360
      const denom = lng2 - prevLng
      const t = Math.abs(denom) > 1e-9 ? (edgeLng - prevLng) / denom : 0.5
      const edgeY = lngLatToPixel(edgeLng, prevLat + t * (lat - prevLat), size)[1]!
      cur.push([prevEdge, edgeY])
      flush()
      // 极点包裹边（±180 同纬度且 |lat|>84）：环内部含极点，切开后
      // 的新块填充时要沿纹理边缘闭合（南极洲横贯线 bug）
      if (Math.abs(prevLat) > 84 && Math.abs(lat) > 84) {
        curPole = lat < 0 || prevLat < 0 ? 'bottom' : 'top'
      }
      cur = [[nextEdge, edgeY]]
      curCut = true
    }
    cur.push([x, y])
    prevLng = lng
    prevLat = lat
    hasPrev = true
  }

  for (let c = 0; c < n; c++) step(pts[(start + c) % n]!)

  let lastCut = curCut
  let lastPole = curPole
  if (closed) {
    // 收尾边（环的真实最后一条边）：跨线则封边，否则补上起点闭合成环
    const first = pts[start]!
    if (hasPrev && isCross([prevLng, prevLat], first)) {
      const goLeft = first[0]! < prevLng
      const prevEdge = goLeft ? size : 0
      const edgeLng = goLeft ? 180 : -180
      const lng2 = goLeft ? first[0]! + 360 : first[0]! - 360
      const denom = lng2 - prevLng
      const t = Math.abs(denom) > 1e-9 ? (edgeLng - prevLng) / denom : 0.5
      const edgeY = lngLatToPixel(edgeLng, prevLat + t * (first[1]! - prevLat), size)[1]!
      cur.push([prevEdge, edgeY])
      flush()
      cur = []
    } else {
      cur.push(lngLatToPixel(first[0]!, first[1]!, size))
    }
  }
  if (cur.length > 1) parts.push({ pts: cur, cut: lastCut, pole: lastPole })
  return parts
}

type TraceMode = 'fill' | 'stroke'

function traceFeature(ctx: CanvasRenderingContext2D, f: WorldFeature, size = TEX, mode: TraceMode = 'stroke') {
  for (const polygon of polygonsOf(f.geometry)) {
    for (const ring of polygon) {
      for (const part of splitRing(ring, size)) {
        ctx.moveTo(part.pts[0]![0]!, part.pts[0]![1]!)
        for (let i = 1; i < part.pts.length; i++) ctx.lineTo(part.pts[i]![0]!, part.pts[i]![1]!)
        if (mode === 'fill') {
          // 含极点的块沿纹理边缘绕行闭合；其余隐式直连闭合
          if (part.pole) {
            const yEdge = part.pole === 'bottom' ? size : 0
            ctx.lineTo(part.pts[part.pts.length - 1]![0]!, yEdge)
            ctx.lineTo(part.pts[0]![0]!, yEdge)
          }
          ctx.closePath()
        } else if (!part.cut) {
          // 未切割的环：闭合边是真实边界，要描
          ctx.closePath()
        }
        // 切割块：闭合边贴纹理边缘，只填不描
      }
    }
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const v = Number.parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`
}

function redrawTexture(targetId: string) {
  if (!texCanvas || !baseBitmap) return
  const ctx = texCanvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, TEX, TEX)
  ctx.drawImage(baseBitmap, 0, 0)

  // 全量国界：细暖棕线（纹理 4096，线宽同步加倍）
  ctx.strokeStyle = 'rgba(96, 86, 64, 0.6)'
  ctx.lineWidth = 2.8
  ctx.beginPath()
  for (const f of features) traceFeature(ctx, f, TEX, 'stroke')
  ctx.stroke()

  // 目标国：半透明填色 + 实线描边（填充走 fill 模式含人造闭合边，描边不含）
  const target = features.find((f) => f.id === targetId)
  if (target) {
    ctx.fillStyle = hexToRgba(props.color, 0.5)
    ctx.beginPath()
    traceFeature(ctx, target, TEX, 'fill')
    ctx.fill()
    ctx.strokeStyle = hexToRgba(props.color, 0.95)
    ctx.lineWidth = 4.8
    ctx.beginPath()
    traceFeature(ctx, target, TEX, 'stroke')
    ctx.stroke()
  }
  textureVersion++
}

/** hover 高亮纹理：透明底 + 悬停国实色形状（配合层 opacity 0.42 呈半透明） */
function redrawHover() {
  if (!hoverCanvas) return
  const ctx = hoverCanvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, HOVER_TEX, HOVER_TEX)
  const f = features.find((x) => x.id === hoverCountryId)
  if (f) {
    ctx.fillStyle = hexToRgba(props.color, 1)
    ctx.beginPath()
    traceFeature(ctx, f, HOVER_TEX, 'fill')
    ctx.fill()
    ctx.strokeStyle = hexToRgba(props.color, 1)
    ctx.lineWidth = 4
    ctx.beginPath()
    traceFeature(ctx, f, HOVER_TEX, 'stroke')
    ctx.stroke()
  }
  hoverVersion++
}

/* ---------- 国家反查：bbox 粗筛 + geoContains 精判 ---------- */

function buildBboxCache() {
  bboxCache = features.map((f) => {
    let w = 180
    let e = -180
    let s = 90
    let n2 = -90
    const walk = (ring: number[][]) => {
      for (const p of ring) {
        const lng = p[0]!
        const lat = p[1]!
        if (lng < w) w = lng
        if (lng > e) e = lng
        if (lat < s) s = lat
        if (lat > n2) n2 = lat
      }
    }
    for (const polygon of polygonsOf(f.geometry)) for (const ring of polygon) walk(ring)
    return { id: f.id, b: [w, s, e, n2] as [number, number, number, number] }
  })
}

function countryAt(lng: number, lat: number): WorldFeature | null {
  for (const { id, b } of bboxCache) {
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue
    const f = features.find((x) => x.id === id)
    if (f && geoContains(f, [lng, lat])) return f
  }
  return null
}

/** 拾取返回的是渲染用的"假经纬度"，反解变形还原真实经纬度 */
function fakeToLngLat(lng: number, lat: number): [number, number] | null {
  const nx = clamp((lng + 180) / 360, 0, 1)
  const my = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2
  const ny = clamp(0.5 + (my - 0.5) / (NE_H / NE_W), 0, 1)
  return neInvert(NE_X0 + nx * NE_W, NE_Y0 + ny * NE_H)
}

/* ---------- 交互 ---------- */

let lastHoverKey = ''

/** hover 国变化：重绘高亮小纹理并换层（id 带版本号，强制 deck 重传纹理） */
function setHoverCountry(id: string) {
  if (id === hoverCountryId) return
  hoverCountryId = id
  redrawHover()
  deck?.setProps({ layers: currentLayers() })
}

function handleHover(info: any) {
  if (!info?.coordinate) {
    hover.value = null
    setHoverCountry('')
    return
  }
  const real = fakeToLngLat(info.coordinate[0]!, info.coordinate[1]!)
  if (!real) {
    hover.value = null
    setHoverCountry('')
    return
  }
  const [lng, lat] = real
  const key = `${lng.toFixed(2)},${lat.toFixed(2)}`
  if (key === lastHoverKey) return
  lastHoverKey = key
  const f = countryAt(lng, lat)
  setHoverCountry(f?.id ?? '')
  const name = f ? countryById.get(f.id)?.name || f.name : ''
  if (!name || !host.value) {
    hover.value = null
    return
  }
  const box = host.value.getBoundingClientRect()
  const x = info.x ?? 0
  const y = info.y ?? 0
  hover.value = { x, y, name }
  flipX.value = x + 150 > box.width - 8
  flipY.value = y + 40 > box.height - 8
}

let lastClickAt = 0

function handleClick(info: any) {
  // 350ms 内第二次点击 = 双击：复位缩放且不重复点选（同平面视图语义）
  const now = performance.now()
  if (now - lastClickAt < 350) {
    lastClickAt = 0
    if (zoomed.value) resetZoom()
    return
  }
  lastClickAt = now
  if (!info?.coordinate) return
  const real = fakeToLngLat(info.coordinate[0]!, info.coordinate[1]!)
  if (!real) return
  const f = countryAt(real[0]!, real[1]!)
  if (f) emit('pick', f.id)
}

/* ---------- 图层 ---------- */

function makeTerrainLayer() {
  if (!terrainMesh || !texCanvas) return null
  // id 带上 textureVersion：重绘后 id 变化，deck 丢弃旧层换新层（canvas 内容变化它感知不到）
  return new SimpleMeshLayerClass({
    id: `terrain-mesh-${textureVersion}`,
    data: [{}],
    _instanced: false,
    mesh: {
      attributes: {
        positions: { value: terrainMesh.positions, size: 3 },
        normals: { value: terrainMesh.normals, size: 3 },
        texCoords: { value: terrainMesh.texCoords, size: 2 },
      },
      indices: { value: terrainMesh.indices, size: 1 },
    },
    texture: texCanvas,
    material: {
      ambient: 0.78,
      diffuse: 0.4,
      shininess: 0,
      specularColor: [0, 0, 0],
    },
  })
}

/** hover 高亮层：与命中面同网格（抬高 2%），纹理里只有悬停国的半透明形状 */
function makeHoverLayer() {
  if (!hitMesh || !hoverCanvas || !hoverCountryId) return null
  return new SimpleMeshLayerClass({
    id: `terrain-hover-${hoverVersion}`,
    data: [{}],
    _instanced: false,
    mesh: {
      attributes: {
        positions: { value: hitMesh.positions, size: 3 },
        texCoords: { value: hitMesh.texCoords, size: 2 },
      },
      indices: { value: hitMesh.indices, size: 1 },
    },
    texture: hoverCanvas,
    transparent: true,
    opacity: 0.42,
    pickable: false,
    material: { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] },
    parameters: { depthTest: false },
  })
}

/** 球体轮廓：投影平面逐行二分找椭圆左右沿，转假经纬度 → PathLayer 随视图缩放平移 */
function sphereOutline(): [number, number][] {
  const ROWS = 160
  const pts: [number, number][] = []
  const toFake = (px: number, py: number): [number, number] => {
    const nx = (px - NE_X0) / NE_W
    const ny = (py - NE_Y0) / NE_H
    return [nx * 360 - 180, mercatorToLat(0.5 + (ny - 0.5) * (NE_H / NE_W))]
  }
  for (let k = 0; k <= ROWS; k++) {
    const py = NE_Y0 + (k / ROWS) * NE_H
    let lo = NE_X0
    let hi = NE_X0 + NE_W / 2
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2
      if (insideSphere(mid, py)) hi = mid
      else lo = mid
    }
    pts.push(toFake(hi, py))
  }
  for (let k = ROWS; k >= 0; k--) {
    const py = NE_Y0 + (k / ROWS) * NE_H
    let lo = NE_X0 + NE_W / 2
    let hi = NE_X0 + NE_W
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2
      if (insideSphere(mid, py)) lo = mid
      else hi = mid
    }
    pts.push(toFake(lo, py))
  }
  // 顶点行（k=0）与底点行（k=ROWS）的二分会失准：椭圆在这两行与扫描线
  // 相切，切点附近 ±268px 内的点到椭圆距离都 < 2px（insideSphere 的容差），
  // 二分收敛点远离真正的极点。顶部两端是折线的首尾（PathLayer 不自动闭合）
  // 会留出巨大缺口；底部两端相邻，拉出一条切过椭圆的直弦。
  // 修法：四个端点全部钉到精确的南/北顶点，再补一个闭合点。
  const apexN = toFake(NE_X0 + NE_W / 2, NE_Y0)
  const apexS = toFake(NE_X0 + NE_W / 2, NE_Y0 + NE_H)
  pts[0] = apexN // 左扫 k=0
  pts[ROWS] = [apexS[0]!, apexS[1]!] // 左扫 k=ROWS
  pts[ROWS + 1] = [apexS[0]!, apexS[1]!] // 右扫 k=ROWS
  pts.push([apexN[0]!, apexN[1]!]) // 闭合回北顶点
  return pts
}

function makeBorderLayer() {
  if (!PathLayerClass) return null
  return new PathLayerClass({
    id: 'terrain-border',
    data: [{ path: sphereOutline() }],
    getPath: (d: any) => d.path,
    getColor: [195, 213, 219, 255], // #c3d5db，与平面视图球体描边同色
    getWidth: 1.5,
    widthUnits: 'pixels',
    pickable: false,
    parameters: { depthTest: false },
  })
}

function currentLayers(): unknown[] {
  const terrain = makeTerrainLayer()
  if (!terrain || !hitLayer) return []
  const layers: unknown[] = [terrain]
  const hover = makeHoverLayer()
  if (hover) layers.push(hover)
  layers.push(hitLayer)
  if (borderLayer) layers.push(borderLayer)
  return layers
}

/* ---------- 生命周期 ---------- */

/** 跨过 720px 断点：切换滚动地球仪/桌面模式，重算 fit 并把视图钳回合法范围 */
function onMqChange() {
  panMode = mq?.matches ?? false
  recomputeFit()
  deck?.setProps({ controller: controllerOptions() })
  if (savedView && deck) applyView(savedView)
}

onMounted(async () => {
  try {
    const [core, meshL, layersM] = await Promise.all([
      import('@deck.gl/core'),
      import('@deck.gl/mesh-layers'),
      import('@deck.gl/layers'),
    ])
    DeckClass = (core as any).Deck
    SimpleMeshLayerClass = (meshL as any).SimpleMeshLayer
    PathLayerClass = (layersM as any).PathLayer

    /* 重数据全部模块级缓存：只有首次挂载真正解码/建网格，切 tab 回来秒开 */
    if (!features.length) features = await loadWorld()
    buildBboxCache()
    if (!elevation) elevation = await decodeElevation('/data/terrain-elevation.png')

    if (!baseBitmap) {
      const baseImg = await loadImage('/data/terrain-texture.jpg')
      baseBitmap = await createImageBitmap(baseImg)
    }
    if (!texCanvas) {
      texCanvas = document.createElement('canvas')
      texCanvas.width = TEX
      texCanvas.height = TEX
    }
    redrawTexture(props.countryId)

    if (!terrainMesh) terrainMesh = buildMesh(elevation, GRID, EXAGGERATION)
    if (!hitMesh) {
      // 命中面抬高 2%：避免被地形深度挡住。高海拔区点击会有几十公里纬度偏差，
      // 但那里的国家都足够大；低海拔小国偏差趋近于零
      hitMesh = buildMesh(elevation, GRID, EXAGGERATION, 1.02)
    }

    if (!hoverCanvas) {
      hoverCanvas = document.createElement('canvas')
      hoverCanvas.width = HOVER_TEX
      hoverCanvas.height = HOVER_TEX
    }
    hoverCountryId = ''
    redrawHover()

    hitLayer = new SimpleMeshLayerClass({
      id: 'terrain-hit',
      data: [{}],
      _instanced: false,
      mesh: {
        attributes: {
          positions: { value: hitMesh.positions, size: 3 },
          texCoords: { value: hitMesh.texCoords, size: 2 },
        },
        indices: { value: hitMesh.indices, size: 1 },
      },
      getColor: [0, 0, 0, 0],
      pickable: true,
      onHover: handleHover,
      onClick: handleClick,
      parameters: { depthTest: false },
    })
    borderLayer = makeBorderLayer()

    // 窄屏断点（同平面视图的 720px）：滚动地球仪模式
    mq = matchMedia('(max-width: 720px)')
    panMode = mq.matches
    mq.addEventListener('change', onMqChange)

    // 默认比例（铺满容器）= 缩小的下限；放大上限与平面视图一致（约 3.27 倍）
    recomputeFit()
    const v = savedView
    deck = new DeckClass({
      canvas: canvasRef.value,
      views: new (core as any).MapView(),
      // 俯视平铺：pitch 0、正北朝上；重挂载时还原上次视角，不跳变
      initialViewState: {
        longitude: v?.longitude ?? 0,
        latitude: v?.latitude ?? 0,
        zoom: v?.zoom ?? fitZoom,
        pitch: 0,
        bearing: 0,
        maxPitch: 0,
        minZoom: fitZoom,
        maxZoom: maxZoomNow(),
      },
      // 禁旋转；双击留给「复位缩放」（平面视图语义），不要 deck 默认的双击放大
      controller: controllerOptions(),
      // 持续记录视角：切 tab 重挂载后原样还原（Deck 没有公开的 getViewState）
      // deck 9 的回调参数是 { viewState, viewId, interactionState } 包装；
      // 返回值会被 deck 采纳（deck.ts: onViewStateChange(params) || params.viewState），
      // 借此把平移钳制在地图边缘内——和平面视图同规则。
      // 一旦用 viewState prop 编程移动过相机（applyView），deck 进入受控模式、
      // 停止自动跟踪交互，这里必须把钳制后的状态 setProps 回去，拖拽/滚轮才生效
      onViewStateChange: (params: any) => {
        const raw = params?.viewState ?? params
        if (params?.interactionState && params.interactionState !== 'idle') cancelAnim()
        const vs = clampView(raw)
        if (vs && Number.isFinite(vs.longitude) && Number.isFinite(vs.zoom)) {
          savedView = { longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom }
          syncZoomed()
        }
        deck?.setProps({
          viewState: { ...vs, minZoom: fitZoom, maxZoom: maxZoomNow() },
        })
        return vs
      },
      layers: currentLayers(),
      getCursor: ({ isDragging }: any) => (isDragging ? 'grabbing' : 'grab'),
    }) as unknown as DeckLike

    // 容器尺寸变化（窗口缩放/旋转/侧栏增减）后重新计算 fit 并钳制视图
    if (host.value && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (!host.value) return
        recomputeFit()
        if (savedView && deck) applyView(savedView)
      })
      ro.observe(host.value)
    }

    ready.value = true
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
})

onBeforeUnmount(() => {
  // 视角已由 onViewStateChange 持续记录在 savedView；
  // 重数据（高程/网格/纹理）留在模块级缓存，重挂载秒开
  cancelAnim()
  ro?.disconnect()
  ro = null
  mq?.removeEventListener('change', onMqChange)
  mq = null
  deck?.finalize()
  deck = null
  hitLayer = null
  hoverLayer = null
  borderLayer = null
  hoverCountryId = ''
})

/** 目标国变化：重绘纹理画布 → 以新 textureVersion 重建 terrain 层（hit 层复用）；
 * 窄屏滚动地球仪横向居中，桌面缩放态水平垂直都居中（同平面视图规则） */
watch(
  () => props.countryId,
  (id) => {
    if (!deck) return
    redrawTexture(id)
    deck.setProps({ layers: currentLayers() })
    if (!savedView) return
    if (!panMode && !zoomed.value) return
    const f = features.find((x) => x.id === id)
    if (!f) return
    const c = geoPath(NE).centroid(f)
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return
    const longitude = ((c[0]! - NE_X0) / NE_W) * 360 - 180
    if (panMode) {
      // 窄屏：纬度/缩放都被钳制锁死，只需把经度送进动画
      animateTo({ longitude, latitude: savedView.latitude })
    } else {
      animateTo({
        longitude,
        latitude: mercatorToLat(0.5 + ((c[1]! - NE_Y0) / NE_H - 0.5) * MH),
      })
    }
  },
)

watch(
  () => props.color,
  () => {
    if (!deck) return
    redrawTexture(props.countryId)
    redrawHover()
    deck.setProps({ layers: currentLayers() })
  },
)
</script>

<template>
  <div ref="host" class="terrain">
    <canvas ref="canvasRef" class="terrain-canvas"></canvas>
    <div v-if="!ready && !error" class="overlay">地形数据装载中…</div>
    <div v-else-if="error" class="overlay err">{{ error }}</div>

    <!-- 缩放控制：与平面视图同款按钮、同倍率、同复位语义 -->
    <div v-if="ready && !error" class="zoom-ctl">
      <button type="button" aria-label="放大地图" @click="zoomBy(1 / 1.5)">＋</button>
      <button type="button" aria-label="缩小地图" @click="zoomBy(1.5)">－</button>
      <button v-if="zoomed" type="button" class="reset" aria-label="重置视图" @click="resetZoom">复位</button>
    </div>

    <div
      v-if="hover"
      class="tip"
      :class="{ 'flip-x': flipX, 'flip-y': flipY }"
      :style="{
        left: (flipX ? hover.x - 14 : hover.x + 14) + 'px',
        top: (flipY ? hover.y - 14 : hover.y + 14) + 'px',
      }"
    >
      {{ hover.name }}
    </div>
  </div>
</template>

<style scoped>
.terrain {
  position: relative;
  width: 100%;
  aspect-ratio: 980 / 520;
  overflow: hidden;
  background: #d6e4e9; /* 与海洋同色：网格球体裁切的边缘锯齿由此隐形 */
}

.terrain-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  letter-spacing: 0.14em;
  color: #6d7f85;
  background: rgba(235, 243, 245, 0.8);
  pointer-events: none;
}

.overlay.err {
  color: #b45309;
}

/* 缩放控制按钮：样式与平面视图 .zoom-ctl 一致 */
.zoom-ctl {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  gap: 6px;
  z-index: 5;
}

.zoom-ctl button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid #c3d5db;
  border-radius: 6px;
  background: rgba(253, 249, 238, 0.94);
  color: #191712;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 12px -6px rgba(0, 0, 0, 0.45);
}

.zoom-ctl button:hover {
  background: #fffdf7;
}

.zoom-ctl button.reset {
  width: auto;
  padding: 0 9px;
  font-size: 11px;
  letter-spacing: 0.1em;
}

.tip {
  position: absolute;
  z-index: 6;
  pointer-events: none;
  padding: 4px 9px;
  border-radius: var(--r-xs);
  background: rgba(25, 23, 18, 0.88);
  color: #fdf9ee;
  font-size: 11px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transform: translateZ(0);
  box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.6);
}

.tip.flip-x {
  transform: translateX(-100%) translateZ(0);
}

.tip.flip-y {
  transform: translateY(-100%) translateZ(0);
}

.tip.flip-x.flip-y {
  transform: translate(-100%, -100%) translateZ(0);
}

@media (max-width: 720px) {
  .terrain {
    aspect-ratio: auto;
    height: min(58vh, 460px);
  }

  /* 窄屏滚动地球仪：纵向手势还给页面滚动，横向拖拽归地图。
     mjolnir 会往 canvas 写 touch-action 内联样式，!important 才压得过 */
  .terrain-canvas {
    touch-action: pan-y !important;
  }
}
</style>
