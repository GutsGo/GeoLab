<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { CONTINENT_META, countryById } from '~/data'
import type { Filter } from '~/composables/useDeck'

type View = 'draw' | 'globe' | 'game'

const deck = useDeck()
const {
  current,
  currentId,
  filter,
  pools,
  pickedCity,
  seen,
  seenCount,
  total,
  seenPct,
  continentStats,
  remaining,
  poolCleared,
  canBack,
} = deck

const view = ref<View>('draw')
const indexOpen = ref(false)
const scanKey = ref(0)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const accent = computed(() => (current.value ? CONTINENT_META[current.value.continent].hue : '#1d4ed8'))
const ringLen = 2 * Math.PI * 11
const dash = computed(() => `${(seenPct.value / 100) * ringLen} ${ringLen}`)

const VIEWS: { key: View; label: string; tip: string }[] = [
  { key: 'draw', label: '抽卡', tip: '一次只看一张地图 (D)' },
  { key: 'globe', label: '全球', tip: '看整张世界地图 (G)' },
  { key: 'game', label: '挑战', tip: '看轮廓答题 (C)' },
]

function flash(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2400)
}

function switchView(v: View) {
  if (view.value === v) return
  view.value = v
}

/** 抽一个，名字随结果直接切换 */
function draw() {
  const wasCleared = poolCleared.value
  deck.draw()
  if (!wasCleared && poolCleared.value && total.value > 0) flash('这个范围已全部解锁')
}

function chooseFilter(f: string) {
  deck.setFilter(f as Filter)
}

function onPick(id: string) {
  deck.focusCountry(id)
  indexOpen.value = false
  view.value = 'draw'
}

function onReset() {
  if (window.confirm('清空所有已解锁记录？')) {
    deck.resetProgress()
    indexOpen.value = false
    flash('学习进度已清空')
  }
}

function onMapPick(id: string) {
  if (countryById.has(id)) {
    deck.focusCountry(id)
    view.value = 'draw'
    return
  }
  flash('该国资料暂未收录')
}

function onGameOpen(id: string) {
  deck.focusCountry(id)
  view.value = 'draw'
}

/** 城市 tab：点具体城市就定位它，点“换一个”就随机换 */
function onShuffleCity(countryId: string, city?: string) {
  if (city) {
    pickedCity.value = city
    return
  }
  const next = deck.cycleCity(countryId, pickedCity.value)
  if (next) flash(`抽到 ${next}`)
}

/** 空格 / 方向键 / 字母快捷键 */
function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return

  if (indexOpen.value) {
    if (e.key === 'Escape') indexOpen.value = false
    return
  }

  // 挑战视图的按键交给 GamePanel 自己处理（1-4 / H / Enter）
  if (view.value === 'game') {
    if (e.key === 'Escape') view.value = 'draw'
    return
  }

  const onButton = !!el?.closest('button, a, [role="button"]')

  if (view.value === 'draw') {
    switch (e.code) {
      case 'Space':
        if (onButton) return // 让按钮自己响应空格，别抢
        e.preventDefault()
        draw()
        return
      case 'ArrowRight':
        e.preventDefault()
        draw()
        return
      case 'ArrowLeft':
        if (!canBack.value) return
        e.preventDefault()
        deck.back()
        return
    }
  }

  switch (e.key.toLowerCase()) {
    case 'i':
      indexOpen.value = true
      break
    case '/':
      e.preventDefault()
      indexOpen.value = true
      break
    case 'd':
      view.value = 'draw'
      break
    case 'g':
      view.value = 'globe'
      break
    case 'c':
      view.value = 'game'
      break
    case 'escape':
      indexOpen.value = false
      break
  }
}

onMounted(() => {
  deck.hydrate()
  if (!current.value) draw()
  window.addEventListener('keydown', onKey)
})

// 换国家就重播轮廓描绘动画
watch(currentId, (id, prev) => {
  if (id && id !== prev) scanKey.value++
})

// 弹层打开时锁住背景滚动
watch(indexOpen, (i) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('no-scroll', i)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">G</div>
        <div>
          <div class="brand-title">GeoLab</div>
          <div class="brand-sub">抽取式地理学习</div>
        </div>
      </div>

      <nav class="view-switch">
        <button v-for="v in VIEWS" :key="v.key" class="vs-btn" :data-active="view === v.key" :title="v.tip"
          @click="switchView(v.key)">
          <span class="vs-label">{{ v.label }}</span>
        </button>
      </nav>

      <div class="top-actions">
        <div class="progress-pill" :title="`已解锁 ${seenCount} / ${total}`">
          <svg class="ring" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="none" stroke="#e3dccb" stroke-width="2.5" />
            <circle cx="13" cy="13" r="11" fill="none" :stroke="accent" stroke-width="2.5" stroke-linecap="round"
              :stroke-dasharray="dash" transform="rotate(-90 13 13)" style="transition: stroke-dasharray 0.5s ease" />
          </svg>
          <span>
            已解锁 <b class="mono">{{ seenCount }}</b> / {{ total }}
          </span>
        </div>
        <button class="btn" @click="indexOpen = true">索引</button>
      </div>
    </header>

    <!-- ============ 抽卡视图 ============ -->
    <template v-if="view === 'draw'">
      <div class="filter-row">
        <div class="chips">
          <button v-for="f in ['全部', ...deck.CONTINENTS]" :key="f" class="chip" :data-active="filter === f"
            @click="chooseFilter(f)">
            {{ f }}
          </button>
        </div>
        <div class="right-tools">
          <span class="pool-hint mono" :class="{ done: poolCleared }">
            <template v-if="poolCleared">{{ pools.length }} 个已看完</template>
            <template v-else>{{ remaining }} / {{ pools.length }} 待解锁</template>
            · <kbd>SPACE</kbd> 抽取
          </span>
        </div>
      </div>

      <div class="stage">
        <section class="map-side">
          <div class="map-stage">
            <ClientOnly>
              <DrawMap :country-id="currentId" :color="accent" :pins="current?.cities" :anim-key="scanKey"
                :focus-pin="pickedCity" :fallback="current?.cities[0] ? { lat: current.cities[0].lat, lng: current.cities[0].lng } : null
                  " />
              <template #fallback>
                <div class="map-skeleton">地图装载中…</div>
              </template>
            </ClientOnly>

            <!-- 不套卡片：地图自身的海面就是台面，信息以 HUD 悬浮其上 -->
            <div class="hud hud-top">
              <div class="map-label">
                <span class="kicker">{{ current ? current.continent + ' / ' + current.subregion : 'READY' }}</span>
                <AnimatePresence mode="wait">
                  <Motion :key="currentId || 'none'" as="div" class="cur-name" :initial="{ opacity: 0, y: 8 }"
                    :animate="{ opacity: 1, y: 0 }" :exit="{ opacity: 0, y: -8 }"
                    :transition="{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }">
                    {{ current ? current.name : '按下抽取' }}
                    <span v-if="current" class="cur-en">{{ current.nameEn }}</span>
                  </Motion>
                </AnimatePresence>
              </div>
              <div class="map-actions">
                <button class="btn icon-btn" :disabled="!canBack" title="上一个 (←)" @click="deck.back()">←</button>
                <Motion as="button" class="draw-btn" :while-hover="{ y: -2 }" :while-tap="{ scale: 0.96 }"
                  :transition="{ type: 'spring', stiffness: 420, damping: 26 }" @click="draw">
                  抽取一个
                  <small>SPACE</small>
                </Motion>
              </div>
            </div>
          </div>
        </section>

        <aside class="card-slot">
          <!-- mode="wait" 是串行的：退出 + 进入各一次，所以这里把单程压到 0.18s。
               filter: blur 每帧要重绘整张卡片，在低端机上比位移贵一个数量级，去掉。 -->
          <AnimatePresence mode="wait">
            <Motion :key="currentId || 'empty'" as="div" :initial="{ opacity: 0, y: 14 }"
              :animate="{ opacity: 1, y: 0 }" :exit="{ opacity: 0, y: -10 }"
              :transition="{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }">
              <CountryDetail :country="current" :highlight-city="pickedCity" @pick="deck.focusCountry"
                @shuffle-city="onShuffleCity" />
            </Motion>
          </AnimatePresence>
        </aside>
      </div>
    </template>

    <!-- ============ 全球视图 ============ -->
    <template v-else-if="view === 'globe'">
      <div class="globe-view">
        <section class="map-stage">
          <ClientOnly>
            <WorldMap :country-id="currentId" :color="accent"
              :fallback="current?.cities[0] ? { lat: current.cities[0].lat, lng: current.cities[0].lng } : null"
              @pick="onMapPick" />
            <template #fallback>
              <div class="map-skeleton">地图装载中…</div>
            </template>
          </ClientOnly>
          <div class="hud hud-top">
            <span class="hud-chip">全球视图</span>
            <span class="hud-chip soft">点击任意国家进入抽卡视图</span>
          </div>
          <div class="hud hud-bottom">
            <div class="legend">
              <span><i class="swatch" style="background: #ece6d7; border: 1px solid #dcd3bd"></i>其他国家</span>
              <span><i class="swatch" :style="{ background: accent }"></i>当前目标</span>
            </div>
            <button class="btn" :disabled="!currentId" @click="switchView('draw')">回到抽卡</button>
          </div>
        </section>

        <div class="globe-side">
          <div class="side-card">
            <div class="side-head">
              <span class="kicker">大洲进度</span>
              <span class="mono dim">{{ seenPct }}%</span>
            </div>
            <div class="continent-board">
              <div v-for="s in continentStats" :key="s.continent" class="cb-item">
                <div class="cb-top">
                  <span class="cb-name">{{ s.continent }}</span>
                  <span class="mono cb-num">{{ s.got }}/{{ s.total }}</span>
                </div>
                <div class="cb-track">
                  <div class="cb-fill" :style="{
                    width: (s.total ? (s.got / s.total) * 100 : 0) + '%',
                    background: CONTINENT_META[s.continent].hue,
                  }"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="side-card">
            <div class="side-head">
              <span class="kicker">学习记录</span>
            </div>
            <div class="stat-list">
              <div class="stat-row">
                <span>已解锁国家</span>
                <b class="mono">{{ seenCount }} / {{ total }}</b>
              </div>
              <div class="stat-row">
                <span>本次筛选剩余</span>
                <b class="mono">{{ remaining }} / {{ pools.length }}</b>
              </div>
            </div>
          </div>

          <div class="side-card tip-card">
            <div class="kicker">怎么用</div>
            <p>单国地图会逐笔描绘轮廓；要定位可切到全球视图，点击国家即可返回。</p>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 挑战视图 ============ -->
    <template v-else>
      <div class="game-intro">
        <div>
          <span class="kicker">看轮廓答题</span>
          <h2 class="display game-title">只给一张轮廓图，你能认出它吗</h2>
        </div>
        <p class="game-desc">
          随机给出国家轮廓，认出国名得 2 分，连首都一起答对再得 1 分；每看一条提示减 1 分。答错的国家过几题会回来重考。
        </p>
      </div>
      <GamePanel @open="onGameOpen" />
    </template>

    <footer class="foot-note">
      <span class="mono">共 {{ total }} 个国家与地区</span>
      <span class="dim">数据为学习用途整理，边界以官方地图为准。</span>
    </footer>

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>

    <CountryIndex :open="indexOpen" :seen="seen" :current-id="currentId" @close="indexOpen = false" @pick="onPick"
      @reset="onReset" />
  </div>
</template>

<style scoped>
/* ---------- 顶部视图切换 ---------- */
.view-switch {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--card);
  box-shadow: var(--shadow-sm);
}

.vs-btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--muted);
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.vs-btn:hover {
  background: var(--paper-2);
}

.vs-btn[data-active='true'] {
  background: var(--ink);
  color: #fdf9ee;
}

.vs-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 顶栏内按钮与进度胶囊锁同一高度、同一形状语言（胶囊形），别各撑各的 */
.top-actions .btn {
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
}

.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.pool-hint {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pool-hint.done {
  color: #a16207;
}

kbd {
  font-family: var(--mono);
  font-size: 9px;
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: #fffdf8;
  color: var(--ink-2);
  letter-spacing: 0.06em;
}

.icon-btn {
  /* 与右侧主按钮等高，避免一排按钮大小不一 */
  padding: 15px 17px;
  font-size: 15px;
  line-height: 1;
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.game-intro {
  transition: opacity 0.2s ease;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  z-index: 70;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(25, 23, 18, 0.92);
  color: #fdf9ee;
  font-size: 12.5px;
  letter-spacing: 0.02em;
  box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

.right-tools {
  display: flex;
  align-items: center;
}

.map-side {
  display: grid;
  /* minmax(0, 1fr) 而非 1fr：否则轨道会按最宽子项的 min-content 撑开，
     下面 .recent-strip 的 nowrap 标签能把整列顶到 443px，移动端就横向溢出了 */
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
}

.card-slot {
  min-height: 620px;
}

/* ---------- 地图台面：不再套卡片，地图自身的海面就是背景 ---------- */
.map-stage {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
}

/* 悬浮信息层：只放信息，不铺底色，让地图保持完整 */
.hud {
  position: absolute;
  left: 18px;
  right: 18px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}

.hud > * {
  pointer-events: auto;
}

.hud-top {
  top: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.hud-bottom {
  bottom: 16px;
  flex-wrap: wrap;
}

.hud-chip {
  display: inline-flex;
  align-items: center;
  padding: 7px 13px;
  border-radius: 999px;
  background: rgba(255, 253, 247, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 22px -14px rgba(25, 23, 18, 0.5);
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-2);
}

.hud-chip.soft {
  letter-spacing: 0.08em;
  text-transform: none;
  font-size: 11px;
  color: var(--muted);
}

.map-skeleton {
  aspect-ratio: 1000 / 620;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: #6d7f85;
  background: #e6eff1;
}

/* 国名直接浮在海面上：用白色光晕兜住与陆地/经纬网的对比度 */
.map-label {
  display: grid;
  gap: 3px;
}

.map-label .kicker {
  color: var(--ink-2);
  text-shadow:
    0 1px 0 rgba(255, 253, 247, 0.85),
    0 0 10px rgba(255, 253, 247, 0.9);
}

.cur-name {
  font-family: var(--serif);
  font-size: 26px;
  line-height: 1.15;
  display: flex;
  align-items: baseline;
  gap: 9px;
  min-height: 1.15em;
  color: var(--ink);
  text-shadow:
    0 1px 0 rgba(255, 253, 247, 0.9),
    0 0 14px rgba(255, 253, 247, 0.95);
}

.cur-en {
  font-family: var(--sans);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--muted);
  text-transform: uppercase;
}

.map-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ---------- 全球视图 ---------- */
.globe-view {
  display: grid;
  gap: 14px;
}

.globe-side {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

.side-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 253, 247, 0.82);
  padding: 14px 16px 16px;
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.dim {
  opacity: 0.75;
}

.continent-board {
  display: grid;
  grid-template-columns: 1fr;
  gap: 11px;
}

.cb-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11.5px;
  margin-bottom: 5px;
}

.cb-name {
  color: var(--ink-2);
}

.cb-num {
  font-size: 9.5px;
  color: var(--muted);
}

.cb-track {
  height: 5px;
  border-radius: 999px;
  background: var(--paper-2);
  overflow: hidden;
}

.cb-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.stat-list {
  display: grid;
  gap: 9px;
}

.stat-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--ink-2);
  border-bottom: 1px dashed var(--line);
  padding-bottom: 8px;
}

.stat-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.stat-row b {
  font-size: 12.5px;
  color: var(--ink);
}

.tip-card p {
  font-size: 12px;
  line-height: 1.8;
  color: var(--muted);
  margin-top: 8px;
}

/* ---------- 挑战视图 ---------- */
.game-intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.game-title {
  font-size: clamp(20px, 2.4vw, 27px);
  margin-top: 6px;
}

.game-desc {
  max-width: 420px;
  font-size: 12px;
  line-height: 1.75;
  color: var(--muted);
}

.foot-note {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 26px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--muted);
  flex-wrap: wrap;
}

@media (max-width: 1120px) {
  .card-slot {
    min-height: 0;
  }

  .globe-side {
    grid-template-columns: 1fr 1fr;
    display: grid;
  }

  .tip-card {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .topbar {
    gap: 10px;
  }

  .view-switch {
    order: 3;
    width: 100%;
  }

  .vs-btn {
    flex: 1;
    align-items: center;
  }

  .hud {
    left: 12px;
    right: 12px;
  }

  .map-actions {
    width: 100%;
  }

  .map-actions .draw-btn {
    flex: 1;
    justify-content: center;
  }

  .cur-name {
    font-size: 22px;
  }

  .globe-side {
    grid-template-columns: 1fr;
  }
}
</style>
