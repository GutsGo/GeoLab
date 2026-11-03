import { computed, effectScope, watch } from 'vue'
import { byContinent, CONTINENTS, countries } from '~/data'
import { CN_PROVINCES } from '~/data/china'
import { useDeck } from '~/composables/useDeck'
import { useGame } from '~/composables/useGame'
import { useSRS } from '~/composables/useSRS'
import { useChina } from '~/composables/useChina'

export type AchievementGroup = 'collect' | 'quiz' | 'habit' | 'review'

export const ACHIEVEMENT_GROUP_META: Record<AchievementGroup, { label: string }> = {
  collect: { label: '足迹收集' },
  quiz: { label: '挑战实力' },
  habit: { label: '每日习惯' },
  review: { label: '记忆深度' },
}

export interface AchievementDef {
  id: string
  title: string
  desc: string
  /** 徽章上的几何符号（不用 emoji，跨平台渲染一致） */
  mark: string
  hue: string
  group: AchievementGroup
  /** 当前进度 0..1，响应式读取各处学习状态 */
  progress: () => number
}

export interface AchievementView extends AchievementDef {
  pct: number
  unlockedAt: number | null
}

const STORAGE_KEY = 'geolab.achv.v1'

let persistenceBound = false

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * 成就收藏室：
 * - 收集类看 useDeck 的解锁足迹，挑战类看答题统计，
 *   习惯类看每日挑战打卡，复习类看 SRS 记忆阶段。
 * - 解锁瞬间写入时间戳并进队列，由页面层弹 toast；重复判断幂等。
 */
export function useAchievements() {
  const deck = useDeck()
  const game = useGame()
  const srs = useSRS()
  const china = useChina()

  const unlocked = useState<Record<string, number>>('geo-achv', () => ({}))
  const hydrated = useState<boolean>('geo-achv-hydrated', () => false)
  /** 刚解锁、还没被页面消费的成就 id 队列 */
  const justUnlocked = useState<string[]>('geo-achv-queue', () => [])

  function hydrate() {
    if (hydrated.value || typeof window === 'undefined') return
    hydrated.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const clean: Record<string, number> = {}
      for (const [id, ts] of Object.entries(parsed)) {
        if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) clean[id] = ts
      }
      unlocked.value = clean
    } catch {
      /* 忽略损坏存储 */
    }
    check()
  }

  if (import.meta.client && !persistenceBound) {
    persistenceBound = true
    effectScope(true).run(() =>
      watch(
        unlocked,
        () => {
          if (typeof window === 'undefined') return
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(unlocked.value))
          } catch {
            /* ignore */
          }
        },
        { deep: true },
      ),
    )
  }

  /** 已登记进阶复习（stage ≥ 1）的国家数 */
  const reviewingCount = computed(
    () => Object.values(srs.entries.value).filter((e) => e.stage >= 1).length,
  )
  /** 进入 30 天长期记忆（stage 封顶）的国家数 */
  const deepMemoryCount = computed(
    () => Object.values(srs.entries.value).filter((e) => e.stage >= 5).length,
  )

  const defs = computed<AchievementDef[]>(() => {
    const seenSet = deck.seenSet.value
    const stats = game.stats.value
    const streak = game.dailyStreak.value
    const checkins = game.checkins.value.length
    const accuracy = stats.rounds >= 20 ? stats.correct / stats.rounds : 0

    const continentProg = (c: (typeof CONTINENTS)[number]) => {
      const list = byContinent[c]
      const got = list.filter((x) => seenSet.has(x.id)).length
      return list.length ? got / list.length : 0
    }

    return [
      // ---- 足迹收集 ----
      { id: 'c-first', group: 'collect', hue: '#1d4ed8', mark: '①', title: '第一次出发', desc: '解锁第 1 个国家', progress: () => clamp01(deck.seenCount.value / 1) },
      { id: 'c-10', group: 'collect', hue: '#1d4ed8', mark: '②', title: '小有所成', desc: '解锁 10 个国家', progress: () => clamp01(deck.seenCount.value / 10) },
      { id: 'c-50', group: 'collect', hue: '#1d4ed8', mark: '③', title: '半程旅人', desc: '解锁 50 个国家', progress: () => clamp01(deck.seenCount.value / 50) },
      { id: 'c-100', group: 'collect', hue: '#1d4ed8', mark: '④', title: '百国行记', desc: '解锁 100 个国家', progress: () => clamp01(deck.seenCount.value / 100) },
      { id: 'c-asia', group: 'collect', hue: '#c2410c', mark: '亞', title: '亚洲通', desc: '集齐亚洲全部国家', progress: () => continentProg('亚洲') },
      { id: 'c-europe', group: 'collect', hue: '#1d4ed8', mark: '歐', title: '欧洲通', desc: '集齐欧洲全部国家', progress: () => continentProg('欧洲') },
      { id: 'c-africa', group: 'collect', hue: '#a16207', mark: '非', title: '非洲通', desc: '集齐非洲全部国家', progress: () => continentProg('非洲') },
      { id: 'c-na', group: 'collect', hue: '#0e7490', mark: '北', title: '北美通', desc: '集齐北美洲全部国家', progress: () => continentProg('北美洲') },
      { id: 'c-sa', group: 'collect', hue: '#15803d', mark: '南', title: '南美通', desc: '集齐南美洲全部国家', progress: () => continentProg('南美洲') },
      { id: 'c-oc', group: 'collect', hue: '#7e22ce', mark: '洋', title: '大洋通', desc: '集齐大洋洲全部国家', progress: () => continentProg('大洋洲') },
      { id: 'c-world', group: 'collect', hue: '#191712', mark: '环', title: '环球旅行家', desc: `集齐全部 ${countries.length} 个国家与地区`, progress: () => clamp01(deck.seenCount.value / countries.length) },
      { id: 'c-china', group: 'collect', hue: '#c2410c', mark: '華', title: '华夏通', desc: `集齐全部 ${CN_PROVINCES.length} 个省级行政区`, progress: () => clamp01(china.seenCount.value / CN_PROVINCES.length) },
      // ---- 挑战实力 ----
      { id: 'q-first', group: 'quiz', hue: '#15803d', mark: '首', title: '首战告捷', desc: '第一次答对挑战题', progress: () => clamp01(stats.correct / 1) },
      { id: 'q-streak5', group: 'quiz', hue: '#15803d', mark: '伍', title: '五连击', desc: '连续答对 5 题', progress: () => clamp01(stats.best / 5) },
      { id: 'q-streak10', group: 'quiz', hue: '#15803d', mark: '拾', title: '十连击', desc: '连续答对 10 题', progress: () => clamp01(stats.best / 10) },
      { id: 'q-score100', group: 'quiz', hue: '#b45309', mark: '百', title: '百分俱乐部', desc: '累计得分 100', progress: () => clamp01(stats.score / 100) },
      { id: 'q-score500', group: 'quiz', hue: '#b45309', mark: '伍佰', title: '高分选手', desc: '累计得分 500', progress: () => clamp01(stats.score / 500) },
      { id: 'q-acc80', group: 'quiz', hue: '#b45309', mark: '准', title: '神射手', desc: '累计 20 题后正确率 ≥ 80%', progress: () => clamp01(accuracy / 0.8) },
      { id: 'q-cn10', group: 'quiz', hue: '#c2410c', mark: '省', title: '省区挑战者', desc: '省区挑战累计答对 10 题', progress: () => clamp01(china.quizStats.value.correct / 10) },
      // ---- 每日习惯 ----
      { id: 'h-first', group: 'habit', hue: '#c2410c', mark: '日', title: '第一天', desc: '完成第一次每日挑战打卡', progress: () => clamp01(checkins / 1) },
      { id: 'h-streak3', group: 'habit', hue: '#c2410c', mark: '叁', title: '三日之约', desc: '连续打卡 3 天', progress: () => clamp01(streak / 3) },
      { id: 'h-streak7', group: 'habit', hue: '#c2410c', mark: '柒', title: '一周不落', desc: '连续打卡 7 天', progress: () => clamp01(streak / 7) },
      { id: 'h-streak30', group: 'habit', hue: '#c2410c', mark: '卅', title: '月度习惯', desc: '连续打卡 30 天', progress: () => clamp01(streak / 30) },
      { id: 'h-total10', group: 'habit', hue: '#c2410c', mark: '旬', title: '打卡常客', desc: '累计打卡 10 天', progress: () => clamp01(checkins / 10) },
      // ---- 记忆深度 ----
      { id: 'r-first', group: 'review', hue: '#0e7490', mark: '习', title: '温故知新', desc: '第一次进入间隔复习', progress: () => clamp01(reviewingCount.value / 1) },
      { id: 'r-10', group: 'review', hue: '#0e7490', mark: '復', title: '复习在册', desc: '10 个国家进入间隔复习', progress: () => clamp01(reviewingCount.value / 10) },
      { id: 'r-deep', group: 'review', hue: '#0e7490', mark: '久', title: '长期记忆', desc: '有国家进入 30 天记忆阶梯', progress: () => clamp01(deepMemoryCount.value / 1) },
    ]
  })

  const list = computed<AchievementView[]>(() =>
    defs.value.map((d) => ({
      ...d,
      pct: clamp01(d.progress()),
      unlockedAt: unlocked.value[d.id] ?? null,
    })),
  )

  const unlockedCount = computed(() => list.value.filter((a) => a.unlockedAt).length)

  /** 扫一遍全部成就，达标的登记解锁时间并入队列（幂等） */
  function check() {
    const newly: string[] = []
    for (const d of defs.value) {
      if (unlocked.value[d.id]) continue
      if (d.progress() >= 1) newly.push(d.id)
    }
    if (!newly.length) return
    const now = Date.now()
    const next = { ...unlocked.value }
    for (const id of newly) next[id] = now
    unlocked.value = next
    justUnlocked.value = [...justUnlocked.value, ...newly]
  }

  // 学习状态一变就重扫；defs 是 computed，任何依赖变化都会触发
  if (import.meta.client) {
    effectScope(true).run(() => watch(list, check))
  }

  /** 页面 toast 消费一条解锁通知 */
  function shiftUnlocked(): { id: string; title: string } | null {
    const id = justUnlocked.value[0]
    if (!id) return null
    justUnlocked.value = justUnlocked.value.slice(1)
    const hit = defs.value.find((d) => d.id === id)
    return hit ? { id, title: hit.title } : null
  }

  return { list, unlockedCount, justUnlocked, shiftUnlocked, hydrated, hydrate, check }
}
