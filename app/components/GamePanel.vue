<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { GAME_META, useGame } from '~/composables/useGame'

const emit = defineEmits<{ (e: 'open', id: string): void }>()

const game = useGame()
const { stats, round, roundNo } = game

const animKey = ref(0)

const accuracy = computed(() =>
  stats.value.rounds ? Math.round((stats.value.correct / stats.value.rounds) * 100) : 0,
)
const answered = computed(() => !!round.value && (!!round.value.picked || round.value.skipped))
/** 本轮结束：国家答错，或首都阶段已作答/跳过（国家答对会自动进入首都阶段，不算结束） */
const final = computed(() => answered.value && (round.value!.type === 'capital' || round.value!.ok === false))
const canNextHint = computed(
  () => !!round.value && !round.value.picked && round.value.revealed < round.value.hints.length,
)

/** 猜首都时把国名写进题干，否则就变成「先猜国家、再猜首都」两重题 */
const questionText = computed(() => {
  const r = round.value
  if (!r) return ''
  return r.type === 'capital' ? `${r.target.name} 的首都是？` : GAME_META[r.type].question
})

const letters = ['A', 'B', 'C', 'D']

function next() {
  game.startRound()
  if (round.value) animKey.value++
}

function pick(opt: string) {
  if (!round.value || round.value.picked) return
  game.answer(round.value, opt)
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
    if (answered.value) next()
    return
  }
}

onMounted(() => {
  game.hydrate()
  // 只有首次（或上一局已被清掉）才开新题；切 tab 回来要接着做原来的题
  if (!round.value) next()
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="round" class="game">
    <section class="g-left">
      <div class="g-stage">
        <ClientOnly>
          <DrawMap
            :country-id="round.target.id"
            :anim-key="animKey"
            tone="ink"
            :show-pins="false"
            :show-labels="false"
            :fallback="round.target.cities[0] ? { lat: round.target.cities[0].lat, lng: round.target.cities[0].lng } : null"
          />
          <template #fallback>
            <div class="g-skeleton">轮廓装载中…</div>
          </template>
        </ClientOnly>

        <!-- 与抽卡/全球视图同一套语言：地图即台面，信息 HUD 悬浮，不再套卡片 -->
        <div class="hud hud-top">
          <div class="chip-row">
            <span class="hud-chip">{{ GAME_META[round.type].label }}</span>
            <span class="hud-chip soft mono">第 {{ roundNo }} 题</span>
          </div>
          <span class="hud-chip stat-chip">
            <b class="mono">{{ stats.score }}</b> 分 ·
            <b class="mono">{{ stats.streak }}</b> 连击 ·
            <b class="mono">{{ accuracy }}%</b> 正确率
          </span>
        </div>

        <div class="hud hud-bottom">
          <span class="hud-chip soft">{{ GAME_META[round.type].hint }}</span>
          <span class="hud-chip soft mono keys-chip">
            1–4 选择<template v-if="round.type === 'country'"> · H 提示</template> · Enter 下一题
          </span>
        </div>
      </div>
    </section>

    <section class="g-right">
      <div class="g-panel">
        <div class="g-q">
          <span class="kicker">{{ GAME_META[round.type].label }}</span>
          <h2 class="display">{{ questionText }}</h2>
        </div>

        <div class="g-options">
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
              <template v-if="round.type === 'country'">
                <strong>答错了</strong>
                <span class="res-answer">正确答案：{{ round.answer }}</span>
              </template>
              <template v-else-if="round.skipped">
                <strong>已跳过首都题</strong>
                <span class="mono">+{{ round.gained }} 分</span>
              </template>
              <template v-else>
                <strong>{{ round.ok ? '答对了' : '首都答错了' }}</strong>
                <span v-if="!round.ok" class="res-answer">正确答案：{{ round.answer }}</span>
                <span class="mono">+{{ round.gained }} 分</span>
              </template>
            </div>
            <p class="res-tip">{{ round.target.flag }} {{ round.target.tagline }}</p>
            <div class="res-actions">
              <button class="btn" @click="emit('open', round.target.id)">看详情</button>
              <button class="btn btn-dark" @click="next">下一题 →</button>
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
              <span class="mono">本题满分 2 分，每用一条提示减 1 分</span>
              <button class="skip" @click="next">跳过这题</button>
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
  gap: 20px;
  align-items: start;
}

/* ---------- 地图台面：与抽卡/全球视图同一套语言，不套卡片 ---------- */
.g-stage {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
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
  gap: 6px;
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

.chip-row {
  display: flex;
  gap: 6px;
}

.stat-chip {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: none;
  color: var(--muted);
}

.stat-chip b {
  color: var(--ink);
  font-size: 13px;
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
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow-md);
  padding: 20px 20px 18px;
  display: grid;
  gap: 14px;
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
  border-radius: 13px;
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
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-family: var(--mono);
  font-size: 10.5px;
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
  border-radius: 14px;
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
  border-radius: 5px;
  display: grid;
  place-items: center;
  font-size: 9px;
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
  justify-content: space-between;
  gap: 12px;
  font-size: 10.5px;
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
