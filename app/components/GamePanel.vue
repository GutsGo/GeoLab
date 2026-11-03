<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DAILY_SIZE, GAME_META, useGame } from '~/composables/useGame'
import { useAchievements } from '~/composables/useAchievements'
import { useDeck } from '~/composables/useDeck'
import { CONTINENT_META } from '~/data'
import { downloadDataUrl, renderShareCard } from '~/lib/shareCard'
import { todayKey, shiftDay } from '~/lib/date'
import { speechAvailable, speak } from '~/lib/speech'

const emit = defineEmits<{ (e: 'open', id: string): void }>()

const canSpeak = speechAvailable()

function speakAnswer() {
  const name = round.value?.target?.nameEn
  if (name) speak(name, 'en-US')
}

const game = useGame()
const { stats, round, roundNo, mode, daily, checkins, dailyStreak } = game

const deck = useDeck()
const achv = useAchievements()

const animKey = ref(0)

const accuracy = computed(() =>
  stats.value.rounds ? Math.round((stats.value.correct / stats.value.rounds) * 100) : 0,
)
const answered = computed(() => !!round.value && (!!round.value.picked || round.value.skipped))
/** 本轮结束：主题型答错，或首都阶段已作答/跳过（主题型答对会自动进入首都阶段，不算结束） */
const final = computed(() => answered.value && (round.value!.type === 'capital' || round.value!.ok === false))
const canNextHint = computed(
  () => !!round.value && round.value.type !== 'capital' && !round.value.picked && round.value.revealed < round.value.hints.length,
)
const hasOptions = computed(() => !!round.value && round.value.options.length > 0)
const modeDaily = computed(() => mode.value === 'daily')

/** 每日挑战做完且最后一题已看完 → 展示总结与打卡 */
const showSummary = computed(() => modeDaily.value && !!daily.value?.finished && !round.value)

/** 猜首都时把国名写进题干；定位题把目标国写进题干 */
const questionText = computed(() => {
  const r = round.value
  if (!r) return ''
  if (r.type === 'capital') return `${r.target.name} 的首都是？`
  if (r.type === 'locate') return `在世界地图上点出「${r.target.name}」`
  return GAME_META[r.type].question
})

const dailyProgress = computed(() => {
  const d = daily.value
  if (!d) return ''
  return `第 ${Math.min(d.index + 1, d.ids.length)} / ${d.ids.length} 题`
})

/** 最近 14 天（含今天）打卡点，旧的在前 */
const calendarDays = computed(() => {
  const set = new Set(checkins.value)
  const today = todayKey()
  const keys: string[] = []
  for (let i = 13; i >= 0; i--) keys.push(shiftDay(today, -i))
  return keys.map((k) => ({ key: k, on: set.has(k), isToday: k === today }))
})

const letters = ['A', 'B', 'C', 'D']

function next() {
  game.startRound()
  if (round.value) animKey.value++
}

/** 每日挑战做完：收起最后一题，展示总结 */
function finishDaily() {
  game.clearRound()
}

/** 保存每日成绩卡（纯本地 canvas 绘制，导出 PNG） */
function saveDailyCard() {
  const d = daily.value
  if (!d) return
  const data = {
    title: `每日挑战 · ${d.date}`,
    subtitle: '认轮廓 · 识国旗 · 找位置 · 追首都，一天 10 题',
    date: d.date,
    stats: [
      { label: '今日得分', value: String(d.score) },
      { label: '答对题数', value: `${d.correct} / ${d.ids.length}` },
      { label: '连续打卡', value: `${game.dailyStreak.value} 天` },
    ],
    bars: deck.continentStats.value.map((s) => ({
      name: s.continent,
      got: s.got,
      total: s.total,
      hue: CONTINENT_META[s.continent].hue,
    })),
    badges: { got: achv.unlockedCount.value, total: achv.list.value.length },
    seen: deck.seenCount.value,
    total: deck.total.value,
  }
  downloadDataUrl(renderShareCard(data), `geolab-每日挑战-${todayKey()}.png`)
}

function switchMode(m: 'daily' | 'free') {
  if (mode.value === m) return
  game.setMode(m)
  if (!round.value) next()
}

function pick(opt: string) {
  if (!round.value || round.value.picked) return
  game.answer(round.value, opt)
}

function locatePick(id: string) {
  const r = round.value
  if (!r || r.type !== 'locate' || r.picked) return
  game.answer(r, id)
}

function revealHint() {
  if (!round.value) return
  game.reveal(round.value)
}

function skip() {
  game.skipBonus()
}

function optionState(opt: string): 'right' | 'wrong' | 'idle' {
  const r = round.value
  if (!r || !r.picked) return 'idle'
  if (opt === r.answer) return 'right'
  if (opt === r.picked) return 'wrong'
  return 'idle'
}

/** 定位题作答后：在地图上亮出正确答案（对了绿、错了红） */
const locateHighlightId = computed(() => {
  const r = round.value
  if (!r || r.type !== 'locate' || !answered.value) return undefined
  return r.target.id
})
const locateColor = computed(() => {
  const r = round.value
  if (!r) return '#1d4ed8'
  return answered.value ? (r.ok ? '#15803d' : '#b91c1c') : '#1d4ed8'
})

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return

  const key = e.key.toLowerCase()

  if (!round.value) return

  if (key === 'h' && canNextHint.value) {
    e.preventDefault()
    revealHint()
    return
  }

  if (key >= '1' && key <= '4') {
    const idx = Number(key) - 1
    const opt = round.value.options[idx]
    if (opt) pick(opt)
    return
  }

  if (key === 'enter') {
    e.preventDefault()
    // 答对国家的确认停顿期间，Enter 跳过停顿直接进首都题
    if (round.value.awaitCapital) game.advanceToCapital()
    else if (answered.value) {
      if (modeDaily.value && daily.value?.finished) finishDaily()
      else next()
    }
    return
  }
}

onMounted(() => {
  game.hydrate()
  game.hydrateDaily()
  // 只有首次（或上一局已被清掉）才开新题；切 tab 回来要接着做原来的题
  if (!round.value) next()
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- ============ 每日挑战完成：总结与打卡 ============ -->
  <div v-if="showSummary" class="game summary">
    <section class="g-panel sum-panel">
      <div class="g-q">
        <span class="kicker">每日挑战 · {{ daily?.date }}</span>
        <h2 class="display">今天的 {{ daily?.ids.length }} 题做完了</h2>
      </div>

      <div class="sum-grid">
        <div class="sum-item">
          <div class="sum-num mono">{{ daily?.score }}</div>
          <div class="sum-label">今日得分</div>
        </div>
        <div class="sum-item">
          <div class="sum-num mono">{{ daily?.correct }} / {{ daily?.ids.length }}</div>
          <div class="sum-label">主题答对</div>
        </div>
        <div class="sum-item">
          <div class="sum-num mono">{{ dailyStreak }}</div>
          <div class="sum-label">连续打卡（天）</div>
        </div>
      </div>

      <div class="cal">
        <div class="hints-head">
          <span class="kicker">最近两周打卡</span>
          <span class="mono dim">连续 {{ dailyStreak }} 天</span>
        </div>
        <div class="cal-dots">
          <span
            v-for="d in calendarDays"
            :key="d.key"
            class="cal-dot"
            :data-on="d.on"
            :data-today="d.isToday"
            :title="d.key"
          ></span>
        </div>
      </div>

      <div class="g-result">
        <div class="res-main">
          <strong>明天同一时间，再来 10 题</strong>
        </div>
        <p class="res-tip">打卡不断签，间隔复习会把你过几天的国家再送回眼前。</p>
        <div class="res-actions">
          <button class="btn" @click="saveDailyCard">保存成绩卡</button>
          <button class="btn btn-dark" @click="switchMode('free')">再来自由练习</button>
        </div>
      </div>
    </section>
  </div>

  <!-- ============ 进行中的对局 ============ -->
  <div v-else-if="round" class="game">
    <section class="g-left">
      <div class="g-stage">
        <ClientOnly>
          <!-- 定位题：世界地图上直接点击 -->
          <WorldMap
            v-if="round.type === 'locate'"
            :country-id="locateHighlightId"
            :color="locateColor"
            :scan-key="animKey"
            :no-hover="!answered"
            @pick="locatePick"
          />
          <!-- 国旗题：大国旗展示 -->
          <div v-else-if="round.type === 'flag'" :key="animKey" class="flag-stage">
            <FlagBadge :code="round.target.code" :emoji="round.target.flag" :width="220" />
            <span class="flag-note mono">{{ answered ? round.target.name : '这是哪国的旗？' }}</span>
          </div>
          <!-- 认轮廓：默认题型 -->
          <DrawMap
            v-else
            :country-id="round.target.id"
            :anim-key="animKey"
            tone="ink"
            :show-pins="false"
            :show-labels="false"
            :fallback="round.target.cities[0] ? { lat: round.target.cities[0].lat, lng: round.target.cities[0].lng } : null"
          />
          <template #fallback>
            <div class="g-skeleton">题目装载中…</div>
          </template>
        </ClientOnly>

        <!-- 与抽卡/全球视图同一套语言：地图即台面，信息 HUD 悬浮，不再套卡片 -->
        <div class="hud hud-top">
          <div class="chip-row">
            <span class="hud-chip">{{ modeDaily ? '每日挑战' : '自由练习' }}</span>
            <span v-if="modeDaily" class="hud-chip soft mono">{{ dailyProgress }}</span>
            <span v-else class="hud-chip soft mono">第 {{ roundNo }} 题</span>
            <span class="hud-chip">{{ GAME_META[round.type].label }}</span>
          </div>
          <span class="hud-chip stat-chip">
            <b class="mono">{{ stats.score }}</b> 分 ·
            <b class="mono">{{ stats.streak }}</b> 连击 ·
            <b class="mono">{{ accuracy }}%</b> 正确率
            <template v-if="modeDaily"> · 连续打卡 <b class="mono">{{ dailyStreak }}</b> 天</template>
          </span>
        </div>

        <div class="hud hud-bottom">
          <span class="hud-chip soft">{{ GAME_META[round.type].hint }}</span>
          <span class="hud-chip soft mono keys-chip">
            <template v-if="hasOptions">1–4 选择 · </template>
            <template v-if="canNextHint">H 提示 · </template>Enter 下一题
          </span>
        </div>
      </div>
    </section>

    <section class="g-right">
      <div class="g-panel">
        <div class="mode-row">
          <div class="mode-switch" role="tablist" aria-label="对局模式">
            <button :data-active="modeDaily" @click="switchMode('daily')">每日挑战</button>
            <button :data-active="!modeDaily" @click="switchMode('free')">自由练习</button>
          </div>
          <span v-if="modeDaily" class="mono dim mode-hint">一天 {{ DAILY_SIZE }} 题，完成即打卡</span>
        </div>

        <div class="g-q">
          <span class="kicker">{{ GAME_META[round.type].label }}</span>
          <h2 class="display">{{ questionText }}</h2>
        </div>

        <div v-if="hasOptions" class="g-options">
          <button
            v-for="(opt, i) in round.options"
            :key="opt"
            class="g-opt"
            :data-state="optionState(opt)"
            :disabled="answered"
            @click="pick(opt)"
          >
            <span class="opt-letter">{{ letters[i] }}</span>
            <span class="opt-text">{{ opt }}</span>
          </button>
        </div>
        <p v-else-if="round.type === 'locate' && !answered" class="locate-tip">
          在左侧世界地图上点击它的位置；悬停不显示国名，点错直接判负。
        </p>

        <div v-if="round.hints.length" class="g-hints">
          <div class="hints-head">
            <span class="kicker">提示 · {{ round.revealed }} / {{ round.hints.length }}</span>
            <button v-if="canNextHint" class="hint-btn" @click="revealHint">
              查看提示 <span class="mono">-1 分</span>
            </button>
            <span v-else-if="!answered" class="mono dim">提示已用完</span>
          </div>
          <ul class="hint-list">
            <li v-for="(h, i) in round.hints" :key="i" :data-open="i < round.revealed">
              <span class="hint-idx mono">{{ i + 1 }}</span>
              <span v-if="i < round.revealed">{{ h }}</span>
              <span v-else class="hint-lock">未解锁{{ i === 0 && !round.revealed ? '（点右上角解锁）' : '' }}</span>
            </li>
          </ul>
        </div>

        <div class="g-result" :data-ok="round.ok">
          <template v-if="final">
            <div class="res-main">
              <template v-if="round.type !== 'capital'">
                <strong>答错了</strong>
                <span class="res-answer">正确答案：{{ round.answer }}
                  <button v-if="canSpeak" class="speak-btn" title="朗读英文名" aria-label="朗读英文国名" @click="speakAnswer">
                    <UiIcon name="sound" class="spk-ico" />
                  </button>
                </span>
              </template>
              <template v-else-if="round.skipped">
                <strong>已跳过首都题</strong>
                <span class="mono">+{{ round.gained }} 分</span>
              </template>
              <template v-else>
                <strong>{{ round.ok ? '答对了' : '首都答错了' }}</strong>
                <span v-if="!round.ok" class="res-answer">正确答案：{{ round.answer }}
                  <button v-if="canSpeak" class="speak-btn" title="朗读英文名" aria-label="朗读英文国名" @click="speakAnswer">
                    <UiIcon name="sound" class="spk-ico" />
                  </button>
                </span>
                <span class="mono">+{{ round.gained }} 分</span>
              </template>
            </div>
            <p class="res-tip">{{ round.target.flag }} {{ round.target.tagline }}</p>
            <div class="res-actions">
              <button class="btn" @click="emit('open', round.target.id)">看详情</button>
              <button v-if="modeDaily && daily?.finished" class="btn btn-dark" @click="finishDaily">
                今日成绩 →
              </button>
              <button v-else class="btn btn-dark" @click="next">下一题 →</button>
            </div>
          </template>
          <!-- 答对国家的确认停顿：绿态和加分停留片刻，随后自动进入首都题 -->
          <template v-else-if="round.awaitCapital">
            <div class="res-main correct-pop">
              <strong>答对了</strong>
              <span class="mono">+{{ round.gained }} 分</span>
              <span class="res-answer">追问首都，答对再 +1 分…</span>
            </div>
          </template>
          <template v-else-if="round.type === 'capital'">
            <div class="res-idle">
              <span class="mono">国家答对 +{{ round.gained }} 分，首都答对再 +1 分</span>
              <button class="skip" @click="skip">跳过首都题</button>
            </div>
          </template>
          <template v-else>
            <div class="res-idle">
              <span class="mono">{{ round.type === 'locate' ? '在左侧地图上点击作答' : '本题满分 2 分，每用一条提示减 1 分' }}</span>
              <button v-if="!modeDaily" class="skip" @click="next">跳过这题</button>
            </div>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.game {
  display: grid;
  grid-template-columns: minmax(0, 1.32fr) minmax(360px, 0.88fr);
  gap: 24px;
}

/* ---------- 每日总结：单栏窄卡居中 ---------- */
.game.summary {
  grid-template-columns: 1fr;
  justify-items: center;
}

.sum-panel {
  width: min(520px, 100%);
}

.sum-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.sum-item {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: #fffdf8;
  padding: 12px 10px;
  text-align: center;
}

.sum-num {
  font-size: 20px;
  color: var(--ink);
}

.sum-label {
  margin-top: 4px;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--muted);
}

.cal {
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  padding: 11px 13px;
}

.cal-dots {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cal-dot {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--paper-2);
  border: 1px solid var(--line);
}

.cal-dot[data-on='true'] {
  background: var(--ink);
  border-color: var(--ink);
}

.cal-dot[data-today='true'] {
  box-shadow: 0 0 0 2px rgba(25, 23, 18, 0.18);
}

/* ---------- 模式切换 ---------- */
.mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.mode-switch {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper-2);
}

.mode-switch button {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.mode-switch button[data-active='true'] {
  background: var(--ink);
  color: #fdf9ee;
}

.mode-hint {
  font-size: 11px;
}

/* ---------- 地图台面：与抽卡/全球视图同一套语言，不套卡片 ---------- */
.g-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.g-stage {
  position: relative;
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
  flex: 1;
}

@media (min-width: 1121px) {
  .g-stage :deep(.dmap) {
    height: 100%;
    aspect-ratio: auto;
  }

  /* 定位题的世界地图同样放开高度，海面填满台面 */
  .g-stage :deep(.world) {
    height: 100%;
    aspect-ratio: auto;
  }
}

/* ---------- 国旗题舞台 ---------- */
.flag-stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 16px;
  background:
    radial-gradient(circle at 50% 38%, rgba(255, 253, 248, 0.9), transparent 62%),
    #e9e2d0;
}

.flag-note {
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--ink-2);
}

.locate-tip {
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
  padding-left: 12px;
  border-left: 2px solid var(--line-strong);
}

.hud {
  position: absolute;
  left: 18px;
  right: 18px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  pointer-events: none;
}

.hud > * {
  pointer-events: auto;
}

.hud-top {
  top: 16px;
  align-items: flex-start;
}

.hud-bottom {
  bottom: 16px;
}

.hud-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
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

.chip-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.stat-chip {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: none;
  color: var(--muted);
}

.stat-chip b {
  color: var(--ink);
  font-size: 11.5px;
}

.g-skeleton {
  aspect-ratio: 1000 / 620;
  display: grid;
  place-items: center;
  font-size: 11px;
  color: #6d7f85;
  letter-spacing: 0.1em;
  background: #e6eff1;
}

.g-panel {
  background: var(--card);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-soft);
  padding: 20px 20px 18px;
  display: grid;
  gap: 14px;
  /* 定高面板下 grid 默认 stretch 会把富余空间均摊给每行——
     首都题少了提示块，行数变少、每行变高，选项就往下漂。
     改为行贴顶排列，富余空间由 .g-result 的 margin-top:auto 吸收 */
  align-content: start;
}

/* 大屏：面板定高（与 CountryDetail 的 .card-slot 同一函数），
   提示逐条展开时行高不再变化，左侧地图不随答题进度"呼吸" */
@media (min-width: 1121px) {
  .g-panel {
    height: clamp(560px, 68vh, 680px);
    overflow-y: auto;
  }
}

.g-q h2 {
  margin-top: 6px;
  font-size: clamp(20px, 2.2vw, 26px);
  line-height: 1.25;
}

.g-options {
  display: grid;
  gap: 8px;
}

.g-opt {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: #fffdf8;
  text-align: left;
  font-size: 14px;
  color: var(--ink);
  transition:
    transform 0.14s ease,
    border-color 0.16s ease,
    background 0.16s ease;
}

.g-opt:hover:not(:disabled) {
  border-color: var(--line-strong);
  transform: translateY(-1px);
}

.g-opt:disabled {
  cursor: default;
}

.opt-letter {
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  font-family: var(--mono);
  font-size: 11px;
  background: var(--paper-2);
  color: var(--muted);
  flex: none;
}

.opt-text {
  line-height: 1.35;
}

.g-opt[data-state='right'] {
  border-color: #15803d;
  background: #f0fdf4;
}

.g-opt[data-state='right'] .opt-letter {
  background: #15803d;
  color: #fff;
}

.g-opt[data-state='wrong'] {
  border-color: #b91c1c;
  background: #fef2f2;
}

.g-opt[data-state='wrong'] .opt-letter {
  background: #b91c1c;
  color: #fff;
}

.g-hints {
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  padding: 11px 13px;
}

.hints-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.hint-btn {
  font-size: 11px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: #fffdf8;
  color: var(--ink-2);
  transition: all 0.16s ease;
}

.hint-btn:hover {
  border-color: #b8ac8f;
  background: #fff;
}

.hint-btn span {
  color: #a16207;
  margin-left: 2px;
}

.hint-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.hint-list li {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}

.hint-list li[data-open='true'] {
  color: var(--ink-2);
}

.hint-idx {
  width: 16px;
  height: 16px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  font-size: 10px;
  background: var(--paper-2);
  color: var(--muted);
  flex: none;
  margin-top: 1px;
}

.hint-lock {
  opacity: 0.6;
  letter-spacing: 0.02em;
}

.g-result {
  border-top: 1px dashed var(--line);
  padding-top: 12px;
  min-height: 72px;
  /* 吸收面板富余高度，把自己钉在底部——选项位置因此与阶段无关 */
  margin-top: auto;
}

.res-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13.5px;
  flex-wrap: wrap;
}

.res-main strong {
  font-size: 15px;
}

.g-result[data-ok='true'] .res-main strong {
  color: #15803d;
}

.g-result[data-ok='false'] .res-main strong {
  color: #b91c1c;
}

.res-main .mono {
  color: #15803d;
  font-size: 12px;
}

/* 答对国家的确认反馈：轻弹一下，提示文字用墨色而不是绿色 */
.correct-pop {
  animation: correct-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.correct-pop .res-answer {
  color: var(--muted);
}

@keyframes correct-pop {
  0% {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .correct-pop {
    animation: none;
  }
}

.res-answer {
  color: var(--ink-2);
}

.speak-btn {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: 4px;
  vertical-align: -6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #fffdf8;
  color: var(--ink-2);
  cursor: pointer;
}

.speak-btn:hover {
  background: var(--ink);
  color: #fdf9ee;
}

.spk-ico {
  width: 12px;
  height: 12px;
}

.res-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--muted);
}

.res-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.res-idle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.skip {
  font-size: 11.5px;
  color: var(--muted);
  border-bottom: 1px dashed var(--line-strong);
  padding-bottom: 1px;
}

.skip:hover {
  color: var(--ink);
}

.dim {
  opacity: 0.7;
}

@media (max-width: 1120px) {
  .game {
    grid-template-columns: 1fr;
  }

  .flag-stage {
    position: relative;
    inset: auto;
    min-height: 320px;
  }
}

@media (max-width: 720px) {
  .hud {
    left: 12px;
    right: 12px;
  }
  .keys-chip {
    display: none;
  }
  .res-actions {
    justify-content: stretch;
  }
  .res-actions .btn {
    flex: 1;
  }
}
</style>
