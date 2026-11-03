<script setup lang="ts">
import { computed, ref } from 'vue'
import { geoMercator, geoPath } from 'd3-geo'
import { CN_PROVINCES } from '~/data/china'
import type { ChinaProvince } from '~/data/china'
import { useChina } from '~/composables/useChina'
import { pickOne, shuffle } from '~/lib/random'
import ChinaMap from './ChinaMap.vue'

const ROUNDS = 10
/** 答错的题隔几题后重考 */
const RETRY_AFTER = 2

type QType = 'outline' | 'locate' | 'short' | 'seat'

const TYPE_META: Record<QType, { label: string; hint: string }> = {
  outline: { label: '认轮廓', hint: '看轮廓，认出这是哪个省级行政区' },
  locate: { label: '找位置', hint: '在地图上点出这个省级行政区' },
  short: { label: '认简称', hint: '这个简称属于哪个省级行政区？' },
  seat: { label: '识省会', hint: '这个行政中心属于哪个省级行政区？' },
}

interface Round {
  type: QType
  answer: ChinaProvince
  options: ChinaProvince[]
  /** 简称题/省会题的题面素材 */
  prompt: string
}

const china = useChina()
const quizStats = china.quizStats

type Stage = 'idle' | 'playing' | 'done'
const stage = ref<Stage>('idle')
const rounds = ref<Round[]>([])
const roundNo = ref(0)
const score = ref(0)
const streak = ref(0)
const best = ref(0)
/** 当前题的作答状态 */
const picked = ref<string | null>(null)
const isOk = ref(false)
/** 待重考的答错省份 id 队列 */
const retryQueue = ref<{ id: string; dueAt: number }[]>([])

const letters = ['A', 'B', 'C', 'D']

/* ---------- 轮廓题的独立小地图 ---------- */
const outline = ref<{ d: string; w: number; h: number } | null>(null)

async function loadOutline(id: string) {
  try {
    const res = await fetch('/data/china-provinces.json')
    const gj = await res.json()
    const f = (gj.features as { properties: { adcode: string }; geometry: unknown }[]).find(
      (x) => x.properties.adcode === id,
    )
    if (!f) return null
    const S = 210
    const projection = geoMercator().fitExtent(
      [
        [4, 4],
        [S - 4, S - 4],
      ],
      f as never,
    )
    const d = geoPath(projection)(f as never) ?? ''
    return d ? { d, w: S, h: S } : null
  } catch {
    return null
  }
}

/* ---------- 出题 ---------- */

function makeOptions(answer: ChinaProvince): ChinaProvince[] {
  // 干扰项优先同大区，不足再从全国补齐
  const sameRegion = CN_PROVINCES.filter((p) => p.region === answer.region && p.id !== answer.id)
  const pool = shuffle(sameRegion).slice(0, 3)
  if (pool.length < 3) {
    const rest = shuffle(CN_PROVINCES.filter((p) => p.id !== answer.id && !pool.includes(p)))
    pool.push(...rest.slice(0, 3 - pool.length))
  }
  return shuffle([answer, ...pool])
}

function makeRound(type: QType, province: ChinaProvince): Round {
  let prompt = province.name
  if (type === 'short') prompt = province.short
  if (type === 'seat') prompt = province.seat
  return { type, answer: province, options: makeOptions(province), prompt }
}

/** 轮内题型循环：轮廓 → 简称 → 定位 → 省会 */
function nextType(n: number): QType {
  const order: QType[] = ['outline', 'short', 'locate', 'seat']
  return order[n % order.length] ?? 'outline'
}

function drawTarget(): ChinaProvince {
  // 优先消化重考队列（到期）
  const now = roundNo.value
  const due = retryQueue.value.find((r) => r.dueAt <= now)
  if (due) {
    retryQueue.value = retryQueue.value.filter((r) => r !== due)
    return CN_PROVINCES.find((p) => p.id === due.id) ?? pickOne(CN_PROVINCES)!
  }
  return pickOne(CN_PROVINCES)!
}

async function pushRound() {
  const type = nextType(rounds.value.length)
  const target = drawTarget()
  rounds.value.push(makeRound(type, target))
  if (type === 'outline') outline.value = await loadOutline(target.id)
}

const round = computed(() => rounds.value[roundNo.value] ?? null)

/* ---------- 流程 ---------- */

function start() {
  stage.value = 'playing'
  rounds.value = []
  roundNo.value = 0
  score.value = 0
  streak.value = 0
  best.value = 0
  retryQueue.value = []
  picked.value = null
  isOk.value = false
  outline.value = null
  void pushRound()
}

function choose(id: string) {
  if (picked.value) return
  const r = round.value
  if (!r) return
  picked.value = id
  isOk.value = id === r.answer.id
  china.recordAnswer(isOk.value)
  if (isOk.value) {
    score.value += 2
    streak.value += 1
    best.value = Math.max(best.value, streak.value)
    china.focusProvince(r.answer.id)
  } else {
    streak.value = 0
    retryQueue.value.push({ id: r.answer.id, dueAt: roundNo.value + 1 + RETRY_AFTER })
  }
}

const answered = computed(() => picked.value !== null)

/** 重考题会让一轮变长；简单处理：总题数 = 10 + 已产生的重考数（有上限） */
function retryQueueConsumedExtra() {
  return Math.min(retryQueue.value.length, 4)
}

/** 是否最后一题（答完这道就结算） */
const isLast = computed(() => roundNo.value + 1 >= ROUNDS + retryQueueConsumedExtra())

/** Enter / 空格推进：最后一题结算，否则前进 */
function advance() {
  const r = round.value
  if (!r || !picked.value) return
  if (isLast.value) {
    stage.value = 'done'
    return
  }
  roundNo.value += 1
  picked.value = null
  isOk.value = false
  void pushRound()
}

function optionState(opt: ChinaProvince): 'right' | 'wrong' | 'idle' {
  if (!picked.value) return 'idle'
  if (opt.id === round.value?.answer.id) return 'right'
  if (opt.id === picked.value) return 'wrong'
  return 'idle'
}

/** 题干文案：与 GamePanel 的 questionText 同一角色 */
const questionText = computed(() => {
  const r = round.value
  if (!r) return ''
  if (r.type === 'outline') return '这个轮廓是哪个省级行政区？'
  if (r.type === 'short') return `简称「${r.prompt}」是哪里？`
  if (r.type === 'seat') return `行政中心「${r.prompt}」属于哪里？`
  return `在中国地图上点出「${r.prompt}」`
})

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return

  if (stage.value !== 'playing') {
    if (e.key === 'Enter') start()
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    advance()
    return
  }
  const n = Number.parseInt(e.key, 10)
  if (n >= 1 && n <= 4 && round.value && !picked.value) {
    const opt = round.value.options[n - 1]
    if (opt) choose(opt.id)
  }
}

defineExpose({ onKey })

const accuracy = computed(() =>
  quizStats.value.asked > 0
    ? Math.round((quizStats.value.correct / quizStats.value.asked) * 100)
    : 0,
)
</script>

<template>
  <!-- 开场 / 结算：单栏窄卡居中，与每日挑战总结同一套面板语言 -->
  <div v-if="stage !== 'playing'" class="cquiz single">
    <section class="g-panel sum-panel">
      <div class="g-q">
        <span class="kicker">中国省级行政区 · {{ ROUNDS }} 题一轮</span>
        <h2 class="display">{{ stage === 'idle' ? '省区挑战，现在开始' : `本轮 ${score} 分` }}</h2>
      </div>

      <p class="sum-desc">
        <template v-if="stage === 'idle'">
          认轮廓、认简称、找位置、识省会轮番上阵。答对得 2 分并解锁该省区资料，答错的题过几题会回来重考。
        </template>
        <template v-else>
          最高连对 {{ best }}。
          <template v-if="score >= 18">省区通的水平！</template>
          <template v-else-if="score >= 12">稳扎稳打，再来一轮巩固。</template>
          <template v-else>多看看资料卡，轮廓和简称很快就能认全。</template>
        </template>
      </p>

      <div class="res-actions">
        <button class="btn btn-dark" @click="start">
          {{ stage === 'idle' ? '开始挑战' : '再来一轮' }} <small class="mono">ENTER</small>
        </button>
      </div>

      <p v-if="quizStats.asked > 0" class="mono dim stats-line">
        累计作答 {{ quizStats.asked }} · 正确率 {{ accuracy }}%
      </p>
    </section>
  </div>

  <!-- 进行中的对局：与挑战视图同一套语言——左地图台面，右答题面板 -->
  <div v-else-if="round" class="cquiz">
    <section class="g-left">
      <div class="g-stage">
        <ClientOnly>
          <!-- 定位题：中国地图上直接点击 -->
          <ChinaMap
            v-if="round.type === 'locate'"
            no-hover
            :answer="picked ? { okId: isOk ? picked : round.answer.id, wrongId: isOk ? undefined : picked } : null"
            @pick="choose"
          />
          <!-- 简称题：大字舞台 -->
          <div v-else-if="round.type === 'short'" class="char-stage">
            <span class="char-big">{{ round.prompt }}</span>
            <span class="stage-note mono">{{ answered ? round.answer.name : '这是哪里的简称？' }}</span>
          </div>
          <!-- 省会题：城市名舞台 -->
          <div v-else-if="round.type === 'seat'" class="char-stage">
            <span class="char-big char-city">{{ round.prompt }}</span>
            <span class="stage-note mono">{{ answered ? round.answer.name : '这个行政中心属于哪里？' }}</span>
          </div>
          <!-- 轮廓题：省界轮廓大图 -->
          <div v-else class="outline-stage">
            <svg v-if="outline" :viewBox="`0 0 ${outline.w} ${outline.h}`" class="outline-svg">
              <path :d="outline.d" class="outline-path" />
            </svg>
            <div v-else class="stage-note">轮廓装载中…</div>
          </div>
          <template #fallback>
            <div class="stage-note">题目装载中…</div>
          </template>
        </ClientOnly>

        <!-- 与抽卡/全球/世界挑战同一套 HUD：地图即台面，信息悬浮 -->
        <div class="hud hud-top">
          <div class="chip-row">
            <span class="hud-chip">省区挑战</span>
            <span class="hud-chip soft mono">第 {{ roundNo + 1 }} 题</span>
            <span class="hud-chip">{{ TYPE_META[round.type].label }}</span>
          </div>
          <span class="hud-chip stat-chip">
            <b class="mono">{{ score }}</b> 分 · <b class="mono">{{ streak }}</b> 连对
          </span>
        </div>

        <div class="hud hud-bottom">
          <span class="hud-chip soft">{{ TYPE_META[round.type].hint }}</span>
          <span v-if="round.type !== 'locate'" class="hud-chip soft mono keys-chip">1–4 选择 · Enter 下一题</span>
        </div>
      </div>
    </section>

    <section class="g-right">
      <div class="g-panel">
        <div class="g-q">
          <span class="kicker">{{ TYPE_META[round.type].label }}</span>
          <h2 class="display">{{ questionText }}</h2>
        </div>

        <div v-if="round.type !== 'locate'" class="g-options">
          <button
            v-for="(opt, i) in round.options"
            :key="opt.id"
            class="g-opt"
            :data-state="optionState(opt)"
            :disabled="answered"
            @click="choose(opt.id)"
          >
            <span class="opt-letter">{{ letters[i] }}</span>
            <span class="opt-text">{{ opt.name }}</span>
          </button>
        </div>
        <p v-else-if="!answered" class="locate-tip">
          在左侧中国地图上点击它的位置；悬停不显示省名，点错直接判负。
        </p>

        <div class="g-result" :data-ok="isOk">
          <template v-if="answered">
            <div class="res-main">
              <strong>{{ isOk ? '答对了' : '答错了' }}</strong>
              <span class="res-answer">正确答案：{{ round.answer.name }}（{{ round.answer.short }}）</span>
              <span v-if="isOk" class="mono">+2 分</span>
            </div>
            <p class="res-tip">行政中心 {{ round.answer.seat }} · {{ round.answer.region }}</p>
            <div class="res-actions">
              <button class="btn btn-dark" @click="advance">{{ isLast ? '完成本轮 →' : '下一题 →' }}</button>
            </div>
          </template>
          <template v-else>
            <div class="res-idle">
              <span class="mono">{{ round.type === 'locate' ? '在左侧地图上点击作答' : '本题满分 2 分' }}</span>
            </div>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 布局与 GamePanel 的 .game 完全一致 */
.cquiz {
  display: grid;
  grid-template-columns: minmax(0, 1.32fr) minmax(360px, 0.88fr);
  gap: 24px;
}

/* 开场/结算：单栏窄卡居中（同每日挑战总结） */
.cquiz.single {
  grid-template-columns: 1fr;
  justify-items: center;
}

.sum-panel {
  width: min(520px, 100%);
}

.sum-desc {
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--muted);
}

.stats-line {
  font-size: 11px;
  color: var(--ink-2);
}

/* ---------- 地图台面：不套卡片 ---------- */
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
  /* 定位题的中国地图放开高度，海面填满台面 */
  .g-stage :deep(.cmap) {
    height: 100%;
    aspect-ratio: auto;
  }
}

/* ---------- 大字舞台（简称 / 省会）：同国旗题的 flag-stage ---------- */
.char-stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background:
    radial-gradient(circle at 50% 38%, rgba(255, 253, 248, 0.9), transparent 62%),
    #e9e2d0;
}

.char-big {
  font-family: var(--serif, serif);
  font-size: clamp(72px, 12vw, 132px);
  line-height: 1;
  color: var(--ink);
}

.char-city {
  font-size: clamp(30px, 5vw, 52px);
  letter-spacing: 0.08em;
}

.stage-note {
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--ink-2);
}

/* ---------- 轮廓题舞台：与 DrawMap 认轮廓题同一语言（海面 + 墨色轮廓） ---------- */
.outline-stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background:
    radial-gradient(120% 90% at 50% 8%, #f0f6f7 0%, #e6eff1 46%, #dae8ec 100%);
}

.outline-svg {
  /* 视口单位定宽：grid/flex 居中容器里百分比宽度会循环依赖，缩成几十像素 */
  width: min(280px, 42vw);
  max-height: 62%;
}

.outline-path {
  fill: #f3eddf;
  stroke: #38311f;
  stroke-width: 1.6;
  vector-effect: non-scaling-stroke;
}

/* ---------- HUD：与 GamePanel 同一套胶囊 ---------- */
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

/* ---------- 右栏答题面板：与 GamePanel 的 .g-panel 同一套 ---------- */
.g-panel {
  background: var(--card);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-soft);
  padding: 20px 20px 18px;
  display: grid;
  gap: 14px;
  align-content: start;
}

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

.locate-tip {
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
  padding-left: 12px;
  border-left: 2px solid var(--line-strong);
}

/* ---------- 结果反馈区：与 GamePanel 同构 ---------- */
.g-result {
  border-top: 1px dashed var(--line);
  padding-top: 12px;
  min-height: 72px;
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

.res-answer {
  color: var(--ink-2);
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
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.dim {
  opacity: 0.7;
}

@media (max-width: 1120px) {
  .cquiz {
    grid-template-columns: 1fr;
  }

  .char-stage,
  .outline-stage {
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
