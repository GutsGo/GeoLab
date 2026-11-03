<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { geoCentroid, geoMercator, geoPath } from 'd3-geo'
import { loadDetailShapes, loadWorld, type DetailPatch, type WorldFeature } from '~/lib/world'
import { countryById } from '~/data'
import { traceLayers } from '~/lib/shapes'
import type { CityPin } from '~/data/types'

const props = withDefaults(
  defineProps<{
    countryId?: string
    color?: string
    pins?: CityPin[]
    /** 递增即重播描绘动画 */
    animKey?: number
    focusPin?: string
    /** accent: 大洲色（抽卡）；ink: 中性墨色（答题，避免颜色泄露大洲） */
    tone?: 'accent' | 'ink'
    showPins?: boolean
    showGrid?: boolean
    showLabels?: boolean
    /** 轮廓缺失时的兜底坐标（微型国家） */
    fallback?: { lat: number; lng: number } | null
  }>(),
  {
    color: '#1d4ed8',
    animKey: 0,
    focusPin: '',
    tone: 'accent',
    showPins: true,
    showGrid: true,
    showLabels: true,
    fallback: null,
  },
)

const W = 1000
const H = 620
/** 逐段描边的节拍（毫秒） */
const SEG_DURATION = 680
const SEG_STAGGER = 52

const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const fillId = `dm-fill-${uid}`
const hatchId = `dm-hatch-${uid}`

const stroke = computed(() => (props.tone === 'ink' ? '#38311f' : props.color))
const fillTop = computed(() => (props.tone === 'ink' ? '#6a6250' : props.color))

const all = ref<WorldFeature[] | null>(null)
/** 小国的精细轮廓补丁 + 配套的邻国陆块（与轮廓同一套弧段简化，边界贴合） */
const detail = ref<DetailPatch | null>(null)
const loading = ref(true)
const error = ref('')

/** 窄屏上位置图会被隐藏，主图也就不必给它让出右下角 */
const wide = ref(true)

onMounted(async () => {
  if (typeof window !== 'undefined') {
    const mq = window.matchMedia('(min-width: 761px)')
    wide.value = mq.matches
    mq.addEventListener('change', (e) => {
      wide.value = e.matches
    })
  }
  try {
    // 110m 先到先画，不让几 MB 的小国补丁拖住大国的首帧
    all.value = await loadWorld()
    loading.value = false
    loadDetailShapes()
      .then((m) => {
        detail.value = m
      })
      // 补丁拿不到不影响主图，退回 110m 即可
      .catch(() => {})
  } catch (e) {
    error.value = (e as Error).message
    loading.value = false
  }
})

/** 110m 里的要素：负责取景（它的 bbox 不含海外领地那种极端情况） */
const frame = computed(() => all.value?.find((f) => f.id === props.countryId) ?? null)
/** 精细版几何：负责实际描绘 */
const detailed = computed(() => (props.countryId ? detail.value?.self.get(props.countryId) ?? null : null))
/** 放大主图的「小国特写」：需要更细的轮廓、比例尺和位置图 */
const smallView = computed(() => !!detailed.value)
const feat = computed(() => frame.value ?? detailed.value)
/** 描边与填充实际使用的几何 */
const geom = computed(() => detailed.value ?? frame.value)

/**
 * 微型国家的取景范围（画幅横向跨多少经度）。
 * 岛国可能方圆上千公里没有邻国，固定缩放会得到「一点 + 空白」，
 * 所以按到最近邻国的距离自适应：近的（新加坡）收着看，远的（萨摩亚）放开看。
 */
const microSpan = computed(() => {
  const m = props.fallback
  const list = all.value
  if (!m || !list) return 17
  let nearest = Number.POSITIVE_INFINITY
  for (const f of list) {
    if (f.id === props.countryId || !f.geometry) continue
    let c: [number, number]
    try {
      c = geoCentroid(f) as [number, number]
    } catch {
      continue
    }
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue
    const dLng = Math.abs(((((c[0] - m.lng) % 360) + 540) % 360) - 180)
    const dLat = Math.abs(c[1] - m.lat) * Math.cos((m.lat * Math.PI) / 180)
    const d = Math.hypot(dLng * Math.cos((m.lat * Math.PI) / 180), dLat)
    if (d < nearest) nearest = d
  }
  if (!Number.isFinite(nearest)) return 17
  // 让最近的邻国落在距中心约 30% 画宽处，视野里既有它又不至于挤到边上
  return Math.min(52, Math.max(17, nearest * 3.3))
})

const projection = computed(() => {
  const f = frame.value ?? detailed.value
  const m = props.fallback

  if (f) {
    let center: [number, number] = [0, 0]
    try {
      const c = geoCentroid(f)
      if (Number.isFinite(c[0]) && Number.isFinite(c[1])) center = c
    } catch {
      /* 保持 0,0 */
    }
    const p = geoMercator().rotate([-center[0], 0]).center([0, center[1]])
    // 小国特写的四角要留白给注记、比例尺和位置图
    try {
      p.fitExtent(
        smallView.value && wide.value
          ? [
              [96, 82],
              [W - 96 - 152, H - 82 - 104],
            ]
          : [
              [58, 52],
              [W - 58, H - 52],
            ],
        f,
      )
      if (!Number.isFinite(p.scale())) throw new Error('bad scale')
    } catch {
      p.scale(H * 1.3).translate([W / 2, H / 2])
    }
    return p
  }

  if (!m) return null
  // 微型国家没有轮廓：按 microSpan 取景，配合周边国家做位置参照
  return geoMercator()
    .rotate([-m.lng, 0])
    .center([0, m.lat])
    .scale((W * (180 / Math.PI)) / microSpan.value)
    .translate([W / 2, H / 2])
})

const path = computed(() => (projection.value ? geoPath(projection.value) : null))
const shape = computed(() => {
  const p = path.value
  const f = geom.value
  if (!p || !f) return ''
  return p(f) ?? ''
})

const layers = computed(() => traceLayers(shape.value, 14))

/** 描边总时长，用来排「填充渐入 → 城市点冒出」的先后 */
const traceTotal = computed(() => {
  const n = Math.max(layers.value.head.length, 1)
  return (n - 1) * SEG_STAGGER + SEG_DURATION
})
const fillDelay = computed(() => Math.round(traceTotal.value * 0.72))
const pinDelay = computed(() => fillDelay.value + 260)

/** 城市点在填充渐入后整体浮现：同刻出现，不逐个蹦 */
const pinPoints = computed(() => {
  const p = projection.value
  if (!p || !props.showPins || !props.pins) return []
  return props.pins
    .map((c) => {
      const xy = p([c.lng, c.lat])
      if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null
      return { ...c, x: xy[0], y: xy[1], active: c.name === props.focusPin, delay: pinDelay.value }
    })
    .filter((x): x is CityPin & { x: number; y: number; active: boolean; delay: number } => !!x)
})

/** 城市名互相避让：默认压在点上方，撞车就翻到下方，再撞就不标了 */
const pinLabels = computed(() =>
  pinPoints.value
    .slice(0, 6)
    .reduce<{ name: string; x: number; y: number; active: boolean; delay: number; ly: number }[]>((acc, p) => {
      // 两点贴得太近时（瓦莱塔/斯利马隔 1 km、海牙/鹿特丹隔 20 km），
      // 一个标签宽度就盖住两个点，标最近的那个即可
      if (acc.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 30)) return acc
      const clash = (y: number) => acc.some((q) => Math.abs(q.x - p.x) < 58 && Math.abs(q.ly - y) < 22)
      let ly = p.y - 12
      if (clash(ly)) ly = p.y + 24
      if (clash(ly)) return acc
      acc.push({ name: p.name, x: p.x, y: p.y, active: p.active, delay: p.delay, ly })
      return acc
    }, []),
)

/** 全画幅经纬网：真实经纬坐标投影成线，铺满整个可视区（陆地会被邻国地块自然盖住） */
const graticule = computed(() => {
  const p = projection.value
  if (!p || !props.showGrid) return []

  const pxPerDeg = (p.scale() * Math.PI) / 180
  if (!Number.isFinite(pxPerDeg) || pxPerDeg <= 0) return []
  const steps = [30, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1]
  const step = steps.find((s) => s <= 84 / pxPerDeg) ?? 0.1

  // 画布四角反投影回经纬度，得到整幅可视区的经纬范围
  const corners = [
    p.invert?.([0, 0]),
    p.invert?.([W, 0]),
    p.invert?.([0, H]),
    p.invert?.([W, H]),
  ] as ([number, number] | undefined)[]
  if (corners.some((c) => !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]))) return []
  const lngs = corners.map((c) => c![0])
  const lats = corners.map((c) => c![1])
  const w = Math.min(...lngs)
  const e = Math.max(...lngs)
  const s = Math.min(...lats)
  const n = Math.max(...lats)
  // 反投影跨了反子午线（正常取景不会发生），保守放弃
  if (e - w > 180) return []

  const lines: { d: string; major: boolean }[] = []
  const build = (pts: [number, number][]) => {
    if (pts.length < 2) return ''
    return 'M' + pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')
  }

  const lngFrom = Math.floor(w / step) * step
  const latFrom = Math.max(-84, Math.floor(s / step) * step)
  const latTo = Math.min(84, n)
  const sampleLat = Math.max(step / 4, (latTo - latFrom) / 60)
  const sampleLng = Math.max(step / 4, (e - w) / 60)

  for (let lng = lngFrom; lng <= e && lines.length < 34; lng += step) {
    const pts: [number, number][] = []
    for (let lat = latFrom; lat <= latTo; lat += sampleLat) {
      const xy = p([lng, lat])
      if (xy && Number.isFinite(xy[0])) pts.push(xy as [number, number])
    }
    const d = build(pts)
    if (d) lines.push({ d, major: Math.abs(lng % (step * 5)) < 1e-6 })
  }
  for (let lat = latFrom; lat <= latTo && lines.length < 34; lat += step) {
    const pts: [number, number][] = []
    for (let lng = w; lng <= e; lng += sampleLng) {
      const xy = p([lng, lat])
      if (xy && Number.isFinite(xy[0])) pts.push(xy as [number, number])
    }
    const d = build(pts)
    if (d) lines.push({ d, major: Math.abs(lat) < 1e-6 })
  }
  return lines
})

/** 数据里没有轮廓的微型国家：退化成中心圆点 */
const microDot = computed(() => {
  if (shape.value || !projection.value) return null
  return { x: W / 2, y: H / 2 }
})

/**
 * 图例注记。抽卡视图给出国名与面积，答题视图一律留空，避免泄题。
 * 点状符号兜底时压在圆心下方；有真实轮廓时挪到左下角，别盖住岛形。
 */
const caption = computed(() => {
  if (!microDot.value && !smallView.value) return null
  const c = props.countryId ? countryById.get(props.countryId) : null
  const name = props.showLabels && c ? c.name : ''
  const area = props.showLabels && c ? c.area : ''
  return {
    line: name && area ? `${name} · ${area}` : '',
    note: microDot.value ? '点状符号标示 · 非按比例' : '',
    corner: !microDot.value,
  }
})

/** 微型国家地图的比例尺：海域国家画面本来就空，有根尺子才像地图 */
const microScaleBar = computed(() => {
  if (!microDot.value && !smallView.value) return null
  const p = projection.value
  if (!p) return null
  const pxPerDeg = (p.scale() * Math.PI) / 180
  if (!Number.isFinite(pxPerDeg) || pxPerDeg <= 0) return null
  // 赤道附近 1° 约 111.32 km；画幅中纬度用 cos 修正
  let lat = props.fallback?.lat ?? 0
  if (feat.value) {
    try {
      const c = geoCentroid(feat.value)
      if (Number.isFinite(c[1])) lat = c[1]
    } catch {
      /* 用 fallback */
    }
  }
  const kmPerPx = (111.32 * Math.cos((lat * Math.PI) / 180)) / pxPerDeg
  if (!Number.isFinite(kmPerPx) || kmPerPx <= 0) return null
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
  const fits = steps.filter((v) => v / kmPerPx >= 80 && v / kmPerPx <= 230)
  // 取最接近 150px 的整数档，几根尺子在不同国家之间看起来才一致
  const km = fits.length
    ? fits.reduce((a, b) => (Math.abs(b / kmPerPx - 150) < Math.abs(a / kmPerPx - 150) ? b : a))
    : steps[steps.length - 1]!
  const px = km / kmPerPx
  const label = km >= 1000 ? `${km / 1000} 000 km` : `${km} km`
  return { px, label: label.replace(' 000 000', ' 000') }
})

/**
 * 周边陆块：视口内能看到的邻国都画出来，海（背景色）和陆（邻国）才有区分。
 * 有补丁的国家用 10m 邻国陆块（与本国轮廓同一套弧段简化，边界严丝合缝，
 * 缝隙不会漏出海色背景）；没有补丁的退回 110m 粗地块 + 自己垫底补缝。
 */
function buildContextShapes() {
  const p = path.value
  const proj = projection.value
  if (!p || !proj) return []

  const patchList = detail.value ? detail.value.contexts.get(props.countryId ?? '') ?? null : null
  const usePatch = !!patchList
  const list: WorldFeature[] = patchList ?? all.value ?? []
  if (!list.length) return []

  // 用视口四角反投影得到当前可见的经纬范围，比猜一个固定度数靠谱
  const corners = [
    [-40, -40],
    [W + 40, -40],
    [-40, H + 40],
    [W + 40, H + 40],
  ]
    .map((xy) => {
      try {
        return proj.invert?.(xy as [number, number]) as [number, number] | null
      } catch {
        return null
      }
    })
    .filter((v): v is [number, number] => !!v && Number.isFinite(v[0]) && Number.isFinite(v[1]))
  if (!corners.length) return []
  const lngs = corners.map((c) => c[0])
  const lats = corners.map((c) => c[1])
  const box = {
    w: Math.min(...lngs),
    e: Math.max(...lngs),
    s: Math.min(...lats),
    n: Math.max(...lats),
  }
  const midLng = (box.w + box.e) / 2
  const midLat = (box.n + box.s) / 2
  // 这一步只是粗筛（省掉给 176 个国家算 bounds 的开销），
  // 真正决定画不画的是下一步与画布求交，所以范围宁可放宽。
  const reachLng = Math.max(12, (box.e - box.w) * 2)
  const reachLat = Math.max(12, (box.n - box.s) * 2)

  // 只保留视口附近的要素：既避免把全球 176 个要素塞进 SVG，
  // 也避免跨 180° 经线的国家被投影成横贯画面的怪形。
  const near = (f: WorldFeature) => {
    let c: [number, number]
    try {
      c = geoCentroid(f) as [number, number]
    } catch {
      return false
    }
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return false
    const dLng = Math.abs(((((c[0] - midLng) % 360) + 540) % 360) - 180)
    return dLng < reachLng && Math.abs(c[1] - midLat) < reachLat
  }

  /**
   * 名字挂在「离画面中心最近、且确实出现在画面里的那块陆地」上。
   * 用最大陆块会把马来西亚的名字甩到加里曼丹，用整国重心又会飘进南海。
   */
  const landAnchor = (f: WorldFeature): [number, number] | null => {
    const g = f.geometry
    const polys: number[][][][] =
      g?.type === 'Polygon'
        ? [g.coordinates as number[][][]]
        : g?.type === 'MultiPolygon'
          ? (g.coordinates as number[][][][])
          : []
    const cx = W / 2
    const cy = H / 2
    let best: [number, number] | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const poly of polys) {
      const one = { type: 'Feature', geometry: { type: 'Polygon', coordinates: poly }, properties: {} } as WorldFeature
      let bb: [[number, number], [number, number]]
      try {
        bb = p!.bounds(one) as [[number, number], [number, number]]
      } catch {
        continue
      }
      const [[x0, y0], [x1, y1]] = bb
      if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue
      // 与画面重叠够多才算「出现在画面里的那块」；
      // 门槛按面积而不是单边长度，否则斐济这种细长小岛会被判成不可标注
      const visW = Math.min(x1, W) - Math.max(x0, 0)
      const visH = Math.min(y1, H) - Math.max(y0, 0)
      if (visW < 6 || visH < 6 || visW * visH < 300) continue
      const c = p!.centroid(one)
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue
      const score = Math.hypot(c[0] - cx, c[1] - cy)
      if (score < bestScore) {
        bestScore = score
        best = c as [number, number]
      }
    }
    return best
  }

  type Box = { x0: number; y0: number; x1: number; y1: number }
  const pad = 70
  const view: Box = { x0: -pad, y0: -pad, x1: W + pad, y1: H + pad }

  // 110m 的陆地 Union 是无缝拼贴的，但主形状用的是 10m 精细几何，
  // 两者边界不重合，缝隙里会露出海色背景（内陆国尤其扎眼）。
  // 所以走 110m 兜底路径时，把自己的 110m 形状也垫进邻国层：
  // 它与邻国严丝合缝，缝被填成陆色；多出的部分会被上层 10m 填充盖住。
  // （有 10m 邻国补丁时不需要垫：邻国与本国轮廓由同源弧段生成，本就没有缝。）
  // 但垫层只对有陆上邻国的国家有意义——岛国垫了只会把 110m 的粗糙海岸
  // 露在 10m 轮廓外变成米色毛边（斐济、福克兰），所以先做一次 bbox 邻接检测。
  let padSelf = false
  if (!usePatch && detailed.value && frame.value) {
    let selfBb: [[number, number], [number, number]] | null = null
    try {
      selfBb = p.bounds(frame.value) as [[number, number], [number, number]]
    } catch {
      selfBb = null
    }
    if (selfBb) {
      const [sx0, sy0] = selfBb[0]
      const [sx1, sy1] = selfBb[1]
      const gap = 3 // px：贴到这个距离内才算陆上邻国
      padSelf = list.some((f) => {
        if (f.id === props.countryId) return false
        let bb: [[number, number], [number, number]]
        try {
          bb = p.bounds(f) as [[number, number], [number, number]]
        } catch {
          return false
        }
        const [[x0, y0], [x1, y1]] = bb
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) return false
        return x0 <= sx1 + gap && x1 >= sx0 - gap && y0 <= sy1 + gap && y1 >= sy0 - gap
      })
    }
  }

  const items: { id: string; d: string; visible: Box; anchor: [number, number] | null }[] = []
  for (const f of list) {
    const isSelf = f.id === props.countryId
    if (isSelf && !padSelf) continue
    if (!near(f)) continue
    const d = p(f) ?? ''
    if (d.length <= 24) continue
    let bb: [[number, number], [number, number]]
    try {
      bb = p.bounds(f) as [[number, number], [number, number]]
    } catch {
      continue
    }
    const [[x0, y0], [x1, y1]] = bb
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue
    const visible = {
      x0: Math.max(x0, view.x0),
      y0: Math.max(y0, view.y0),
      x1: Math.min(x1, view.x1),
      y1: Math.min(y1, view.y1),
    }
    // 小国视图里邻国只会露出一条边，按面积判而不是按边长
    const vw = visible.x1 - visible.x0
    const vh = visible.y1 - visible.y0
    if (vw < 6 || vh < 6 || vw * vh < 320) continue
    // 自己只是垫底的陆色，不参与标注
    items.push({ id: f.id, d, visible, anchor: props.showLabels && !isSelf ? landAnchor(f) : null })
  }

  // 标注互相避让，避免小国名字糊成一团
  const placed: { x: number; y: number }[] = []
  const out = items.map((it) => ({ ...it, label: null as { x: number; y: number; text: string } | null }))
  const ordered = [...out].sort(
    (a, b) =>
      (b.visible.x1 - b.visible.x0) * (b.visible.y1 - b.visible.y0) -
      (a.visible.x1 - a.visible.x0) * (a.visible.y1 - a.visible.y0),
  )
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
  // 中心注记块 + 左下角比例尺区，都不许放邻国名字
  const hitsCaption = (x: number, y: number) =>
    (Math.abs(x - W / 2) < 176 && y > H / 2 + 34 && y < H / 2 + 96) || (x < 300 && y > H - 88)
  const hitsPlaced = (x: number, y: number) =>
    placed.some((q) => Math.abs(q.x - x) < 86 && Math.abs(q.y - y) < 26)

  for (const it of ordered.slice(0, 8)) {
    if (!it.anchor) continue
    // 重心跑到画外时（大国的重心常在可视区外）沿边贴住，仍落在自己那块陆地上
    const x = clamp(it.anchor[0], 52, W - 52)
    const baseY = clamp(it.anchor[1], 42, H - 28)
    if (Math.hypot(x - W / 2, baseY - H / 2) < 92) continue
    const text = countryById.get(it.id)?.name ?? ''
    if (!text) continue
    // 撞上中心注记或别的名字时，上下各挪一次再决定要不要放弃
    const spot = [0, 34, -34, 62, -60]
      .map((dy) => ({ x, y: clamp(baseY + dy, 42, H - 28) }))
      .find((q) => !hitsCaption(q.x, q.y) && !hitsPlaced(q.x, q.y))
    if (!spot) continue
    placed.push(spot)
    it.label = { x: spot.x, y: spot.y, text }
  }
  return out
}

/**
 * 邻国层节流，两招：
 * 1) 结果按「国家 ID + 视口宽度 + 精细数据是否就位」做 LRU 缓存，
 *    按 ← 回退或重复抽到同一国家时直接命中，零计算；
 * 2) 连续快抽时先不渲染邻国（defer 150ms），让主图描边动画独占首帧，
 *    邻国随后自行淡入——它是配角，不值得抢主图的启动时间。
 * 缓存键必须把 detail 就位状态算进去：小国的精细补丁是异步到达的，
 * 到位后投影会变，同 key 的旧缓存就是错的海岸线。
 */
const CTX_CACHE_MAX = 32
const contextCache = new Map<string, ReturnType<typeof buildContextShapes>>()
const ctxDeferred = ref(false)
let ctxDeferTimer: ReturnType<typeof setTimeout> | null = null

watch([() => props.countryId, () => props.animKey], () => {
  ctxDeferred.value = true
  if (ctxDeferTimer) clearTimeout(ctxDeferTimer)
  ctxDeferTimer = setTimeout(() => (ctxDeferred.value = false), 150)
})

onBeforeUnmount(() => {
  if (ctxDeferTimer) clearTimeout(ctxDeferTimer)
})

const contextShapes = computed(() => {
  if (ctxDeferred.value) return []
  const key = `${props.countryId ?? ''}|${wide.value ? 1 : 0}|${detail.value ? 1 : 0}`
  const hit = contextCache.get(key)
  if (hit) {
    // 重新插入实现 LRU 的「触碰移到队尾」
    contextCache.delete(key)
    contextCache.set(key, hit)
    return hit
  }
  const built = buildContextShapes()
  contextCache.set(key, built)
  if (contextCache.size > CTX_CACHE_MAX) {
    const oldest = contextCache.keys().next().value
    if (oldest !== undefined) contextCache.delete(oldest)
  }
  return built
})

/**
 * 右下角的「位置」小图。
 * 把一座岛放大到满是很好，但放大之后就不知道它在哪了，
 * 所以旁边配一张 26° 见方的区域图：邻国做浅色参照，本国用一个定位环标出。
 */
const INSET = { x: W - 28 - 208, y: H - 26 - 138, w: 208, h: 138 }
const clipId = `dm-clip-${uid}`

const inset = computed(() => {
  // 答题视图给位置图等于报答案，只让抽卡视图看
  if (!smallView.value || !props.showLabels) return null
  const f = frame.value ?? detailed.value
  const list = all.value
  if (!f || !list) return null
  let c: [number, number] = [0, 0]
  try {
    c = geoCentroid(f) as [number, number]
  } catch {
    return null
  }
  if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null

  const span = 26
  const p = geoMercator()
    .rotate([-c[0], 0])
    .center([0, c[1]])
    .scale(((INSET.w - 14) * (180 / Math.PI)) / span)
    .translate([INSET.x + INSET.w / 2, INSET.y + INSET.h / 2])
  const gp = geoPath(p)

  const lands: { id: string; d: string }[] = []
  for (const x of list) {
    if (x.id === props.countryId) continue
    let bb: [[number, number], [number, number]]
    try {
      bb = gp.bounds(x) as [[number, number], [number, number]]
    } catch {
      continue
    }
    const [[x0, y0], [x1, y1]] = bb
    // 完全在框外的国家不参与，省掉投影和超长 path
    if (x1 < INSET.x - 12 || x0 > INSET.x + INSET.w + 12) continue
    if (y1 < INSET.y - 12 || y0 > INSET.y + INSET.h + 12) continue
    const d = gp(x) ?? ''
    if (d.length > 8) lands.push({ id: x.id, d })
  }

  const home = gp(f) ?? ''
  const mark = p(c)
  if (!mark || !Number.isFinite(mark[0])) return null
  return { lands, home, mark: mark as [number, number] }
})

const contextLabels = computed(() =>
  contextShapes.value.flatMap((s) => (s.label ? [{ id: s.id, ...s.label }] : [])),
)
</script>

<template>
  <div class="dmap" :data-tone="tone">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" class="dmap-svg" role="img">
      <defs>
        <linearGradient :id="fillId" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" :stop-color="fillTop" stop-opacity="0.95" />
          <stop offset="100%" :stop-color="fillTop" stop-opacity="0.62" />
        </linearGradient>
        <pattern :id="hatchId" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="7" :stroke="stroke" stroke-opacity="0.16" stroke-width="1.6" />
        </pattern>
      </defs>

      <!-- 重新抽取时整体重建，动画才会重播 -->
      <g :key="animKey">
        <!-- 微型国家的周边参照 -->
        <g v-if="contextShapes.length" class="ctx">
          <path v-for="s in contextShapes" :key="'c' + s.id" :d="s.d" />
        </g>
        <!-- 经纬网压在邻国地块之上：周边大陆也见网格；主体填充半透明，线会隐约透出，像蒙了层玻璃 -->
        <g v-for="(g, i) in graticule" :key="'g' + i">
          <path
            :d="g.d"
            fill="none"
            :stroke="g.major ? '#b9c9cd' : '#cfdde1'"
            :stroke-width="g.major ? 0.8 : 0.6"
            stroke-dasharray="3 6"
          />
        </g>
        <g v-if="contextLabels.length" class="ctx-label">
          <text v-for="l in contextLabels" :key="'cl' + l.id" :x="l.x" :y="l.y" text-anchor="middle">
            {{ l.text }}
          </text>
        </g>
        <!-- 逐段描边：每段用自己的 time-line，形成"一条一条连起来"的书写感 -->
        <path
          v-for="(d, i) in layers.head"
          :key="'h' + i"
          :d="d"
          pathLength="1"
          class="trace"
          :class="{ main: i === 0 }"
          :stroke="stroke"
          :style="{ '--delay': i * SEG_STAGGER + 'ms', '--dur': SEG_DURATION + 'ms' }"
        />
        <path
          v-if="layers.tail"
          :d="layers.tail"
          pathLength="1"
          class="trace tail"
          :stroke="stroke"
          :style="{
            '--delay': Math.min(layers.head.length, 7) * SEG_STAGGER + 'ms',
            '--dur': Math.max(SEG_DURATION, traceTotal - 7 * SEG_STAGGER) + 'ms',
          }"
        />

        <!-- 填充在描完轮廓后淡入 -->
        <path
          v-if="shape"
          :d="shape"
          class="fill"
          :fill="`url(#${hatchId})`"
          :style="{ '--delay': fillDelay + 'ms' }"
        />
        <path
          v-if="shape"
          :d="shape"
          class="fill soft"
          :fill="`url(#${fillId})`"
          :style="{ '--delay': fillDelay + 'ms' }"
        />
        <path
          v-if="shape"
          :d="shape"
          class="outline"
          fill="none"
          :stroke="stroke"
          :style="{ '--delay': fillDelay + 'ms' }"
        />

        <g v-if="microDot" class="micro">
          <circle r="58" :cx="microDot.x" :cy="microDot.y" :stroke="stroke" fill="none" stroke-opacity="0.3" stroke-dasharray="2 7" />
          <circle :cx="microDot.x" :cy="microDot.y" r="30" :fill="stroke" fill-opacity="0.1" />
          <circle :cx="microDot.x" :cy="microDot.y" r="11" :fill="stroke" stroke="#fffdf7" stroke-width="2.6" />
          <text
            v-if="caption?.line"
            :x="microDot.x"
            :y="microDot.y + 58"
            class="micro-name"
            text-anchor="middle"
          >
            {{ caption.line }}
          </text>
          <text
            v-if="caption?.note"
            :x="microDot.x"
            :y="microDot.y + (caption.line ? 78 : 64)"
            class="micro-cap"
            text-anchor="middle"
          >
            {{ caption.note }}
          </text>
        </g>

        <!-- 有真实轮廓的微型国：注记挪到左下角，别压住岛形 -->
        <g v-if="caption?.corner && caption.line" class="corner-cap">
          <text :x="46" :y="H - 86" class="micro-name">{{ caption.line }}</text>
          <text :x="46" :y="H - 66" class="micro-cap">按实际海岸线描绘</text>
        </g>

        <!-- 比例尺：海域国家的画面里没有参照物，一根尺子能兜住"这是地图"这件事 -->
        <g v-if="microScaleBar" class="scalebar">
          <line :x1="46" :y1="H - 28" :x2="46 + microScaleBar.px" :y2="H - 28" :stroke="stroke" stroke-opacity="0.6" stroke-width="1.4" />
          <line :x1="46" :y1="H - 34" :x2="46" :y2="H - 22" :stroke="stroke" stroke-opacity="0.6" stroke-width="1.4" />
          <line :x1="46 + microScaleBar.px" :y1="H - 34" :x2="46 + microScaleBar.px" :y2="H - 22" :stroke="stroke" stroke-opacity="0.6" stroke-width="1.4" />
          <text :x="46" :y="H - 42" class="scale-label">{{ microScaleBar.label }}</text>
        </g>

        <!-- 微型国家只用中心圆点表示，城市点会和圆点重叠，干脆不画 -->
        <template v-if="!microDot">
          <g v-for="(p, i) in pinPoints" :key="'p' + p.name + i" class="pin" :style="{ '--delay': p.delay + 'ms' }">
            <template v-if="p.active">
              <circle :cx="p.x" :cy="p.y" r="11" :fill="stroke" fill-opacity="0.12" />
              <circle :cx="p.x" :cy="p.y" r="4.4" :fill="stroke" stroke="#fffdf7" stroke-width="1.8" />
            </template>
            <template v-else-if="p.capital">
              <circle :cx="p.x" :cy="p.y" r="3.2" :fill="stroke" stroke="#fffdf7" stroke-width="1.4" />
            </template>
            <template v-else>
              <circle :cx="p.x" :cy="p.y" r="2.8" fill="#fffdf7" :stroke="stroke" stroke-opacity="0.5" stroke-width="1.3" />
            </template>
          </g>
        </template>

        <g v-if="showLabels && !microDot">
          <text
            v-for="(p, i) in pinLabels"
            :key="'t' + p.name + i"
            :x="p.x"
            :y="p.ly"
            class="pin-label"
            :class="{ strong: p.active }"
            text-anchor="middle"
            :style="{ '--delay': p.delay + 'ms' }"
          >
            {{ p.name }}
          </text>
        </g>
      </g>

      <!-- 位置小图：放大之后就不知道它在哪了，用一张区域图补上 -->
      <g v-if="inset" class="inset">
        <defs>
          <clipPath :id="clipId">
            <rect :x="INSET.x" :y="INSET.y" :width="INSET.w" :height="INSET.h" rx="10" />
          </clipPath>
        </defs>
        <rect :x="INSET.x" :y="INSET.y" :width="INSET.w" :height="INSET.h" rx="10" class="inset-bg" />
        <g :clip-path="`url(#${clipId})`">
          <path v-for="l in inset.lands" :key="'i' + l.id" :d="l.d" class="inset-land" />
          <path v-if="inset.home" :d="inset.home" class="inset-home" :fill="stroke" />
        </g>
        <rect :x="INSET.x" :y="INSET.y" :width="INSET.w" :height="INSET.h" rx="10" class="inset-frame" />
        <circle :cx="inset.mark[0]" :cy="inset.mark[1]" r="7.5" class="inset-ring" :stroke="stroke" />
        <circle :cx="inset.mark[0]" :cy="inset.mark[1]" r="2.2" :fill="stroke" />
        <text :x="INSET.x + 12" :y="INSET.y + 19" class="inset-title">位置</text>
      </g>
    </svg>

    <div v-if="loading" class="state">轮廓装载中…</div>
    <div v-else-if="error" class="state err">{{ error }}</div>
  </div>
</template>

<style scoped>
.dmap {
  position: relative;
  width: 100%;
  aspect-ratio: 1000 / 620;
  overflow: hidden;
  /* 海面。陆块由 contextShapes 用纸色画出，岛国与内陆国因此可辨 */
  background:
    radial-gradient(120% 90% at 50% 8%, #f0f6f7 0%, #e6eff1 46%, #dae8ec 100%);
}

.dmap-svg {
  display: block;
  width: 100%;
  height: 100%;
  position: relative;
  z-index: 1;
}

/* ---------- 逐段描绘 ---------- */
.trace {
  fill: none;
  stroke-width: 2;
  stroke-linecap: butt;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: trace var(--dur, 700ms) cubic-bezier(0.55, 0.02, 0.35, 1) forwards;
  animation-delay: var(--delay, 0ms);
  vector-effect: non-scaling-stroke;
}

.trace.main {
  stroke-width: 2.6;
}

.trace.tail {
  stroke-width: 1.4;
  opacity: 0.75;
}

@keyframes trace {
  to {
    stroke-dashoffset: 0;
  }
}

/* ---------- 填充 ---------- */
.fill {
  opacity: 0;
  animation: fadeUp 620ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--delay, 0ms);
  transform-origin: center;
  transform: scale(1.03);
}

.fill.soft {
  mix-blend-mode: multiply;
  opacity: 0;
}

.outline {
  stroke-width: 1.1;
  stroke-opacity: 0.55;
  opacity: 0;
  animation: fadeIn 500ms ease forwards;
  animation-delay: var(--delay, 0ms);
  vector-effect: non-scaling-stroke;
}

@keyframes fadeUp {
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes fadeIn {
  to {
    opacity: 1;
  }
}

/* ---------- 城市点：整体淡入，不做位移 ---------- */
.pin,
.pin-label {
  opacity: 0;
  animation: fadeIn 560ms ease-out forwards;
  animation-delay: var(--delay, 0ms);
}

.pin-label {
  font-size: 11px;
  letter-spacing: 0.04em;
  font-family: -apple-system, 'PingFang SC', sans-serif;
  fill: #5f5744;
  paint-order: stroke;
  stroke: #fffdf8;
  stroke-width: 3px;
  stroke-linejoin: round;
}

.pin-label.strong {
  font-size: 12.5px;
  font-weight: 700;
  fill: #191712;
}

.micro {
  opacity: 0;
  animation: fadeIn 500ms ease forwards;
  animation-delay: 120ms;
}

.ctx path {
  /* 邻国只是位置参照，压得太重会喧宾夺主；110m 的粗边也就没那么扎眼 */
  fill: #f3eddf;
  stroke: #e2dac7;
  stroke-width: 0.7;
  vector-effect: non-scaling-stroke;
  opacity: 0;
  animation: fadeIn 600ms ease forwards;
  animation-delay: 80ms;
}

.inset-bg {
  fill: #fdfaf1;
  /* 压不住底下的经纬网就会像隔着纱看地图，直接做实 */
  fill-opacity: 0.985;
}

.inset-land {
  fill: #e7e0cf;
  stroke: #d5cdb8;
  stroke-width: 0.7;
}

.inset-home {
  stroke: #fffdf7;
  stroke-width: 0.9;
}

.inset-frame {
  fill: none;
  stroke: #d9d1bc;
  stroke-width: 1;
}

.inset-ring {
  fill: none;
  stroke-width: 1.5;
  stroke-dasharray: 3 3.4;
  opacity: 0.9;
}

.inset-title {
  font-size: 9.5px;
  letter-spacing: 0.2em;
  fill: #9a8e75;
  font-family: -apple-system, 'PingFang SC', sans-serif;
}

.scale-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  fill: #8a806a;
  font-family: -apple-system, 'PingFang SC', sans-serif;
}

.micro-name {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.04em;
  fill: #3b3527;
  font-family: -apple-system, 'PingFang SC', sans-serif;
  /* 注记常常落在邻国陆地上，白色描边要够厚才压得住 */
  paint-order: stroke;
  stroke: #fffdf8;
  stroke-width: 4.6px;
  stroke-linejoin: round;
}

.micro-cap {
  font-size: 12px;
  letter-spacing: 0.1em;
  fill: #8a7f66;
  font-family: -apple-system, 'PingFang SC', sans-serif;
  paint-order: stroke;
  stroke: #fffdf8;
  stroke-width: 4px;
  stroke-linejoin: round;
}

.ctx-label text {
  font-size: 13px;
  letter-spacing: 0.04em;
  fill: #a2947a;
  font-family: -apple-system, 'PingFang SC', sans-serif;
  paint-order: stroke;
  stroke: #faf6ec;
  stroke-width: 3.6px;
  stroke-linejoin: round;
  opacity: 0;
  animation: fadeIn 600ms ease forwards;
  animation-delay: 260ms;
  pointer-events: none;
}

.state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: #8a806a;
}

.state.err {
  color: #b45309;
}

/* 窄屏上城市文字会缩到看不清，还互相叠在一起，直接只留点 */
@media (max-width: 760px) {
  .pin-label,
  .ctx-label text,
  .micro-name,
  .micro-cap,
  .scalebar {
    display: none;
  }

  /* 位置图缩到手机宽度只剩指甲盖大，里面的定位环根本认不出 */
  .inset {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trace {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }
  .fill,
  .outline,
  .pin,
  .pin-label,
  .micro {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }
}
</style>
