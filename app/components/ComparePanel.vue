<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { Country } from '~/data/types'
import { countries, byContinent } from '~/data'

const props = defineProps<{ open: boolean; base: Country | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', id: string): void
}>()

const otherId = ref('')
const query = ref('')
const searchEl = ref<HTMLInputElement | null>(null)

const other = computed(() => countries.find((c) => c.id === otherId.value) ?? null)

/** 候选：搜索命中；无搜索词时默认同大洲 */
const candidates = computed(() => {
  const base = props.base
  if (!base) return []
  const q = query.value.trim().toLowerCase()
  if (!q) return byContinent[base.continent].filter((c) => c.id !== base.id)
  return countries.filter(
    (c) =>
      c.id !== base.id &&
      (c.name.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q ||
        c.capital.toLowerCase().includes(q)),
  )
})

watch(
  () => props.open,
  (v) => {
    if (v) {
      query.value = ''
      otherId.value = ''
      void nextTick(() => searchEl.value?.focus())
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

/* ---------- 数值解析：人口/面积是「约 3.35 亿」这类中文数量级字符串 ---------- */

function parseCNNum(s: string): number | null {
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*(亿|万)?/)
  if (!m) return null
  const n = Number.parseFloat(m[1]!)
  if (!Number.isFinite(n)) return null
  return n * (m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1)
}

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '')} 万`
  return String(Math.round(n))
}

interface Metric {
  label: string
  raw: string
  num: number | null
}

function metricOf(label: '人口' | '面积', c: Country): Metric {
  const raw = label === '人口' ? c.population : c.area
  return { label, raw, num: parseCNNum(raw) }
}

const metrics = computed<[Metric, Metric][] | null>(() => {
  const a = props.base
  const b = other.value
  if (!a || !b) return null
  return [
    [metricOf('人口', a), metricOf('人口', b)],
    [metricOf('面积', a), metricOf('面积', b)],
  ]
})

/** 条形宽度用平方根比例：中国 vs 图瓦卢这类数量级悬殊时，小国条形仍可见 */
function barW(num: number | null, max: number | null): string {
  if (num == null || max == null || max <= 0) return '0%'
  return `${Math.max(2, (Math.sqrt(num) / Math.sqrt(max)) * 100).toFixed(1)}%`
}

/** 倍数文案：谁大谁小一目了然 */
const ratios = computed<string[]>(() => {
  const ms = metrics.value
  if (!ms) return []
  return ms.map(([a, b]) => {
    if (a.num == null || b.num == null || a.num <= 0 || b.num <= 0) return ''
    const big = a.num >= b.num ? props.base! : other.value!
    const small = big === props.base ? other.value! : props.base!
    const bn = Math.max(a.num!, b.num!)
    const sn = Math.min(a.num!, b.num!)
    const times = bn / sn
    return `${big.name}约是${small.name}的 ${times >= 100 ? Math.round(times) : times.toFixed(1)} 倍`
  })
})

const maxOf = (pair: [Metric, Metric]) => {
  const n1 = pair[0].num
  const n2 = pair[1].num
  if (n1 == null && n2 == null) return null
  if (n1 == null) return n2
  if (n2 == null) return n1
  return Math.max(n1, n2)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cmp">
      <div v-if="open && base" class="cmp-mask" @click.self="emit('close')" @keydown="onKeydown">
        <div class="cmp" role="dialog" aria-modal="true" aria-label="国家对比">
          <div class="cmp-head">
            <div>
              <div class="kicker">横向对照</div>
              <h3 class="display">国家对比</h3>
            </div>
            <button class="cmp-close" aria-label="关闭对比" @click="emit('close')">✕</button>
          </div>

          <div class="cmp-search">
            <input
              ref="searchEl"
              v-model="query"
              class="cmp-input"
              type="text"
              :placeholder="`搜索国家 / 首都 / 英文名，与${base.name}对比`"
            />
          </div>

          <div v-if="other" class="cmp-grid">
            <div class="cmp-side">
              <div class="cmp-flag"><FlagBadge :code="base.code" :emoji="base.flag" :name="base.name" :width="52" /></div>
              <div class="cmp-name">{{ base.name }}</div>
              <div class="cmp-sub">{{ base.continent }} · {{ base.subregion }}</div>
            </div>
            <div class="cmp-side">
              <div class="cmp-flag"><FlagBadge :code="other.code" :emoji="other.flag" :name="other.name" :width="52" /></div>
              <button class="cmp-name link" @click="emit('pick', other.id)">{{ other.name }} →</button>
              <div class="cmp-sub">{{ other.continent }} · {{ other.subregion }}</div>
            </div>
          </div>

          <div v-if="other && metrics" class="cmp-body">
            <div v-for="(pair, i) in metrics" :key="pair[0].label" class="metric">
              <div class="metric-label">{{ pair[0].label }}</div>
              <div class="metric-rows">
                <div class="metric-row">
                  <span class="mono metric-val">{{ pair[0].raw.replace(/^约 /, '') }}</span>
                  <span class="bar-track"><span class="bar-fill a" :style="{ width: barW(pair[0].num, maxOf(pair)) }"></span></span>
                </div>
                <div class="metric-row">
                  <span class="mono metric-val">{{ pair[1].raw.replace(/^约 /, '') }}</span>
                  <span class="bar-track"><span class="bar-fill b" :style="{ width: barW(pair[1].num, maxOf(pair)) }"></span></span>
                </div>
              </div>
              <div v-if="ratios[i]" class="metric-ratio">{{ ratios[i] }}</div>
            </div>

            <div class="kv">
              <div class="kv-item"><span class="kv-k">首都</span><span class="kv-v">{{ base.capital }}</span><span class="kv-v">{{ other.capital }}</span></div>
              <div class="kv-item"><span class="kv-k">语言</span><span class="kv-v">{{ base.language }}</span><span class="kv-v">{{ other.language }}</span></div>
              <div class="kv-item"><span class="kv-k">货币</span><span class="kv-v">{{ base.currency }}</span><span class="kv-v">{{ other.currency }}</span></div>
            </div>
          </div>

          <div v-else class="cmp-empty">
            <template v-if="query">
              <p>没有匹配「{{ query }}」的国家</p>
            </template>
            <p v-else>从下面选一个国家来对比（默认列出同大洲）</p>
            <div class="chips">
              <button v-for="c in candidates.slice(0, 24)" :key="c.id" class="chip" @click="otherId = c.id">
                <FlagBadge :code="c.code" :emoji="c.flag" :name="c.name" :width="16" flat />
                <span>{{ c.name }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cmp-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(25, 23, 18, 0.42);
  backdrop-filter: blur(3px);
}

.cmp {
  width: min(640px, 100%);
  max-height: min(84vh, 760px);
  overflow-y: auto;
  border-radius: var(--r-md, 14px);
  background: var(--card, #fdfaf3);
  border: 1px solid var(--line-strong, #d8cdb2);
  box-shadow: 0 30px 70px -30px rgba(0, 0, 0, 0.55);
  padding: 20px 22px 24px;
}

.cmp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.kicker {
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--muted);
}

.cmp-head h3 {
  font-size: 21px;
  margin-top: 2px;
}

.cmp-close {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.cmp-close:hover {
  background: var(--ink);
  color: #fdf9ee;
}

.cmp-search {
  margin-top: 14px;
}

.cmp-input {
  width: 100%;
  padding: 9px 12px;
  border-radius: var(--r-sm, 8px);
  border: 1px solid var(--line);
  background: #fffdf8;
  font-size: 13px;
}

.cmp-input:focus {
  outline: 2px solid color-mix(in srgb, var(--ink) 30%, transparent);
  outline-offset: 1px;
}

.cmp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;
}

.cmp-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  border-radius: var(--r-sm, 8px);
  border: 1px dashed var(--line-strong, #d8cdb2);
  background: #fffdf8;
  text-align: center;
}

.cmp-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
}

.cmp-name.link {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cmp-name.link:hover {
  color: var(--accent, #1d4ed8);
}

.cmp-sub {
  font-size: 11px;
  color: var(--muted);
}

.cmp-body {
  margin-top: 16px;
  display: grid;
  gap: 16px;
}

.metric-label {
  font-size: 10.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}

.metric-rows {
  display: grid;
  gap: 5px;
}

.metric-row {
  display: grid;
  grid-template-columns: 92px 1fr;
  align-items: center;
  gap: 8px;
}

.metric-val {
  font-size: 12px;
  text-align: right;
}

.bar-track {
  height: 12px;
  border-radius: 999px;
  background: rgba(25, 23, 18, 0.06);
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.bar-fill.a {
  background: linear-gradient(90deg, #1d4ed8, #3b82f6);
}

.bar-fill.b {
  background: linear-gradient(90deg, #b45309, #f59e0b);
}

.metric-ratio {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--muted);
}

.kv {
  display: grid;
  gap: 8px;
  padding-top: 4px;
}

.kv-item {
  display: grid;
  grid-template-columns: 44px 1fr 1fr;
  gap: 10px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: var(--r-sm, 8px);
  border: 1px solid var(--line);
  background: #fffdf8;
}

.kv-k {
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--muted);
}

.kv-v {
  font-size: 12.5px;
  color: var(--ink);
}

.cmp-empty {
  margin-top: 18px;
  display: grid;
  gap: 12px;
}

.cmp-empty p {
  font-size: 12.5px;
  color: var(--muted);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #fffdf8;
  font-size: 11.5px;
  color: var(--ink-2);
}

.chip:hover {
  border-color: var(--ink);
  transform: translateY(-1px);
}

.cmp-enter-active,
.cmp-leave-active {
  transition: opacity 0.22s ease;
}

.cmp-enter-active .cmp,
.cmp-leave-active .cmp {
  transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}

.cmp-enter-from,
.cmp-leave-to {
  opacity: 0;
}

.cmp-enter-from .cmp,
.cmp-leave-to .cmp {
  transform: translateY(14px) scale(0.98);
}

@media (max-width: 560px) {
  .metric-row {
    grid-template-columns: 76px 1fr;
  }
}
</style>
