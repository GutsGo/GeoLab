<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo'
import type { GeoSphere } from 'd3-geo'
import { loadWorld, isSyntheticId, type WorldFeature } from '~/lib/world'
import { countryById } from '~/data'

const props = withDefaults(
  defineProps<{
    countryId?: string
    color?: string
    scanKey?: number
    fallback?: { lat: number; lng: number } | null
  }>(),
  { color: '#1d4ed8', scanKey: 0, fallback: null },
)

const emit = defineEmits<{ (e: 'pick', id: string): void }>()

const host = ref<HTMLElement | null>(null)
const hover = ref<{ x: number; y: number; name: string } | null>(null)
const tipEl = ref<HTMLElement | null>(null)
/** 指针贴近右/下缘时 tooltip 翻到另一侧，避免被裁掉 */
const flipX = ref(false)
const flipY = ref(false)
/* 首次显示前用估计值，渲染一帧后用实测尺寸校准 */
let tipW = 120
let tipH = 26

function onLandClick(e: MouseEvent) {
  // 拖拽结束的那一下不当作点选（pointerup 后 click 仍会触发）
  if (dragMoved) {
    dragMoved = false
    return
  }
  const el = e.target as SVGElement | null
  const id = el?.getAttribute?.('data-id')
  if (id) emit('pick', id)
}

function onLandMove(e: MouseEvent) {
  if (dragging.value) {
    hover.value = null
    return
  }
  const el = e.target as SVGElement | null
  const id = el?.getAttribute?.('data-id')
  // 有中文条目就显示中文名，没有则退回 topojson 里的英文名
  const name = (id ? countryById.get(id)?.name : '') || el?.getAttribute?.('data-name') || ''
  const box = host.value?.getBoundingClientRect()
  if (!name || !box) {
    hover.value = null
    return
  }
  const x = e.clientX - box.left
  const y = e.clientY - box.top
  hover.value = { x, y, name }
  flipX.value = x + 14 + tipW > box.width - 8
  flipY.value = y + 14 + tipH > box.height - 8
  void nextTick(() => {
    if (!tipEl.value) return
    tipW = tipEl.value.offsetWidth
    tipH = tipEl.value.offsetHeight
  })
}

const W = 980
const H = 520
const SPHERE: GeoSphere = { type: 'Sphere' }

const features = ref<WorldFeature[]>([])
const error = ref('')
const ready = ref(false)

const projection = geoNaturalEarth1().fitExtent(
  [
    [2, 2],
    [W - 2, H - 2],
  ],
  SPHERE,
)
const path = geoPath(projection)

onMounted(async () => {
  try {
    features.value = await loadWorld()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    ready.value = true
  }
})

const spherePath = path(SPHERE) ?? ''
const graticulePath = path(geoGraticule10()) ?? ''

interface LandShape {
  id: string
  name: string
  /** 路径字符串一旦算出就不会再变，投影是固定的 */
  d: string
  clickable: boolean
}

/**
 * 只依赖 features 的路径缓存。
 * 注意：不要在这里掺 props.countryId，否则每次抽取都会重算 177 条路径（实测 4ms/次）。
 */
const baseShapes = computed<LandShape[]>(() =>
  features.value
    .map((f) => ({ id: f.id, name: f.name, d: path(f) ?? '', clickable: !isSyntheticId(f.id) }))
    .filter((s) => s.d.length > 0),
)

const target = computed(() => baseShapes.value.find((s) => s.id === props.countryId) ?? null)
const others = computed(() => baseShapes.value.filter((s) => s.id !== props.countryId))

const targetFeature = computed(() => features.value.find((f) => f.id === props.countryId) ?? null)

/**
 * 光晕滤波区域（userSpaceOnUse）：按目标国 bbox 外扩固定的模糊半径。
 * 默认的 objectBoundingBox 百分比区域跟着 bbox 缩放，小国的边距在
 * 绝对尺寸上会小于模糊半径（3σ ≈ 21 单位），光晕被裁成一圈矩形硬边。
 */
const GLOW_PAD = 26
const glowRegion = computed(() => {
  const f = targetFeature.value
  if (!f) return null
  let b: [[number, number], [number, number]]
  try {
    b = path.bounds(f)
  } catch {
    return null
  }
  if (!b.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))) return null
  return {
    x: b[0][0] - GLOW_PAD,
    y: b[0][1] - GLOW_PAD,
    w: b[1][0] - b[0][0] + GLOW_PAD * 2,
    h: b[1][1] - b[0][1] + GLOW_PAD * 2,
  }
})

/** 目标国在屏幕上太小（或数据里干脆没有），补一个醒目的圆点标记 */
const microPoint = computed(() => {
  const f = targetFeature.value
  if (f) {
    const b = path.bounds(f)
    const w = b[1][0] - b[0][0]
    const h = b[1][1] - b[0][1]
    if (Math.max(w, h) >= 11) return null
    const c = path.centroid(f)
    return Number.isFinite(c[0]) ? { x: c[0], y: c[1] } : null
  }
  if (!props.fallback) return null
  const xy = projection([props.fallback.lng, props.fallback.lat])
  return xy ? { x: xy[0], y: xy[1] } : null
})

/* ---------- 窄屏「滚动地球仪」：动态 viewBox 局部视窗 ----------
   投影与路径只算一次；缩放/平移全靠挪 viewBox，177 条路径零重算。
   视窗宽度由容器宽高比决定（约 2.5~3.3 倍放大），x 方向拖拽平移。 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** 视窗最小宽度：再窄就超过 3.3 倍放大，形状失真开始明显 */
const MIN_VIEW_W = 300
const panMode = ref(false)
const view = ref({ x: 0, y: 0, w: W, h: H })
const vb = computed(() => `${view.value.x} ${view.value.y} ${view.value.w} ${view.value.h}`)

const dragging = ref(false)
let dragMoved = false
let activePointer: number | null = null
let startX = 0
let startVx = 0
let lastX = 0
let lastT = 0
let velocity = 0
let raf = 0

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 当前目标国的投影质心 x（没有则用 fallback 坐标），用于居中 */
const currentCenterX = computed<number | null>(() => {
  const f = targetFeature.value
  if (f) {
    const c = path.centroid(f)
    if (Number.isFinite(c[0])) return c[0]
  }
  if (props.fallback) {
    const xy = projection([props.fallback.lng, props.fallback.lat])
    if (xy) return xy[0]
  }
  return null
})

function applyViewport(w: number, x: number) {
  view.value = { x: clamp(x, 0, W - w), y: 0, w, h: H }
}

/** 目标国居中时的视窗 x（没有目标则居中整个世界） */
function centerBias(w: number): number {
  const c = currentCenterX.value
  return c == null ? (W - w) / 2 : c - w / 2
}

/** 视窗宽度跟随容器宽高比（贴合视口，不出海面留白带）；recenter 时把目标国放中间 */
function syncViewport(recenter = false) {
  const box = host.value?.getBoundingClientRect()
  if (!box || !box.height) return
  if (!panMode.value) {
    view.value = { x: 0, y: 0, w: W, h: H }
    return
  }
  const w = clamp(H * (box.width / box.height), MIN_VIEW_W, W)
  applyViewport(w, recenter ? centerBias(w) : view.value.x)
}

function cancelGlide() {
  cancelAnimationFrame(raf)
  raf = 0
}

/** 惯性滚动：释放后按瞬时速度衰减，~0.4s 停下 */
function glide(v0: number) {
  if (reducedMotion()) return
  let v = v0
  const step = () => {
    v *= 0.93
    applyViewport(view.value.w, view.value.x - v / 60)
    if (Math.abs(v) > 20) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

function onPointerDown(e: PointerEvent) {
  if (!panMode.value) return
  cancelGlide()
  activePointer = e.pointerId
  dragMoved = false
  startX = lastX = e.clientX
  startVx = view.value.x
  lastT = performance.now()
  velocity = 0
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}

function onPointerMovePan(e: PointerEvent) {
  if (activePointer !== e.pointerId) return
  const dx = e.clientX - startX
  if (!dragMoved && Math.abs(dx) > 6) {
    dragMoved = true
    dragging.value = true
    hover.value = null
  }
  if (!dragMoved) return
  const box = host.value!.getBoundingClientRect()
  const scale = view.value.w / box.width
  const now = performance.now()
  velocity = ((e.clientX - lastX) / Math.max(1, now - lastT)) * 1000 * scale
  lastX = e.clientX
  lastT = now
  applyViewport(view.value.w, startVx - dx * scale)
}

function onPointerUpPan(e: PointerEvent) {
  if (activePointer !== e.pointerId) return
  activePointer = null
  dragging.value = false
  if (dragMoved && Math.abs(velocity) > 120) glide(velocity)
}

/** 目标国变化时，地球仪平滑滚到它居中（拖拽中不打扰） */
watch(
  () => props.countryId,
  () => {
    if (!panMode.value || activePointer !== null) return
    const to = centerBias(view.value.w)
    if (to === view.value.x) return
    if (reducedMotion()) {
      applyViewport(view.value.w, to)
      return
    }
    cancelGlide()
    const from = view.value.x
    const t0 = performance.now()
    const D = 450
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / D)
      const ease = 1 - Math.pow(1 - p, 3)
      applyViewport(view.value.w, from + (to - from) * ease)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  },
)

let mq: MediaQueryList | null = null
const onMqChange = (e: MediaQueryListEvent) => {
  panMode.value = e.matches
  syncViewport(true)
}
const onResize = () => syncViewport(false)

onMounted(() => {
  mq = matchMedia('(max-width: 720px)')
  panMode.value = mq.matches
  mq.addEventListener('change', onMqChange)
  window.addEventListener('resize', onResize)
  syncViewport(true)
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMqChange)
  window.removeEventListener('resize', onResize)
  cancelGlide()
})
</script>

<template>
  <div ref="host" class="world">
    <svg
      :viewBox="vb"
      preserveAspectRatio="xMidYMid meet"
      class="world-svg"
      :data-pan="panMode"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMovePan"
      @pointerup="onPointerUpPan"
      @pointercancel="onPointerUpPan"
    >
      <defs>
        <radialGradient id="ocean" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stop-color="#f2f8f9" />
          <stop offset="62%" stop-color="#e4eef1" />
          <stop offset="100%" stop-color="#d6e4e9" />
        </radialGradient>
        <linearGradient id="hit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="1" />
          <stop offset="100%" :stop-color="color" stop-opacity="0.72" />
        </linearGradient>
        <filter
          id="softGlow"
          filterUnits="userSpaceOnUse"
          :x="glowRegion?.x ?? 0"
          :y="glowRegion?.y ?? 0"
          :width="glowRegion?.w ?? 0"
          :height="glowRegion?.h ?? 0"
        >
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect :width="W" :height="H" fill="url(#ocean)" />
      <path :d="spherePath" fill="#eaf2f4" stroke="#c3d5db" stroke-width="0.8" />
      <path :d="graticulePath" fill="none" stroke="#b8ccd3" stroke-width="0.45" stroke-dasharray="2 5" />

      <g class="land-layer" @click="onLandClick" @mousemove="onLandMove" @mouseleave="hover = null">
        <path
          v-for="s in others"
          :key="s.id"
          :d="s.d"
          class="land"
          :class="{ inert: !s.clickable }"
          :data-id="s.clickable ? s.id : undefined"
          :data-name="s.name"
        />
      </g>

      <g v-if="target" class="target-layer">
        <path :d="target.d" fill="url(#hit)" :stroke="color" stroke-width="1.2" filter="url(#softGlow)" class="target" />
      </g>

      <g v-if="microPoint" class="micro">
        <circle :cx="microPoint.x" :cy="microPoint.y" r="14" :fill="color" fill-opacity="0.16" />
        <circle :cx="microPoint.x" :cy="microPoint.y" r="5.5" :fill="color" stroke="#fffdf7" stroke-width="1.4" />
      </g>

      <g :key="scanKey" class="scan">
        <line x1="0" y1="0" x2="0" :y2="H" stroke="#191712" stroke-opacity="0.18" stroke-width="1.5" />
      </g>
    </svg>

    <div v-if="!ready" class="overlay">地图数据装载中…</div>
    <div v-else-if="error" class="overlay err">{{ error }}</div>

    <div
      v-if="hover"
      ref="tipEl"
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
.world {
  position: relative;
  width: 100%;
  aspect-ratio: 980 / 520;
  overflow: hidden;
  background: #e4eef1;
}

.world-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.land {
  fill: #ece6d7;
  stroke: #dcd3bd;
  stroke-width: 0.5;
  vector-effect: non-scaling-stroke;
  cursor: pointer;
  transition: fill 0.18s ease;
}

.land:hover {
  fill: #dfd5bd;
}

/* 有争议/无 ISO 编号的地区照常画出来，但不可被抽中，也不响应悬停 */
.land.inert {
  cursor: default;
  pointer-events: none;
}

.target {
  transition: fill 0.4s ease;
}

.scan line {
  opacity: 0;
  animation: sweep 0.85s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes sweep {
  0% {
    transform: translateX(0);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  100% {
    transform: translateX(980px);
    opacity: 0;
  }
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
}

.overlay.err {
  color: #b45309;
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

/* 窄屏给足高度：滚动地球仪的放大倍率来自「容器比 980/520 更高」，
   视窗宽度按容器宽高比收缩，整幅世界约 2.5~3.3 倍放大 */
@media (max-width: 720px) {
  .world {
    aspect-ratio: auto;
    height: min(58vh, 460px);
  }
}

/* 滚动地球仪模式（窄屏由脚本启用）：横向拖拽归地图，纵向滚动留给页面 */
.world-svg[data-pan='true'] {
  touch-action: pan-y;
  cursor: grab;
  user-select: none;
}

.world-svg[data-pan='true']:active {
  cursor: grabbing;
}

/* 触屏：无 hover 预览，指头就是光标。给国家加一圈透明描边扩大热区，
   小岛国（新加坡、毛里求斯这类）才点得中 */
@media (pointer: coarse) {
  .land {
    stroke: #000;
    stroke-opacity: 0;
    stroke-width: 8;
  }
}
</style>
