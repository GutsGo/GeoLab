<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ACHIEVEMENT_GROUP_META,
  useAchievements,
} from '~/composables/useAchievements'
import type { AchievementGroup, AchievementView } from '~/composables/useAchievements'
import { useDeck } from '~/composables/useDeck'
import { useGame } from '~/composables/useGame'
import { CONTINENT_META } from '~/data'
import { downloadDataUrl, renderShareCard } from '~/lib/shareCard'
import { todayKey } from '~/lib/date'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const achv = useAchievements()
const deck = useDeck()
const game = useGame()

const drawerEl = ref<HTMLElement | null>(null)

/** 模板里嵌套 ref 不自动解包，提前取值 */
const achvList = computed(() => achv.list.value)
const unlockedCount = computed(() => achv.unlockedCount.value)

const groups = computed(() => {
  const byGroup = new Map<AchievementGroup, AchievementView[]>()
  for (const a of achv.list.value) {
    const arr = byGroup.get(a.group) ?? []
    arr.push(a)
    byGroup.set(a.group, arr)
  }
  return (Object.keys(ACHIEVEMENT_GROUP_META) as AchievementGroup[]).map((key) => ({
    key,
    label: ACHIEVEMENT_GROUP_META[key]!.label,
    items: byGroup.get(key) ?? [],
  }))
})

const totalPct = computed(() =>
  achv.list.value.length
    ? Math.round((achv.unlockedCount.value / achv.list.value.length) * 100)
    : 0,
)

function fmtUnlocked(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日解锁`
}

/** Tab 圈闭：焦点只在抽屉内轮转（与国家索引抽屉同一套约定） */
function trapFocus(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const inst = drawerEl.value as { $el?: HTMLElement } | HTMLElement | null
  const root = inst && '$el' in inst ? (inst.$el as HTMLElement) : (inst as HTMLElement | null)
  if (!root) return
  const els = Array.from(
    root.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.hasAttribute('disabled'))
  if (!els.length) return
  const first = els[0]!
  const last = els[els.length - 1]!
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

/** 保存总进度成绩卡（纯本地 canvas 绘制） */
function saveCard() {
  const data = {
    title: '我的地理学习成就',
    subtitle: '抽取式学习 · 挑战答题 · 间隔复习',
    date: todayKey(),
    stats: [
      { label: '解锁国家', value: String(deck.seenCount.value) },
      { label: '累计得分', value: String(game.stats.value.score) },
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
  downloadDataUrl(renderShareCard(data), `geolab-成就-${todayKey()}.png`)
}
</script>

<template>
  <AnimatePresence>
    <Motion
      v-if="open"
      key="achv-mask"
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
      key="achv-drawer"
      ref="drawerEl"
      as="aside"
      class="drawer"
      role="dialog"
      aria-modal="true"
      aria-label="成就收藏室"
      :initial="{ x: '104%' }"
      :animate="{ x: 0 }"
      :exit="{ x: '104%' }"
      :transition="{ type: 'spring', stiffness: 320, damping: 34 }"
      @keydown.capture="trapFocus"
    >
      <header class="d-head">
        <div class="d-head-row">
          <div>
            <div class="kicker">成就收藏室</div>
            <h3 class="display" style="font-size: 20px; margin-top: 2px">
              徽章 <span class="mono">{{ unlockedCount }}</span> / {{ achvList.length }}
            </h3>
          </div>
          <button class="close" aria-label="关闭" @click="emit('close')">✕</button>
        </div>

        <div class="sum-row">
          <div class="sum-track">
            <div class="sum-fill" :style="{ width: totalPct + '%' }"></div>
          </div>
          <span class="mono sum-pct">{{ totalPct }}%</span>
          <button class="save-btn" @click="saveCard">保存成绩卡</button>
        </div>
      </header>

      <div class="d-body scroll-thin">
        <section v-for="g in groups" :key="g.key" class="group">
          <div class="g-head">
            <span class="g-name">{{ g.label }}</span>
            <span class="mono g-count">
              {{ g.items.filter((a) => a.unlockedAt).length }}/{{ g.items.length }}
            </span>
          </div>
          <div class="badge-grid">
            <div
              v-for="a in g.items"
              :key="a.id"
              class="badge"
              :class="{ on: !!a.unlockedAt }"
              :style="{ '--c': a.hue }"
            >
              <div class="badge-mark">{{ a.mark }}</div>
              <div class="badge-main">
                <div class="badge-title">
                  <span>{{ a.title }}</span>
                  <span v-if="a.unlockedAt" class="badge-date mono">{{ fmtUnlocked(a.unlockedAt) }}</span>
                </div>
                <div class="badge-desc">{{ a.desc }}</div>
                <div class="badge-track">
                  <div class="badge-fill" :style="{ width: Math.round(a.pct * 100) + '%' }"></div>
                </div>
              </div>
              <span class="badge-pct mono">{{ Math.round(a.pct * 100) }}%</span>
            </div>
          </div>
        </section>

        <div class="d-foot">
          <span class="mono">徽章进度随学习实时结算</span>
          <span class="dim">答对升级 · 打卡续期 · 复习加深记忆</span>
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
  width: min(460px, 94vw);
  background: var(--card);
  border-left: 1px solid var(--line);
  box-shadow: -30px 0 60px -40px rgba(30, 24, 12, 0.5);
  display: flex;
  flex-direction: column;
}

.d-head {
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--line);
}

.d-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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

.sum-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.sum-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--paper-2);
  overflow: hidden;
}

.sum-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ink);
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.sum-pct {
  font-size: 11px;
  color: var(--muted);
}

.save-btn {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: #fffdf8;
  font-size: 11.5px;
  color: var(--ink-2);
  transition: all 0.16s ease;
}

.save-btn:hover {
  background: var(--ink);
  border-color: var(--ink);
  color: #fdf9ee;
}

.d-body {
  overflow-y: auto;
  padding: 14px 14px 40px;
  flex: 1;
}

.group + .group {
  margin-top: 18px;
}

.g-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 4px 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ink-2);
}

.g-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
}

.badge-grid {
  display: grid;
  gap: 6px;
}

.badge {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: #fffdf8;
}

.badge.on {
  border-color: color-mix(in srgb, var(--c) 40%, var(--line));
  background: color-mix(in srgb, var(--c) 5%, #fffdf8);
}

.badge-mark {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-family: var(--serif);
  font-size: 15px;
  flex: none;
  background: var(--paper-2);
  color: #b3a98f;
  border: 1px solid var(--line);
}

.badge.on .badge-mark {
  background: var(--c);
  color: #fffdf8;
  border-color: var(--c);
}

.badge-main {
  flex: 1;
  min-width: 0;
}

.badge-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--muted);
}

.badge.on .badge-title span:first-child {
  color: var(--ink);
  font-weight: 600;
}

.badge-date {
  font-size: 9.5px;
  color: var(--muted);
  white-space: nowrap;
}

.badge-desc {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
}

.badge-track {
  margin-top: 6px;
  height: 4px;
  border-radius: 999px;
  background: var(--paper-2);
  overflow: hidden;
}

.badge-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--c);
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.badge-pct {
  width: 34px;
  text-align: right;
  font-size: 10px;
  color: var(--muted);
  flex: none;
}

.d-foot {
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--muted);
  flex-wrap: wrap;
}

.dim {
  opacity: 0.75;
}
</style>
