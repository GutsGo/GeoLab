<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { geoMercator, geoPath, geoCentroid } from 'd3-geo'
import { loadDetailShapes, loadWorld, type WorldFeature } from '~/lib/world'
import type { CityPin } from '~/data/types'

const props = withDefaults(
  defineProps<{
    countryId?: string
    pins?: CityPin[]
    color?: string
    marker?: { lat: number; lng: number } | null
    showPins?: boolean
    height?: number
    water?: boolean
    focusPin?: string
  }>(),
  {
    color: '#1d4ed8',
    showPins: true,
    height: 240,
    water: false,
    marker: null,
  },
)

const W = 400
const H = computed(() => props.height)

/**
 * 同页最多并存 3 个 FocusMap（主图 inset / 详情卡 / 测验弹窗），
 * 用实例级 uid 拼 defs id，否则同一国家会有多份同名 gradient，颜色互相串。
 */
const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const fillId = `fill-${uid}`
const hatchId = `hatch-${uid}`

const loading = ref(true)
const error = ref('')
const all = ref<WorldFeature[] | null>(null)
/** 小国的精细海岸线；缩略图里看不出差别，但测验出轮廓题时用得上 */
const detail = ref<Map<string, WorldFeature> | null>(null)

onMounted(async () => {
  try {
    all.value = await loadWorld()
    loading.value = false
    loadDetailShapes()
      .then((m) => {
        detail.value = m
      })
      .catch(() => {})
  } catch (e) {
    error.value = (e as Error).message
    loading.value = false
  }
})

/** 110m 要素：负责取景 */
const feat = computed(() => all.value?.find((f) => f.id === props.countryId) ?? null)
const detailed = computed(() => (props.countryId ? detail.value?.get(props.countryId) ?? null : null))
/** 实际描绘的几何：有精细版就用精细版 */
const geom = computed(() => detailed.value ?? feat.value)

const projection = computed(() => {
  const f = feat.value ?? detailed.value
  const m = props.marker

  if (f) {
    let center: [number, number] = [0, 0]
    try {
      const c = geoCentroid(f)
      if (Number.isFinite(c[0]) && Number.isFinite(c[1])) center = c
    } catch {
      /* 保持 0,0 */
    }
    const p = geoMercator().rotate([-center[0], 0]).center([0, center[1]])
    try {
      p.fitExtent(
        [
          [18, 18],
          [W - 18, H.value - 18],
        ],
        f,
      )
      if (!Number.isFinite(p.scale())) throw new Error('bad scale')
    } catch {
      p.scale(H.value * 1.6).translate([W / 2, H.value / 2])
    }
    return p
  }

  // 没有轮廓数据（微型国家）：以首都为中心做定点放大
  if (!m) return null
  return geoMercator()
    .rotate([-m.lng, 0])
    .center([0, m.lat])
    .scale(H.value * 1.8)
    .translate([W / 2, H.value / 2])
})

const path = computed(() => (projection.value ? geoPath(projection.value) : null))

const shape = computed(() => {
  const p = path.value
  const f = geom.value
  if (!p || !f) return ''
  return p(f) ?? ''
})

const pinPoints = computed(() => {
  const p = projection.value
  if (!p || !props.showPins || !props.pins) return []
  return props.pins
    .map((c) => {
      const xy = p([c.lng, c.lat])
      if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null
      return { ...c, x: xy[0], y: xy[1], active: c.name === props.focusPin }
    })
    .filter((x): x is CityPin & { x: number; y: number; active: boolean } => !!x)
})

const gridLines = computed(() => {
  const g = projection.value
  if (!g) return []
  const lines: { d: string; major: boolean }[] = []
  const push = (pts: [number, number][], major: boolean) => {
    if (pts.length > 1) {
      lines.push({ d: 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L'), major })
    }
  }
  for (let lng = -180; lng <= 180; lng += 15) {
    const pts: [number, number][] = []
    for (let lat = -80; lat <= 80; lat += 4) {
      const xy = g([lng, lat])
      if (xy && Number.isFinite(xy[0])) pts.push(xy as [number, number])
    }
    push(pts, lng === 0)
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const pts: [number, number][] = []
    for (let lng = -180; lng <= 180; lng += 4) {
      const xy = g([lng, lat])
      if (xy && Number.isFinite(xy[0])) pts.push(xy as [number, number])
    }
    push(pts, lat === 0)
  }
  return lines.slice(0, 48)
})

const microDot = computed(() => {
  if (shape.value) return null
  if (!projection.value) return null
  return { x: W / 2, y: H.value / 2 }
})
</script>

<template>
  <div class="focus" :style="{ aspectRatio: `${W} / ${H}` }">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" class="focus-svg">
      <defs>
        <linearGradient :id="fillId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.95" />
          <stop offset="100%" :stop-color="color" stop-opacity="0.62" />
        </linearGradient>
        <pattern :id="hatchId" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" :stroke="color" stroke-width="1.4" stroke-opacity="0.15" />
        </pattern>
      </defs>

      <rect v-if="water" x="0" y="0" :width="W" :height="H" fill="#e9f1f4" />
      <path
        v-for="(g, i) in gridLines"
        :key="i"
        :d="g.d"
        :stroke="g.major ? '#b3c6cd' : '#cfdde2'"
        stroke-width="0.6"
        fill="none"
        stroke-dasharray="2 4"
      />

      <path v-if="shape" :d="shape" :fill="`url(#${hatchId})`" />
      <path
        v-if="shape"
        :d="shape"
        :fill="`url(#${fillId})`"
        :stroke="color"
        stroke-width="1.3"
        stroke-linejoin="round"
      />

      <g v-if="microDot">
        <circle :cx="microDot.x" :cy="microDot.y" r="26" :fill="color" fill-opacity="0.12" />
        <circle :cx="microDot.x" :cy="microDot.y" r="9" :fill="color" stroke="#fffdf7" stroke-width="2" />
      </g>

      <g v-for="(p, i) in pinPoints" :key="p.name + i">
        <template v-if="p.active">
          <circle :cx="p.x" :cy="p.y" r="13" :fill="color" fill-opacity="0.16" />
          <circle :cx="p.x" :cy="p.y" r="5" :fill="color" stroke="#fffdf7" stroke-width="2" />
        </template>
        <template v-else>
          <circle :cx="p.x" :cy="p.y" r="6.5" fill="#fffdf7" fill-opacity="0.92" />
          <circle :cx="p.x" :cy="p.y" r="2.3" :fill="p.capital ? '#191712' : '#8a806a'" />
        </template>
      </g>

      <text
        v-for="(p, i) in pinPoints.slice(0, 4)"
        :key="'t' + p.name + i"
        :x="p.x"
        :y="p.y - 9"
        class="pin-label"
        :class="{ strong: p.active }"
        text-anchor="middle"
      >
        {{ p.name }}
      </text>
    </svg>
    <div v-if="loading" class="state">加载中…</div>
    <div v-else-if="error" class="state err">{{ error }}</div>
  </div>
</template>

<style scoped>
.focus {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 14px;
  background: linear-gradient(180deg, #fbf8f0, #f2ecdf);
}

.focus-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.pin-label.strong {
  font-size: 10.5px;
  font-weight: 700;
  fill: #191712;
}

.pin-label {
  font-size: 9px;
  font-family: -apple-system, 'PingFang SC', sans-serif;
  fill: #3b3527;
  paint-order: stroke;
  stroke: #fffdf7;
  stroke-width: 3px;
  stroke-linejoin: round;
  letter-spacing: 0.02em;
}

.state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 10.5px;
  color: #8a806a;
  letter-spacing: 0.08em;
}

.state.err {
  color: #b45309;
}
</style>
