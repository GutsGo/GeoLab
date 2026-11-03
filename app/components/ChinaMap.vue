<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { geoMercator, geoPath } from 'd3-geo'

interface ProvFeature {
  type: 'Feature'
  properties: { name: string; adcode: string }
  geometry: { type: 'MultiPolygon'; coordinates: [number, number][][][] }
}

const props = withDefaults(
  defineProps<{
    /** 当前抽中的省级行政区 adcode（全饱和大区色高亮） */
    currentId?: string
    /** 已解锁省份的着色回调（返回色值）；未返回则用默认「已解锁」色 */
    seenIds?: Set<string>
    /** 已解锁省份的着色回调（返回色值）；未返回则用默认「已解锁」色 */
    hueOf?: (id: string) => string | undefined
    /** 关闭悬停省名提示（答题防剧透） */
    noHover?: boolean
    /** 作答状态：定位题答对/答错后高亮正确省份 */
    answer?: { okId: string; wrongId?: string } | null
  }>(),
  { currentId: '', hueOf: undefined, noHover: false, answer: null },
)

const emit = defineEmits<{ (e: 'pick', id: string): void }>()

const W = 880
const H = 620

const host = ref<HTMLElement | null>(null)
const hover = ref<{ x: number; y: number; name: string } | null>(null)
const tipEl = ref<HTMLElement | null>(null)
let tipW = 90
let tipH = 24

const features = ref<ProvFeature[]>([])
const error = ref('')
const ready = ref(false)

const projection = geoMercator()
const path = geoPath(projection)

onMounted(async () => {
  try {
    const res = await fetch('/data/china-provinces.json')
    if (!res.ok) throw new Error(`地图数据加载失败（${res.status}）`)
    const gj = (await res.json()) as { features: ProvFeature[] }
    const fc = { type: 'FeatureCollection', features: gj.features } as const
    projection.fitExtent(
      [
        [6, 6],
        [W - 6, H - 6],
      ],
      fc,
    )
    features.value = gj.features
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    ready.value = true
  }
})

/** 九段线是线状要素（adcode 100000_JD），只描边不可点 */
const jdFeature = computed(() => features.value.find((f) => f.properties.adcode === '100000_JD') ?? null)
const provFeatures = computed(() => features.value.filter((f) => f.properties.adcode !== '100000_JD'))

interface Shape {
  id: string
  name: string
  d: string
}

const shapes = computed<Shape[]>(() =>
  provFeatures.value
    .map((f) => ({ id: f.properties.adcode, name: f.properties.name, d: path(f) ?? '' }))
    .filter((s) => s.d.length > 0),
)

/** 过小省份（香港/澳门）的放大隐形热区：圆心取 path 包围盒中心，
    半径保证最小可点击直径，叠在省份图层最上层接管点击与悬停 */
const HIT_MIN = 16
const HIT_R = 10
const hitZones = computed<{ id: string; name: string; cx: number; cy: number }[]>(() => {
  const zones: { id: string; name: string; cx: number; cy: number }[] = []
  for (const f of provFeatures.value) {
    const [[x0, y0], [x1, y1]] = path.bounds(f)
    if (x1 - x0 >= HIT_MIN && y1 - y0 >= HIT_MIN) continue
    zones.push({
      id: f.properties.adcode,
      name: f.properties.name,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
    })
  }
  // 港澳相距仅 ~6 单位，热区圆会互相覆盖对方的真实位置——
  // 沿连线推开到互不侵入（各自真实圆心仍留在自己的圆内）
  const minD = HIT_R * 2 + 2
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!
      const b = zones[j]!
      const dx = b.cx - a.cx
      const dy = b.cy - a.cy
      const d = Math.hypot(dx, dy) || 1
      if (d >= minD) continue
      const push = (minD - d) / 2
      a.cx -= (dx / d) * push
      a.cy -= (dy / d) * push
      b.cx += (dx / d) * push
      b.cy += (dy / d) * push
    }
  }
  return zones
})

const jdPath = computed(() => (jdFeature.value ? path(jdFeature.value) ?? '' : ''))

/** 全画幅经纬网：与 DrawMap 同一款视觉（蓝灰虚线，逢 30° 加重） */
const graticule = computed(() => {
  const lines: { d: string; major: boolean }[] = []
  const build = (pts: [number, number][]) =>
    pts.length < 2 ? '' : 'M' + pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')
  for (let lng = 70; lng <= 140; lng += 10) {
    const pts: [number, number][] = []
    for (let lat = 0; lat <= 60; lat += 2) {
      const xy = projection([lng, lat])
      if (xy && Number.isFinite(xy[0]) && Number.isFinite(xy[1])) pts.push(xy as [number, number])
    }
    const d = build(pts)
    if (d) lines.push({ d, major: lng % 30 === 0 })
  }
  for (let lat = 0; lat <= 60; lat += 10) {
    const pts: [number, number][] = []
    for (let lng = 70; lng <= 140; lng += 2) {
      const xy = projection([lng, lat])
      if (xy && Number.isFinite(xy[0]) && Number.isFinite(xy[1])) pts.push(xy as [number, number])
    }
    const d = build(pts)
    if (d) lines.push({ d, major: lat % 30 === 0 })
  }
  return lines
})

/** 省份着色：与 DrawMap 同语言——只有当前抽中的省是大区色，其余一律纸色陆块 */
function fillOf(s: Shape): string {
  if (s.id === props.currentId) {
    return props.hueOf?.(s.id) || '#d8cdb2'
  }
  return '#f3eddf'
}

function onProvClick(e: MouseEvent) {
  const el = e.target as SVGElement | null
  const id = el?.getAttribute?.('data-id')
  if (id) emit('pick', id)
}

function onProvMove(e: MouseEvent) {
  if (props.noHover) return
  const el = e.target as SVGElement | null
  const name = el?.getAttribute?.('data-name') || ''
  const box = host.value?.getBoundingClientRect()
  if (!name || !box) {
    hover.value = null
    return
  }
  const x = e.clientX - box.left
  const y = e.clientY - box.top
  hover.value = { x, y, name }
  void nextTick(() => {
    if (!tipEl.value) return
    tipW = tipEl.value.offsetWidth
    tipH = tipEl.value.offsetHeight
  })
}
</script>

<template>
  <div ref="host" class="cmap">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" class="cmap-svg">
      <rect :width="W" :height="H" fill="transparent" />
      <!-- 经纬网压在省份图层之下，与 DrawMap 同款 -->
      <g class="grat">
        <path
          v-for="(g, i) in graticule"
          :key="'g' + i"
          :d="g.d"
          fill="none"
          :stroke="g.major ? '#b9c9cd' : '#cfdde1'"
          :stroke-width="g.major ? 0.8 : 0.6"
          stroke-dasharray="3 6"
        />
      </g>
      <g class="prov-layer" @click="onProvClick" @mousemove="onProvMove" @mouseleave="hover = null">
        <path
          v-for="s in shapes"
          :key="s.id"
          :d="s.d"
          class="prov"
          :class="{
            ok: props.answer?.okId === s.id,
            wrong: props.answer?.wrongId === s.id,
          }"
          :fill="fillOf(s)"
          :data-id="s.id"
          :data-name="s.name"
        />
        <path v-if="jdPath" :d="jdPath" class="jd-line" />
        <circle
          v-for="z in hitZones"
          :key="'h' + z.id"
          :cx="z.cx"
          :cy="z.cy"
          :r="HIT_R"
          class="hit"
          :class="{
            ok: props.answer?.okId === z.id,
            wrong: props.answer?.wrongId === z.id,
          }"
          :data-id="z.id"
          :data-name="z.name"
        />
      </g>
    </svg>

    <div v-if="!ready" class="overlay">地图数据装载中…</div>
    <div v-else-if="error" class="overlay err">{{ error }}</div>

    <div
      v-if="hover"
      ref="tipEl"
      class="tip"
      :style="{ left: hover.x + (hover.x + 14 + tipW > (host?.clientWidth ?? W) - 8 ? -14 : 14) + 'px', top: hover.y + (hover.y + 14 + tipH > (host?.clientHeight ?? H) - 8 ? -14 : 14) + 'px' }"
    >
      {{ hover.name }}
    </div>
  </div>
</template>

<style scoped>
.cmap {
  position: relative;
  width: 100%;
  aspect-ratio: 880 / 620;
  overflow: hidden;
  /* 海面：与 DrawMap 同一款渐变，不再自带圆角阴影（由外层 map-stage/g-stage 统一裁切） */
  background:
    radial-gradient(120% 90% at 50% 8%, #f0f6f7 0%, #e6eff1 46%, #dae8ec 100%);
}

.cmap-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.prov {
  /* 省界线用陆块描边色，与 DrawMap 的邻国地块一致 */
  stroke: #e2dac7;
  stroke-width: 0.6;
  vector-effect: non-scaling-stroke;
  cursor: pointer;
  transition: fill 0.18s ease;
}

.prov:hover {
  filter: brightness(0.93);
}

.prov.ok {
  fill: #15803d !important;
  stroke: #14532d;
}

.prov.wrong {
  fill: #b91c1c !important;
}

/* 小省放大热区：透明圆接管点击/悬停，悬停时虚线圆环提示范围 */
.hit {
  fill: transparent;
  stroke: none;
  cursor: pointer;
}

.hit:hover {
  stroke: #6d7f85;
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.hit.ok {
  fill: #15803d;
  stroke: #14532d;
  stroke-width: 1;
}

.hit.wrong {
  fill: #b91c1c;
}

/* 九段线：装饰性断续线，不参与交互；颜色归入海面同款蓝灰系 */
.jd-line {
  fill: none;
  stroke: #b9c9cd;
  stroke-width: 1.6;
  stroke-dasharray: 10 7;
  stroke-linecap: round;
  pointer-events: none;
}

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  letter-spacing: 0.14em;
  color: #6d7f85;
  background: rgba(230, 239, 241, 0.85);
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
  box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.6);
}

@media (max-width: 720px) {
  .cmap {
    aspect-ratio: auto;
    height: min(62vh, 480px);
  }
}
</style>
