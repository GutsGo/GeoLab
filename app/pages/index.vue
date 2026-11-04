<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { CONTINENT_META, countryById } from '~/data'
import { CN_REGION_META, provinceById as cnProvinceById } from '~/data/china'
import type { Filter } from '~/composables/useDeck'
import { useAchievements } from '~/composables/useAchievements'

type View = 'draw' | 'globe' | 'game'
/** 全球视图的地图风格：平面（默认）/ 微3D 地形 */
type MapStyle = 'flat' | 'terrain'

const TerrainMap = defineAsyncComponent(() => import('~/components/TerrainMap.vue'))

const deck = useDeck()
const achv = useAchievements()
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

/* ---------- 视图常驻：首次访问才挂载，之后只切可见性不销毁 ----------
 * 全球视图里的地图组件（deck.gl 实例、canvas、WebGL 上下文）销毁重建会
 * 闪一下并跳视角，所以 globe/game 一旦去过就保持挂载，用 v-show 隐藏 */
const globeVisited = ref(false)
const gameVisited = ref(false)
watch(view, (v) => {
  if (v === 'globe') globeVisited.value = true
  else if (v === 'game') gameVisited.value = true
})

/* ---------- 地图风格切换：平面为默认，选择跟随 useState 持久化到 localStorage ---------- */
const MAP_STYLE_KEY = 'geolab.mapview.v1'
const mapStyle = useState<MapStyle>('geo-map-style', () => 'flat')

watch(mapStyle, (v) => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MAP_STYLE_KEY, v)
  } catch {
    /* quota 或隐私模式，放弃持久化 */
  }
})
const indexOpen = ref(false)
const achvOpen = ref(false)
const compareOpen = ref(false)
const scanKey = ref(0)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

/* ---------- 中国省区：不设独立顶层视图，作为「范围」并入抽卡与挑战 ---------- */
const cn = useChina()
const cnSeenSet = cn.seenSet
const cnSeenCount = cn.seenCount
const cnCurrent = cn.current
const cnCurrentId = cn.currentId
const cnHistory = cn.history
const cnTotal = cn.total
/** 抽卡视图：当前抽的是省区（true）还是国家（false） */
const drawCn = ref(false)
/** 挑战视图：世界国家 / 中国省区 */
const gameScope = ref<'world' | 'cn'>('world')
const cnQuizRef = ref<{ onKey: (e: KeyboardEvent) => void } | null>(null)
const cnHueOf = (id: string) => {
  const p = cnProvinceById(id)
  return p ? CN_REGION_META[p.region].hue : undefined
}

function cnDraw() {
  const p = cn.draw()
  if (p) flash(`解锁：${p.name}（${p.short}）`)
}

function cnPick(id: string) {
  cn.focusProvince(id)
}

/** 省区浏览的上一个：历史栈第二位 */
function cnBack() {
  if (cnHistory.value.length >= 2) cn.focusProvince(cnHistory.value[1] ?? '')
}

/** 切到省区范围；一张卡都没有就先抽一张 */
function toggleDrawCn() {
  drawCn.value = true
  if (!cnCurrent.value) cnDraw()
}

/** 抽卡视图的「抽一个」：按当前范围决定抽国家还是省区 */
function drawOne() {
  if (drawCn.value) cnDraw()
  else draw()
}

const accent = computed(() => (current.value ? CONTINENT_META[current.value.continent].hue : '#1d4ed8'))
const ringLen = 2 * Math.PI * 11
const dash = computed(() => `${(seenPct.value / 100) * ringLen} ${ringLen}`)

/** 当前范围内 SRS 已到期待复习的国家数 */
const dueCount = computed(() => deck.dueCount.value)

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

/** 成就解锁队列逐条弹出：上一条 toast 放完再弹下一条 */
function drainUnlocked() {
  if (achv.justUnlocked.value.length === 0) return
  const hit = achv.shiftUnlocked()
  if (hit) flash(`成就解锁：${hit.title}`)
  setTimeout(drainUnlocked, 2600)
}

watch(
  () => achv.justUnlocked.value.length,
  (n, prev) => {
    if (n > (prev ?? 0)) drainUnlocked()
  },
)

function switchView(v: View) {
  if (view.value === v) return
  view.value = v
}

/** 抽一个，名字随结果直接切换；抽到到期复习的国家时给出提示 */
function draw() {
  const wasCleared = poolCleared.value
  deck.draw()
  const reviewId = deck.lastDrawReview.value
  const c = current.value
  if (reviewId && c && c.id === reviewId) {
    const days = deck.seenDaysAgo(reviewId)
    flash(days != null && days > 0 ? `复习：${c.name} · 上次 ${days} 天前` : `复习：${c.name}`)
    return
  }
  if (!wasCleared && poolCleared.value && total.value > 0) flash('这个范围已全部解锁')
}

function chooseFilter(f: string) {
  drawCn.value = false
  deck.setFilter(f as Filter)
}

function onPick(id: string) {
  deck.focusCountry(id)
  drawCn.value = false // 具体国家一律落在国家地图上，别停在省区范围
  indexOpen.value = false
  compareOpen.value = false
  view.value = 'draw'
}

/** 二次确认在索引抽屉内完成，这里只负责执行 */
function onReset() {
  deck.resetProgress()
  indexOpen.value = false
  flash('学习进度已清空')
}

function onMapPick(id: string) {
  if (countryById.has(id)) {
    deck.focusCountry(id)
    drawCn.value = false
    view.value = 'draw'
    return
  }
  flash('该国资料暂未收录')
}

function onGameOpen(id: string) {
  deck.focusCountry(id)
  drawCn.value = false
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

  if (indexOpen.value || achvOpen.value || compareOpen.value) {
    if (e.key === 'Escape') {
      indexOpen.value = false
      achvOpen.value = false
      compareOpen.value = false
    }
    return
  }

  // 挑战视图：省区范围时按键交给 ChinaQuiz（1-4 / Enter），世界范围交给 GamePanel 自己处理
  if (view.value === 'game') {
    if (e.key === 'Escape') {
      view.value = 'draw'
      return
    }
    if (gameScope.value === 'cn') cnQuizRef.value?.onKey(e)
    return
  }

  const onButton = !!el?.closest('button, a, [role="button"]')

  if (view.value === 'draw') {
    switch (e.code) {
      case 'Space':
        if (onButton) return // 让按钮自己响应空格，别抢
        e.preventDefault()
        drawOne()
        return
      case 'ArrowRight':
        e.preventDefault()
        drawOne()
        return
      case 'ArrowLeft':
        e.preventDefault()
        if (drawCn.value) cnBack()
        else if (canBack.value) deck.back()
        return
    }
  }

  switch (e.key.toLowerCase()) {
    case 'i':
      indexOpen.value = true
      break
    case 'a':
      achvOpen.value = true
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
  achv.hydrate()
  cn.hydrate()
  try {
    const saved = localStorage.getItem(MAP_STYLE_KEY)
    if (saved === 'flat' || saved === 'terrain') mapStyle.value = saved
  } catch {
    /* 忽略损坏的本地存储 */
  }
  if (!current.value) draw()
  window.addEventListener('keydown', onKey)
})

// 换国家就重播轮廓描绘动画
watch(currentId, (id, prev) => {
  if (id && id !== prev) scanKey.value++
})

// 弹层打开时锁住背景滚动
watch([indexOpen, achvOpen, compareOpen], ([a, b, c]) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('no-scroll', a || b || c)
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
        <button class="btn" @click="achvOpen = true">成就</button>
      </div>
    </header>

    <!-- ============ 主内容区：三个视图共用一个 main，flex:1 把 footer 顶到视口底 ============ -->
    <main class="views">
      <!-- ============ 抽卡视图（默认，始终挂载） ============ -->
      <div v-show="view === 'draw'">
      <div class="filter-row">
        <div class="chips">
          <button v-for="f in ['全部', ...deck.CONTINENTS]" :key="f" class="chip" :data-active="!drawCn && filter === f"
            @click="chooseFilter(f)">
            {{ f }}
          </button>
          <span class="chip-sep" aria-hidden="true"></span>
          <button class="chip" :data-active="drawCn" title="切换到中国省级行政区" @click="toggleDrawCn">
            中国省区
          </button>
        </div>
        <div class="right-tools">
          <template v-if="drawCn">
            <span class="pool-hint mono">已解锁 {{ cnSeenCount }} / {{ cnTotal }} · <kbd>SPACE</kbd> 抽取</span>
          </template>
          <template v-else>
            <span v-if="dueCount > 0" class="pool-hint review mono">待复习 {{ dueCount }}</span>
            <span class="pool-hint mono" :class="{ done: poolCleared }">
              <template v-if="poolCleared">{{ pools.length }} 个已看完</template>
              <template v-else>{{ remaining }} / {{ pools.length }} 待解锁</template>
              · <kbd>SPACE</kbd> 抽取
            </span>
          </template>
        </div>
      </div>

      <!-- 国家范围：世界地图 + 国家卡 -->
      <div v-if="!drawCn" class="stage">
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
            </div>
          </div>

          <!-- 操作条在地图外：不遮挡地图主体，移动端也不会误触 -->
          <div class="map-actions-bar">
            <button class="btn icon-btn" :disabled="!canBack" title="上一个 (←)" @click="deck.back()">←</button>
            <button class="btn icon-btn" :disabled="!current" title="与其他国家并排对比" @click="compareOpen = true">
              对比
            </button>
            <Motion as="button" class="draw-btn" :while-hover="{ y: -2 }" :while-tap="{ scale: 0.96 }"
              :transition="{ type: 'spring', stiffness: 420, damping: 26 }" @click="draw">
              抽取一个
              <small>SPACE</small>
            </Motion>
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

      <!-- 省区范围：中国地图 + 省区卡，与国家范围同一套舞台 -->
      <div v-else class="stage">
        <section class="map-side">
          <div class="map-stage">
            <ClientOnly>
              <ChinaMap :current-id="cnCurrentId" :hue-of="cnHueOf" @pick="cnPick" />
              <template #fallback>
                <div class="map-skeleton">地图装载中…</div>
              </template>
            </ClientOnly>

            <!-- 与抽卡视图同款 HUD：省名悬浮在海面上 -->
            <div class="hud hud-top">
              <div class="map-label">
                <span class="kicker">{{ cnCurrent ? cnCurrent.region + ' / ' + cnCurrent.kind : '中国省区' }}</span>
                <AnimatePresence mode="wait">
                  <Motion :key="cnCurrentId || 'none'" as="div" class="cur-name" :initial="{ opacity: 0, y: 8 }"
                    :animate="{ opacity: 1, y: 0 }" :exit="{ opacity: 0, y: -8 }"
                    :transition="{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }">
                    {{ cnCurrent ? cnCurrent.name : '按下抽取' }}
                    <span v-if="cnCurrent" class="cur-en">{{ cnCurrent.seat }}</span>
                  </Motion>
                </AnimatePresence>
              </div>
            </div>
          </div>
          <div class="map-actions-bar">
            <button class="btn icon-btn" :disabled="cnHistory.length < 2" title="上一个 (←)" @click="cnBack">←</button>
            <Motion as="button" class="draw-btn" :while-hover="{ y: -2 }" :while-tap="{ scale: 0.96 }"
              :transition="{ type: 'spring', stiffness: 420, damping: 26 }" @click="cnDraw">
              抽取一个
              <small>SPACE</small>
            </Motion>
          </div>
        </section>

        <aside class="card-slot">
          <AnimatePresence mode="wait">
            <Motion :key="cnCurrentId || 'empty'" as="div" :initial="{ opacity: 0, y: 14 }"
              :animate="{ opacity: 1, y: 0 }" :exit="{ opacity: 0, y: -10 }"
              :transition="{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }">
              <ChinaDetail :province="cnCurrent" @pick="cnPick" />
            </Motion>
          </AnimatePresence>
        </aside>
      </div>
    </div>

    <!-- ============ 全球视图：首次访问后常驻，地图实例不销毁 ============ -->
    <div v-if="globeVisited" v-show="view === 'globe'">
      <div class="globe-view">
        <section class="map-stage">
          <ClientOnly>
            <!-- KeepAlive：平面/微3D 互切不销毁重建，deck 实例与视角原样保留 -->
            <KeepAlive>
              <WorldMap v-if="mapStyle === 'flat'" :country-id="currentId" :color="accent"
                :fallback="current?.cities[0] ? { lat: current.cities[0].lat, lng: current.cities[0].lng } : null"
                @pick="onMapPick" />
              <TerrainMap v-else :country-id="currentId" :color="accent" @pick="onMapPick" />
            </KeepAlive>
            <template #fallback>
              <div class="map-skeleton">地图装载中…</div>
            </template>
          </ClientOnly>
          <div class="hud hud-top">
            <span class="hud-chip">全球视图</span>
            <div class="style-switch" role="tablist" aria-label="地图风格">
              <button class="ss-btn" role="tab" :aria-selected="mapStyle === 'flat'"
                :data-active="mapStyle === 'flat'" title="暖纸平面地图" @click="mapStyle = 'flat'">
                平面
              </button>
              <button class="ss-btn" role="tab" :aria-selected="mapStyle === 'terrain'"
                :data-active="mapStyle === 'terrain'" title="微3D 地形视图（可拖拽旋转）" @click="mapStyle = 'terrain'">
                微3D
              </button>
            </div>
            <span class="hud-chip soft">{{ mapStyle === 'terrain' ? '拖拽平移 · 滚轮缩放 · 双击复位 · 点击国家' : '点击任意国家进入抽卡视图' }}</span>
          </div>
          <div class="hud hud-bottom">
            <div class="legend">
              <span><i class="swatch" style="background: #ece6d7; border: 1px solid #dcd3bd"></i>其他国家</span>
              <span><i class="swatch" :style="{ background: accent }"></i>当前目标</span>
            </div>
          </div>
        </section>

        <div class="globe-side">
          <div class="side-card">
            <div class="side-head">
              <span class="kicker">学习进度</span>
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
            <div class="stat-strip">
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
        </div>
      </div>
    </div>

    <!-- ============ 挑战视图：首次访问后常驻 ============ -->
    <div v-if="gameVisited" v-show="view === 'game'">
      <div class="filter-row">
        <div class="chips">
          <button class="chip" :data-active="gameScope === 'world'" @click="gameScope = 'world'">世界国家</button>
          <button class="chip" :data-active="gameScope === 'cn'" @click="gameScope = 'cn'">中国省区</button>
        </div>
        <div class="right-tools">
          <span class="pool-hint mono">
            {{ gameScope === 'world' ? '每日 10 题 · 完成即打卡' : `已解锁 ${cnSeenCount} / ${cnTotal}` }}
          </span>
        </div>
      </div>

      <template v-if="gameScope === 'world'">
        <div class="game-intro">
          <div>
            <span class="kicker">看轮廓答题</span>
            <h2 class="display game-title">只给一张轮廓图，你能认出它吗</h2>
          </div>
          <p class="game-desc">
            每天 10 题固定挑战，轮廓、国旗、地图定位轮番上阵，完成即打卡。认出国名得 2 分，连首都一起答对再得 1
            分，每看一条提示减 1 分。答错的国家过几题会回来重考，看过的国家隔天也会回来复习。
          </p>
        </div>
        <GamePanel @open="onGameOpen" />
      </template>
      <ChinaQuiz v-else ref="cnQuizRef" />
    </div>
    </main>

    <footer class="foot-note">
      <span class="mono">共 {{ total }} 个国家与地区</span>
      <span class="dim">数据为学习用途整理，边界以官方地图为准。</span>
    </footer>

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>

    <CountryIndex :open="indexOpen" :seen="seen" :current-id="currentId" @close="indexOpen = false" @pick="onPick"
      @reset="onReset" />

    <AchievementPanel :open="achvOpen" @close="achvOpen = false" />

    <ComparePanel :open="compareOpen" :base="current" @close="compareOpen = false" @pick="onPick" />
  </div>
</template>

<style scoped>
/* 主内容区：撑满 .shell 里 topbar 与 footer 之间的剩余空间 */
.views {
  flex: 1 0 auto;
}

/* ---------- 顶部视图切换 ---------- */
.view-switch {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--card);
  box-shadow: var(--shadow-sm);
}

.vs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border-radius: var(--r-sm);
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
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 洲筛选与「中国省区」范围之间的竖分隔 */
.chip-sep {
  width: 1px;
  height: 18px;
  background: var(--line-strong, #d8cdb2);
  margin-inline: 4px;
  align-self: center;
}

.pool-hint.done {
  color: #a16207;
}

.pool-hint.review {
  color: #b45309;
  padding: 3px 10px;
  border: 1px dashed #d8b98a;
  border-radius: 999px;
  background: #fdf6e3;
}

kbd {
  font-family: var(--mono);
  font-size: 10px;
  padding: 2px 5px;
  border-radius: var(--r-xs);
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
  /* PC 端右上角：挂在顶栏下方，不遮索引/成就按钮 */
  top: 84px;
  right: 20px;
  z-index: 70;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(25, 23, 18, 0.92);
  color: #fdf9ee;
  font-size: 12.5px;
  letter-spacing: 0.02em;
  box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  max-width: min(420px, calc(100vw - 40px));
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
  transform: translateY(-10px);
}

@media (max-width: 720px) {
  .toast {
    /* 移动端顶部居中：避开顶栏第一行两侧的内容 */
    top: 14px;
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: translate(-50%, -10px);
  }
}

.right-tools {
  display: flex;
  align-items: center;
}

.map-side {
  /* flex 列 + min-width:0：既防溢出，又让 .map-stage 能拉伸到与卡片等高 */
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.card-slot {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 大屏：右栏高度钉死为视口函数（不随卡片内容变化）——
   行高恒定，左侧地图不再随切卡“呼吸” */
@media (min-width: 1121px) {
  .card-slot {
    height: clamp(560px, 68vh, 680px);
  }
}

/* Motion 的包裹 div：拉满定高列，让卡片垂直填满 */
.card-slot > div {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* 大屏：地图放开宽高比，随列高拉伸；海面渐变填满，
   地形经 preserveAspectRatio 居中不变形。
   装载骨架同样拉满——否则刷新瞬间它还按 aspect-ratio 只填上半，
   map-stage 底下会露出一段与卡片等高差的空白 */
@media (min-width: 1121px) {
  .map-stage :deep(.dmap),
  .map-stage :deep(.cmap),
  .map-stage .map-skeleton {
    height: 100%;
    aspect-ratio: auto;
  }
}

/* ---------- 地图台面：不套卡片，海面自身就是背景，柔影定边界 ---------- */
.map-stage {
  position: relative;
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
  flex: 1;
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
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 253, 247, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px -8px rgba(25, 23, 18, 0.45);
  font-size: 9.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-2);
}

.hud-chip.soft {
  letter-spacing: 0.08em;
  text-transform: none;
  font-size: 10px;
  color: var(--muted);
}

/* 平面 / 微3D 风格切换：与 hud-chip 同一悬浮语言 */
.style-switch {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.65);
  background: rgba(255, 253, 247, 0.72);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px -8px rgba(25, 23, 18, 0.45);
}

.ss-btn {
  padding: 5px 13px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--ink-2);
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.ss-btn:hover {
  background: rgba(25, 23, 18, 0.08);
}

.ss-btn[data-active='true'] {
  background: var(--ink);
  color: #fdf9ee;
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
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--muted);
  text-transform: uppercase;
}

/* 操作条：地图下方的固定控件位，不随取景漂移、不遮挡内容 */
.map-actions-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}


/* ---------- 全球视图 ---------- */
.globe-view {
  display: grid;
  gap: 14px;
}

.globe-side {
  display: grid;
}

.side-card {
  border-radius: var(--r-md);
  background: var(--card);
  box-shadow: var(--shadow-soft);
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
  /* 六大洲自适应排布：宽卡 3 列 × 2 行，窄屏自动减列 */
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px 20px;
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
  font-size: 10px;
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

/* 合并后的统计行：横排在大洲进度下方，虚线分隔 */
.stat-strip {
  display: flex;
  gap: 28px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}

.stat-strip .stat-row {
  border-bottom: none;
  padding-bottom: 0;
}

.stat-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--ink-2);
}

.stat-row b {
  font-size: 12.5px;
  color: var(--ink);
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
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--muted);
  flex-wrap: wrap;
}

@media (max-width: 1120px) {
  .card-slot {
    min-height: 0;
  }
}

@media (max-width: 720px) {
  .topbar {
    gap: 10px;
  }

  /* 窄屏换行后 top-actions 独占一行：进度居左，索引/成一组靠右。
     对三个孩子直接 space-between 会把「索引」顶到行中央，所以用 auto margin 推按钮组 */
  .top-actions {
    flex: 1 1 100%;
  }

  .top-actions .progress-pill {
    margin-right: auto;
  }

  .view-switch {
    /* 不满宽：保持内容宽度，独占一行时居中 */
    order: 3;
    margin-inline: auto;
  }

  .vs-btn {
    justify-content: center;
  }

  .hud {
    left: 12px;
    right: 12px;
  }

  .map-actions-bar {
    justify-content: stretch;
  }

  .map-actions-bar .draw-btn {
    flex: 1;
    justify-content: center;
  }

  .cur-name {
    font-size: 22px;
  }
}
</style>
