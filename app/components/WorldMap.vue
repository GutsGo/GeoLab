<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

function onLandClick(e: MouseEvent) {
  const el = e.target as SVGElement | null
  const id = el?.getAttribute?.('data-id')
  if (id) emit('pick', id)
}

function onLandMove(e: MouseEvent) {
  const el = e.target as SVGElement | null
  const id = el?.getAttribute?.('data-id')
  // 有中文条目就显示中文名，没有则退回 topojson 里的英文名
  const name = (id ? countryById.get(id)?.name : '') || el?.getAttribute?.('data-name') || ''
  const box = host.value?.getBoundingClientRect()
  if (!name || !box) {
    hover.value = null
    return
  }
  hover.value = { x: e.clientX - box.left, y: e.clientY - box.top, name }
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
</script>

<template>
  <div ref="host" class="world">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" class="world-svg">
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
        <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
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

    <div v-if="hover" class="tip" :style="{ left: hover.x + 14 + 'px', top: hover.y + 14 + 'px' }">
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
  border-radius: 7px;
  background: rgba(25, 23, 18, 0.88);
  color: #fdf9ee;
  font-size: 11px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transform: translateZ(0);
  box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.6);
}
</style>
