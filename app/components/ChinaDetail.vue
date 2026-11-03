<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CN_KIND_META, CN_REGION_META, CN_PROVINCES } from '~/data/china'
import type { ChinaProvince } from '~/data/china'

const props = defineProps<{ province: ChinaProvince | null }>()

type TabKey = 'overview' | 'history' | 'culture' | 'landmarks' | 'foods'

// 父级用 :key 重建组件，因此这里要按当前 props 决定初始 tab
const tab = ref<TabKey>('overview')
watch(
  () => props.province?.id,
  () => {
    tab.value = 'overview'
  },
)

const tabs = computed(() => {
  const p = props.province
  if (!p) return []
  return [
    { key: 'overview' as TabKey, label: '概览' },
    { key: 'history' as TabKey, label: '历史' },
    { key: 'culture' as TabKey, label: '人文' },
    { key: 'landmarks' as TabKey, label: `名胜 · ${p.landmarks.length}` },
    { key: 'foods' as TabKey, label: `美食 · ${p.foods.length}` },
  ]
})

const accent = computed(() =>
  props.province ? CN_REGION_META[props.province.region].hue : '#1d4ed8',
)

const sameRegion = computed(() => {
  const c = props.province
  if (!c) return []
  return CN_PROVINCES.filter((p) => p.region === c.region && p.id !== c.id).slice(0, 6)
})

const emit = defineEmits<{ (e: 'pick', id: string): void }>()
</script>

<template>
  <!-- 与 CountryDetail 同构：.card 皮肤 + card-head + 全局 tabs + body 滚动区 + foot -->
  <article v-if="province" class="card detail" :style="{ '--accent': accent }">
    <div class="card-head">
      <div class="head-row">
        <div class="head-main">
          <div class="kicker">{{ province.region }} · {{ province.kind }} · 简称「{{ province.short }}」</div>
          <h2 class="display">{{ province.name }}</h2>
          <p class="tagline">{{ province.funFact }}</p>
        </div>
        <div class="flag-box">
          <div class="short-badge">{{ province.short }}</div>
        </div>
      </div>

      <div class="mini-stats">
        <div>
          <div class="stat-label">行政中心</div>
          <div class="stat-value">{{ province.seat }}</div>
        </div>
        <div>
          <div class="stat-label">人口</div>
          <div class="stat-value">{{ province.population }}</div>
        </div>
        <div>
          <div class="stat-label">面积</div>
          <div class="stat-value">{{ province.area }}</div>
        </div>
      </div>
    </div>

    <div class="tabs" role="tablist" aria-label="省区资料分区">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        role="tab"
        :aria-selected="tab === t.key"
        :data-active="tab === t.key"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="body scroll-thin">
      <div v-if="tab === 'overview'" class="pane">
        <div class="note">
          <strong>速记锚点</strong>
          <div>「{{ province.short }}」是 {{ province.name }} 的简称——车牌、邮箱前缀、历史文献里见到它，想到的就是这里。</div>
        </div>
        <div class="divider" style="margin: 16px 0"></div>
        <div class="stat-grid">
          <div>
            <div class="stat-label">行政中心</div>
            <div class="stat-value">{{ province.seat }}</div>
          </div>
          <div>
            <div class="stat-label">行政类型</div>
            <div class="stat-value">{{ province.kind }}</div>
          </div>
        </div>

        <div v-if="sameRegion.length" class="nearby">
          <div class="section-title">同区省区</div>
          <div class="nearby-list">
            <button v-for="n in sameRegion" :key="n.id" class="nearby-item" @click="emit('pick', n.id)">
              <span class="mini-short" :style="{ background: CN_REGION_META[n.region].hue }">{{ n.short }}</span>
              <span>{{ n.name.replace(/(省|市|自治区|特别行政区|维吾尔|壮族|回族)/g, '') }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="tab === 'history'" class="pane">
        <div class="section-title">历史脉络</div>
        <p class="prose">{{ province.history }}</p>
        <div class="hint">记忆点：把这段历史压缩成「起点—转折—现状」三段式，更容易记住。</div>
      </div>

      <div v-else-if="tab === 'culture'" class="pane">
        <div class="section-title">人文与日常</div>
        <p class="prose">{{ province.culture }}</p>
      </div>

      <div v-else-if="tab === 'landmarks'" class="pane">
        <div v-for="(l, i) in province.landmarks" :key="l" class="list-item">
          <div class="list-title">
            <span class="num-badge">{{ String(i + 1).padStart(2, '0') }}</span>
            {{ l }}
          </div>
        </div>
      </div>

      <div v-else class="pane">
        <div v-for="(f, i) in province.foods" :key="f" class="list-item">
          <div class="list-title">
            <span class="num-badge">{{ String(i + 1).padStart(2, '0') }}</span>
            {{ f }}
          </div>
        </div>
      </div>
    </div>

    <div class="foot">
      <span class="mono foot-hint">{{ CN_KIND_META[province.kind].mark }} · {{ province.id }}</span>
    </div>
  </article>

  <div v-else class="empty">
    <div class="empty-inner">
      <div class="empty-mark">◍</div>
      <h2 class="display" style="font-size: 22px">还没有抽取</h2>
      <p class="tagline" style="max-width: 260px; margin-top: 8px">点下面的按钮，随机翻开一个省级行政区。</p>
    </div>
  </div>
</template>

<style scoped>
/* 与 CountryDetail 的 .detail 完全一致：卡片填满定高列，body 内部滚动 */
.detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.card-head {
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

/* 简称徽章占国旗盒的位置：同一白框、同一倾斜 */
.flag-box {
  flex: none;
  padding: 4px;
  border-radius: var(--r-sm);
  background: #fff;
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
  transform: rotate(-2deg);
}

.short-badge {
  width: 84px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: var(--r-xs);
  color: #fdf9ee;
  font-size: 32px;
  font-weight: 600;
  font-family: var(--serif, serif);
  background: linear-gradient(160deg, var(--accent), color-mix(in srgb, var(--accent) 62%, #191712));
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

.hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.7;
  padding-left: 12px;
  border-left: 2px solid var(--line-strong);
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
  padding: 4px 10px 4px 4px;
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

.mini-short {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: #fdf9ee;
  font-size: 10.5px;
  flex: none;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  background: #fdfaf3;
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
    radial-gradient(circle at 50% 30%, rgba(194, 65, 12, 0.06), transparent 60%),
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
