<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Country } from '~/data/types'
import { CONTINENT_META, byContinent } from '~/data'

const props = defineProps<{ country: Country | null; highlightCity?: string }>()
const emit = defineEmits<{
  (e: 'pick', id: string): void
  (e: 'shuffle-city', countryId: string, city?: string): void
}>()

type TabKey = 'overview' | 'history' | 'culture' | 'landmarks' | 'foods' | 'map'

// 父级用 :key 重建组件，因此这里要按当前 props 决定初始 tab
const tab = ref<TabKey>(props.highlightCity ? 'map' : 'overview')

watch(
  () => [props.country?.id, props.highlightCity] as [string | undefined, string | undefined],
  ([id, city], prev) => {
    if (city) {
      tab.value = 'map'
      return
    }
    if (id !== prev?.[0]) tab.value = 'overview'
  },
)

const tabs = computed(() => {
  const c = props.country
  if (!c) return []
  return [
    { key: 'overview' as TabKey, label: '概览' },
    { key: 'history' as TabKey, label: '历史' },
    { key: 'culture' as TabKey, label: '人文' },
    { key: 'landmarks' as TabKey, label: `名胜 · ${c.landmarks.length}` },
    { key: 'foods' as TabKey, label: `美食 · ${c.foods.length}` },
    { key: 'map' as TabKey, label: '城市' },
  ]
})

const accent = computed(() => {
  const c = props.country
  if (!c) return '#1d4ed8'
  return CONTINENT_META[c.continent].hue
})

const sortedEthnic = computed(() => {
  if (!props.country) return []
  return [...props.country.ethnic].sort((a, b) => b.pct - a.pct)
})

const maxPct = computed(() => Math.max(1, ...sortedEthnic.value.map((e) => e.pct)))

const nearby = computed(() => {
  const c = props.country
  if (!c) return []
  return byContinent[c.continent].filter((x) => x.id !== c.id).slice(0, 7)
})

/** tablist 方向键导航：←/→ 移动并激活，Home/End 跳两端 */
function onTabKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
  const list = tabs.value
  if (!list.length) return
  e.preventDefault()
  const idx = list.findIndex((t) => t.key === tab.value)
  let next = idx
  if (e.key === 'ArrowRight') next = (idx + 1) % list.length
  else if (e.key === 'ArrowLeft') next = (idx - 1 + list.length) % list.length
  else if (e.key === 'Home') next = 0
  else next = list.length - 1
  const target = list[next]
  if (!target) return
  tab.value = target.key
  // 焦点跟着激活项走，符合 WAI-ARIA tabs 的 roving tabindex 惯例
  const btn = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.tab')[next]
  btn?.focus()
}
</script>

<template>
  <div class="card detail" :style="{ '--accent': accent }">
    <template v-if="country">
      <div class="card-head">
        <div class="head-row">
          <div class="head-main">
            <div class="kicker">
              {{ country.continent }} · {{ country.subregion }} · {{ country.nameEn }}
            </div>
            <h2 class="display">{{ country.name }}</h2>
            <p class="tagline">{{ country.tagline }}</p>
          </div>
          <div class="flag-box">
            <FlagBadge :code="country.code" :emoji="country.flag" :name="country.name" :width="84" />
          </div>
        </div>

        <div class="mini-stats">
          <div>
            <div class="stat-label">首都</div>
            <div class="stat-value">{{ country.capital }}</div>
          </div>
          <div>
            <div class="stat-label">人口</div>
            <div class="stat-value">{{ country.population }}</div>
          </div>
          <div>
            <div class="stat-label">面积</div>
            <div class="stat-value">{{ country.area }}</div>
          </div>
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="国家资料分区" @keydown="onTabKeydown">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          role="tab"
          :id="`tab-${t.key}`"
          :aria-selected="tab === t.key"
          :aria-controls="`pane-${t.key}`"
          :tabindex="tab === t.key ? 0 : -1"
          :data-active="tab === t.key"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="body scroll-thin">
        <div
          v-if="tab === 'overview'"
          :key="`ov-${country.id}`"
          id="pane-overview"
          role="tabpanel"
          aria-labelledby="tab-overview"
          class="pane"
        >
          <p class="prose">{{ country.intro }}</p>

          <div class="divider" style="margin: 16px 0"></div>

          <div class="stat-grid">
            <div>
              <div class="stat-label">语言</div>
              <div class="stat-value">{{ country.language }}</div>
            </div>
            <div>
              <div class="stat-label">货币</div>
              <div class="stat-value">{{ country.currency }}</div>
            </div>
          </div>

          <div style="margin-top: 18px">
            <div class="section-title">族群构成</div>
            <div class="bar-list">
              <div v-for="e in sortedEthnic" :key="e.name" class="bar-row">
                <span class="bar-name" :title="e.name">{{ e.name }}</span>
                <span class="bar-track">
                  <span
                    class="bar-fill"
                    :style="{
                      width: (e.pct / maxPct) * 100 + '%',
                      background: `linear-gradient(90deg, ${accent}, ${accent}99)`,
                    }"
                  ></span>
                </span>
                <span class="mono bar-pct">{{ e.pct }}%</span>
              </div>
            </div>
          </div>

          <div class="note" style="margin-top: 18px">
            <strong style="letter-spacing: 0.1em; font-size: 10px; text-transform: uppercase">冷知识</strong>
            <div style="margin-top: 4px">{{ country.funFact }}</div>
          </div>

          <div class="nearby">
            <div class="section-title">同大洲国家</div>
            <div class="nearby-list">
              <button v-for="n in nearby" :key="n.id" class="nearby-item" @click="emit('pick', n.id)">
                <FlagBadge :code="n.code" :emoji="n.flag" :name="n.name" :width="17" flat />
                <span>{{ n.name }}</span>
              </button>
            </div>
          </div>
        </div>

        <div
          v-else-if="tab === 'history'"
          id="pane-history"
          role="tabpanel"
          aria-labelledby="tab-history"
          class="pane"
        >
          <div class="section-title">历史时间线</div>
          <p class="prose">{{ country.history }}</p>
          <div class="hint">记忆点：把这段历史压缩成一个"起点—转折—现状"的三段式，往往更容易记住。</div>
        </div>

        <div
          v-else-if="tab === 'culture'"
          id="pane-culture"
          role="tabpanel"
          aria-labelledby="tab-culture"
          class="pane"
        >
          <div class="section-title">人文与日常</div>
          <p class="prose">{{ country.culture }}</p>
          <div class="divider" style="margin: 16px 0"></div>
          <div class="stat-grid">
            <div>
              <div class="stat-label">语言</div>
              <div class="stat-value">{{ country.language }}</div>
            </div>
            <div>
              <div class="stat-label">货币</div>
              <div class="stat-value">{{ country.currency }}</div>
            </div>
          </div>
        </div>

        <div
          v-else-if="tab === 'landmarks'"
          id="pane-landmarks"
          role="tabpanel"
          aria-labelledby="tab-landmarks"
          class="pane"
        >
          <div v-for="(l, i) in country.landmarks" :key="l.name" class="list-item">
            <div class="list-title">
              <span class="num-badge">{{ String(i + 1).padStart(2, '0') }}</span>
              {{ l.name }}
            </div>
            <div class="list-desc">{{ l.desc }}</div>
          </div>
        </div>

        <div
          v-else-if="tab === 'foods'"
          id="pane-foods"
          role="tabpanel"
          aria-labelledby="tab-foods"
          class="pane"
        >
          <div v-for="(f, i) in country.foods" :key="f.name" class="list-item">
            <div class="list-title">
              <span class="num-badge">{{ String(i + 1).padStart(2, '0') }}</span>
              {{ f.name }}
            </div>
            <div class="list-desc">{{ f.desc }}</div>
          </div>
        </div>

        <div v-else id="pane-map" role="tabpanel" aria-labelledby="tab-map" class="pane">
          <div class="city-bar">
            <div class="cb-left">
              <div class="stat-label">{{ highlightCity ? '本次抽到' : '城市速览' }}</div>
              <div class="city-hit">
                {{ highlightCity || `${country.name}的 ${country.cities.length} 个坐标` }}
              </div>
            </div>
            <button class="city-shuffle" @click="emit('shuffle-city', country.id)">
              {{ highlightCity ? '换一个' : '抽一个' }}
            </button>
          </div>

          <ClientOnly>
            <FocusMap
              :country-id="country.id"
              :pins="country.cities"
              :color="accent"
              :height="200"
              :focus-pin="highlightCity"
              :marker="{ lat: country.cities[0]?.lat ?? 0, lng: country.cities[0]?.lng ?? 0 }"
              water
            />
          </ClientOnly>
          <div class="city-list">
            <button
              v-for="c in country.cities"
              :key="c.name"
              class="city"
              :class="{ cap: c.capital, on: c.name === highlightCity }"
              :title="`约 ${c.lat.toFixed(1)}, ${c.lng.toFixed(1)}`"
              @click="emit('shuffle-city', country.id, c.name)"
            >
              <span class="dot" :class="{ cap: c.capital }"></span>
              <span>{{ c.name }}</span>
              <span v-if="c.capital" class="cap-tag">首都</span>
              <span v-if="c.name === highlightCity" class="on-tag">抽到</span>
            </button>
          </div>
          <p class="city-note">点任意城市可以在地图上定位它；坐标仅作示意。</p>
        </div>
      </div>

      <div class="foot">
        <span class="mono foot-hint">{{ country.code.toUpperCase() }}</span>
      </div>
    </template>

    <div v-else class="empty">
      <div class="empty-inner">
        <div class="empty-mark">◍</div>
        <h2 class="display" style="font-size: 22px">还没有抽取</h2>
        <p class="tagline" style="max-width: 260px; margin-top: 8px">
          点下面的按钮，随机翻开一个国家。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  /* 行高由 .card-slot 的定高（视口函数）决定，卡片 flex:1 填满；
     内容长短差异由 body 内部滚动消化 —— 地图高度不受切卡影响。
     min-height:0 允许卡片收缩到列高内，避免长内容把行撑破 */
  flex: 1;
  min-height: 0;
}

@media (max-width: 1120px) {
  .detail {
    min-height: 0;
  }
}

.card-head {
  padding: 20px 22px 16px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 70%);
}

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.head-main {
  min-width: 0;
}

.flag-box {
  flex: none;
  padding: 4px;
  border-radius: var(--r-sm);
  background: #fff;
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
  transform: rotate(-2deg);
}

.flag {
  width: 84px;
  height: 56px;
  border-radius: var(--r-xs);
}

.flag-fallback {
  width: 84px;
  height: 56px;
  display: grid;
  place-items: center;
  font-size: 34px;
}

.mini-stats {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}

.body {
  padding: 16px 22px 8px;
  overflow-y: auto;
  flex: 1;
}

.pane {
  animation: fade 0.32s ease both;
}

@keyframes fade {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.section-title {
  font-size: 10.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}

.bar-list {
  display: grid;
  gap: 8px;
}

.bar-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
}

.bar-pct {
  text-align: right;
  font-size: 11px;
  color: var(--muted);
}

.nearby {
  margin-top: 18px;
}

.nearby-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.nearby-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #fffdf8;
  font-size: 11.5px;
  color: var(--ink-2);
  transition: all 0.16s ease;
}

.nearby-item:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.7;
  padding-left: 12px;
  border-left: 2px solid var(--line-strong);
}

.city-list {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}

.city.on {
  border-color: var(--accent, #191712);
  background: #fdf6e3;
}

.city {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: #fffdf8;
  font-size: 12.5px;
  text-align: left;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #b9ae94;
  flex: none;
}

.dot.cap {
  background: var(--ink);
  box-shadow: 0 0 0 3px rgba(25, 23, 18, 0.1);
}

.cap-tag {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--muted);
  border: 1px solid var(--line);
  padding: 1px 5px;
  border-radius: var(--r-xs);
}

.coord {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--muted);
}

.city-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: var(--r-sm);
  border: 1px dashed var(--line-strong);
  background: #fffdf8;
}

.city-hit {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  margin-top: 2px;
}

.city-shuffle {
  flex: none;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--card);
  font-size: 11.5px;
  color: var(--ink-2);
  transition: all 0.16s ease;
}

.city-shuffle:hover {
  background: var(--ink);
  border-color: var(--ink);
  color: #fdf9ee;
}

.on-tag {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 0.1em;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
}

.city-note {
  margin-top: 10px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  background: #fdfaf3;
}

.foot :deep(.btn) {
  font-size: 12px;
  padding: 8px 12px;
}

.foot-hint {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--muted);
}

.empty {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 60px 30px;
  background:
    radial-gradient(circle at 50% 30%, rgba(29, 78, 216, 0.06), transparent 60%),
    repeating-linear-gradient(45deg, transparent, transparent 9px, rgba(180, 168, 140, 0.1) 9px, rgba(180, 168, 140, 0.1) 10px);
}

.empty-inner {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-mark {
  font-size: 46px;
  color: var(--line-strong);
  margin-bottom: 14px;
}
</style>
