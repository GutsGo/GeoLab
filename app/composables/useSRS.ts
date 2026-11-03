import { computed, effectScope, watch } from 'vue'
import { DAY_MS } from '~/lib/date'

export interface SrsEntry {
  /** 复习阶段：0 起步；到期重温或答题升一阶，答错归零 */
  stage: number
  /** 上次看到（或答题）的时间戳 */
  seenAt: number
  /** 下次到期的时间戳 */
  due: number
}

const STORAGE_KEY = 'geolab.srs.v1'
/** 复习间隔（天），下标即 stage，封顶 30 天 */
const SCHEDULE = [1, 2, 4, 7, 14, 30]

/** 保证持久化 watcher 只绑定一次，且不随调用方组件卸载而失效 */
let persistenceBound = false

/**
 * 间隔重复（SRS）登记表：
 * - 抽卡/浏览看到国家 → view()：首次登记，隔天到期；已到期的看到算一次重温，升一阶
 * - 挑战答题 → quiz()：答对升一阶，答错归零、明天再见
 * - 抽卡侧每抽 3 次插 1 次"到期复习"，看过的国家因此会主动回来
 */
export function useSRS() {
  const entries = useState<Record<string, SrsEntry>>('geo-srs', () => ({}))
  const hydrated = useState<boolean>('geo-srs-hydrated', () => false)

  function hydrate() {
    if (hydrated.value || typeof window === 'undefined') return
    hydrated.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, Partial<SrsEntry>>
      const clean: Record<string, SrsEntry> = {}
      for (const [id, e] of Object.entries(parsed)) {
        if (!e || typeof e.stage !== 'number' || typeof e.due !== 'number') continue
        clean[id] = {
          stage: Math.max(0, Math.min(e.stage, SCHEDULE.length - 1)),
          seenAt: typeof e.seenAt === 'number' ? e.seenAt : 0,
          due: e.due,
        }
      }
      entries.value = clean
    } catch {
      /* 忽略损坏的本地存储 */
    }
  }

  function persist() {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.value))
    } catch {
      /* quota 或隐私模式，直接放弃持久化 */
    }
  }

  if (import.meta.client && !persistenceBound) {
    persistenceBound = true
    // detached scope：不挂靠调用方组件，任何组件卸载都不会让持久化停摆
    effectScope(true).run(() => watch(entries, persist, { deep: true }))
  }

  /** 当前已到期的国家 id 列表 */
  const dueIds = computed(() => {
    const now = Date.now()
    return Object.keys(entries.value).filter((id) => (entries.value[id]?.due ?? 0) <= now)
  })

  function dueOf(id: string): number | null {
    return entries.value[id]?.due ?? null
  }

  /** 观看国家：首次登记（明天到期）；已到期的看到算一次重温，升一阶 */
  function view(id: string) {
    const now = Date.now()
    const e = entries.value[id]
    if (!e) {
      entries.value = { ...entries.value, [id]: { stage: 0, seenAt: now, due: now + SCHEDULE[0]! * DAY_MS } }
      return
    }
    if (now >= e.due) {
      const stage = Math.min(e.stage + 1, SCHEDULE.length - 1)
      entries.value = { ...entries.value, [id]: { stage, seenAt: now, due: now + SCHEDULE[stage]! * DAY_MS } }
    }
  }

  /** 答题结果：答对升一阶；答错归零，明天再见。首次答题按结果直接登记 */
  function quiz(id: string, ok: boolean) {
    const now = Date.now()
    const e = entries.value[id]
    if (!e) {
      const stage = ok ? 1 : 0
      entries.value = {
        ...entries.value,
        [id]: { stage, seenAt: now, due: now + SCHEDULE[stage]! * DAY_MS },
      }
      return
    }
    const stage = ok ? Math.min(e.stage + 1, SCHEDULE.length - 1) : 0
    entries.value = {
      ...entries.value,
      [id]: { stage, seenAt: now, due: now + SCHEDULE[stage]! * DAY_MS },
    }
  }

  /** 上次看到距今天数（用于"上次 3 天前"这类提示）；从未登记返回 null */
  function seenDaysAgo(id: string): number | null {
    const e = entries.value[id]
    if (!e) return null
    return Math.floor((Date.now() - e.seenAt) / DAY_MS)
  }

  /** 清空复习记录（跟随"清空学习进度"） */
  function reset() {
    entries.value = {}
  }

  return { entries, hydrated, hydrate, dueIds, dueOf, view, quiz, seenDaysAgo, reset }
}
