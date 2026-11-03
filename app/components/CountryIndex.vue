<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { byContinent, CONTINENTS, CONTINENT_META } from '~/data'
import type { Country } from '~/data/types'

const props = defineProps<{ open: boolean; seen: string[]; currentId: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'pick', id: string): void; (e: 'reset'): void }>()

const q = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const drawerEl = ref<HTMLElement | null>(null)

/** 打开抽屉前记录焦点来源，关闭时归还——键盘用户才不会被丢在页面顶部 */
let lastFocused: HTMLElement | null = null

/** 模板里每行都判一次 seen.includes 是 O(n²)，换成 Set */
const seenSet = computed(() => new Set(props.seen))

/** 清空进度的两步确认：第一次点击进入待确认态，4 秒内再点才执行 */
const confirming = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

function onResetClick() {
  if (!confirming.value) {
    confirming.value = true
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => (confirming.value = false), 4000)
    return
  }
  if (confirmTimer) clearTimeout(confirmTimer)
  confirming.value = false
  emit('reset')
}

/** Tab 圈闭：焦点只在抽屉内轮转 */
function trapFocus(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  // ref 挂在 Motion 组件上，拿到的是实例；$el 才是真正的 <aside>
  const inst = drawerEl.value as { $el?: HTMLElement } | HTMLElement | null
  const root = inst && '$el' in inst ? (inst.$el as HTMLElement) : (inst as HTMLElement | null)
  if (!root) return
  const els = Array.from(
    root.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.hasAttribute('disabled'))
  if (!els.length) return
  const first = els[0]
  const last = els[els.length - 1]
  if (!first || !last) return
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey) {
    if (active === first || !root.contains(active)) {
      e.preventDefault()
      last.focus()
    }
  } else if (active === last || !root.contains(active)) {
    e.preventDefault()
    first.focus()
  }
}

function hit(c: Country, k: string) {
  return (
    c.name.includes(k) ||
    c.nameEn.toLowerCase().includes(k) ||
    c.capital.includes(k) ||
    c.subregion.includes(k) ||
    c.code === k
  )
}

const grouped = computed(() => {
  const k = q.value.trim().toLowerCase()
  return CONTINENTS.map((c) => ({
    continent: c,
    hue: CONTINENT_META[c].hue,
    items: byContinent[c].filter((x) => (k ? hit(x, k) : true)),
    got: byContinent[c].filter((x) => seenSet.value.has(x.id)).length,
  })).filter((g) => g.items.length > 0)
})

const hits = computed(() => grouped.value.reduce((n, g) => n + g.items.length, 0))
const noHit = computed(() => q.value.trim().length > 0 && hits.value === 0)

watch(
  () => props.open,
  async (v) => {
    q.value = ''
    if (confirmTimer) clearTimeout(confirmTimer)
    confirming.value = false
    if (!v) {
      lastFocused?.focus()
      lastFocused = null
      return
    }
    lastFocused = document.activeElement as HTMLElement | null
    await nextTick()
    inputEl.value?.focus()
  },
)

onBeforeUnmount(() => {
  if (confirmTimer) clearTimeout(confirmTimer)
})
</script>

<template>
  <AnimatePresence>
    <Motion
      v-if="open"
      key="mask"
      as="div"
      class="mask"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.2 }"
      @click="emit('close')"
    />
    <Motion
      v-if="open"
      key="drawer"
      as="aside"
      ref="drawerEl"
      class="drawer"
      role="dialog"
      aria-modal="true"
      aria-label="国家与地区索引"
      :initial="{ x: '104%' }"
      :animate="{ x: 0 }"
      :exit="{ x: '104%' }"
      :transition="{ type: 'spring', stiffness: 320, damping: 34 }"
      @keydown.capture="trapFocus"
    >
      <header class="d-head">
        <div class="d-head-row">
          <div>
            <div class="kicker">全部条目</div>
            <h3 class="display" style="font-size: 20px; margin-top: 2px">国家与地区索引</h3>
          </div>
          <button class="close" aria-label="关闭" @click="emit('close')">✕</button>
        </div>

        <div class="search">
          <svg class="s-ico" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M10.6 10.6 L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <input
            ref="inputEl"
            v-model="q"
            type="text"
            class="s-input"
            placeholder="搜国家 / 首都 / 英文名"
            autocomplete="off"
            spellcheck="false"
            @keydown.esc.prevent="emit('close')"
          />
          <button v-if="q" class="s-clear" aria-label="清空" @click="q = ''">✕</button>
          <span v-else class="s-hint mono">ESC</span>
        </div>
      </header>

      <div class="d-body scroll-thin">
        <div v-if="noHit" class="no-hit">
          <div class="nh-mark">◍</div>
          <p>没有匹配「{{ q }}」的条目。</p>
          <p class="nh-sub">试试中文名、首都，或者两字母代码，比如 JP。</p>
        </div>

        <section v-for="g in grouped" :key="g.continent" class="group">
          <div class="g-head">
            <span class="g-dot" :style="{ background: g.hue }"></span>
            <span class="g-name">{{ g.continent }}</span>
            <span class="mono g-count">{{ g.got }}/{{ g.items.length }}</span>
          </div>
          <div class="g-items">
            <button
              v-for="c in g.items"
              :key="c.id"
              class="g-item"
              :class="{ seen: seenSet.has(c.id), active: c.id === currentId }"
              :style="{ '--c': g.hue }"
              @click="emit('pick', c.id)"
            >
              <FlagBadge :code="c.code" :emoji="c.flag" :name="c.name" :width="18" flat />
              <span class="gi-name">{{ c.name }}</span>
              <span class="gi-en">{{ c.nameEn }}</span>
              <span v-if="seenSet.has(c.id)" class="gi-dot" :style="{ background: g.hue }"></span>
            </button>
          </div>
        </section>

        <div class="d-foot">
          <span class="mono">已看过 {{ seen.length }} 个条目</span>
          <button
            class="reset"
            :data-armed="confirming"
            @click="onResetClick"
            @blur="confirming = false"
          >
            {{ confirming ? '再点一次确认清空' : '清空学习进度' }}
          </button>
        </div>
      </div>
    </Motion>
  </AnimatePresence>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(28, 24, 16, 0.3);
  backdrop-filter: blur(3px);
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 51;
  width: min(430px, 94vw);
  background: var(--card);
  border-left: 1px solid var(--line);
  box-shadow: -30px 0 60px -40px rgba(30, 24, 12, 0.5);
  display: flex;
  flex-direction: column;
}

.d-head {
  padding: 18px 18px 12px;
  border-bottom: 1px solid var(--line);
}

.d-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  padding: 0 10px;
  height: 36px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: #fffdf8;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.search:focus-within {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 3px rgba(160, 146, 116, 0.14);
}

.s-ico {
  width: 15px;
  height: 15px;
  flex: none;
  color: #a9a08a;
}

.s-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink);
}

.s-input::placeholder {
  color: #b3a98f;
}

.s-clear {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 9px;
  color: var(--muted);
  background: var(--paper-2);
  flex: none;
}

.s-hint {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: #b3a98f;
  padding: 2px 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
}

.no-hit {
  padding: 40px 16px;
  text-align: center;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.7;
}

.nh-mark {
  font-size: 26px;
  opacity: 0.35;
  margin-bottom: 8px;
}

.nh-sub {
  font-size: 11px;
  color: #a9a08a;
  margin-top: 4px;
}

.close {
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  color: var(--muted);
  border: 1px solid var(--line);
}

.close:hover {
  background: var(--paper-2);
}

.d-body {
  overflow-y: auto;
  padding: 12px 14px 40px;
  flex: 1;
}

.group + .group {
  margin-top: 16px;
}

.g-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 4px 7px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ink-2);
}

.g-dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}

.g-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
}

.g-items {
  display: grid;
  gap: 3px;
}

.g-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  text-align: left;
  transition: all 0.15s ease;
}

.g-item:hover {
  background: var(--paper-2);
}

.g-item.active {
  border-color: var(--line-strong);
  background: var(--paper-2);
}

.g-item.seen .gi-name {
  color: var(--ink);
}

.gi-name {
  font-size: 12.5px;
  color: var(--muted);
}

.g-item.seen .gi-name {
  font-weight: 600;
}

.gi-en {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: #b3a98f;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}

.d-foot {
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--muted);
}

.reset {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: #a16207;
  border: 1px solid #e8dcbd;
  border-radius: var(--r-sm);
  padding: 5px 9px;
  background: #fdf8ea;
  transition: all 0.16s ease;
}

.reset:hover {
  background: #fbf1d8;
}

/* 待确认态：从琥珀提示切换成明确的危险红，颜色即状态 */
.reset[data-armed='true'] {
  background: #b91c1c;
  border-color: #b91c1c;
  color: #fff;
}

.gi-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  flex: none;
}
</style>
