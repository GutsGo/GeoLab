import { computed, effectScope, watch } from 'vue'
import { countries, byContinent, countryById, CONTINENTS } from '~/data'
import type { Continent, Country } from '~/data/types'
import { pickOne, shuffle } from '~/lib/random'

export type Filter = '全部' | Continent

const STORAGE_KEY = 'geolab.seen.v1'
const HISTORY_LIMIT = 40

/** 保证持久化 watcher 只绑定一次，且不随调用方组件卸载而失效 */
let persistenceBound = false

export function useDeck() {
  const currentId = useState<string>('geo-current', () => '')
  const filter = useState<Filter>('geo-filter', () => '全部')
  const seen = useState<string[]>('geo-seen', () => [])
  const pool = useState<string[]>('geo-pool', () => [])
  const history = useState<string[]>('geo-history', () => [])
  const hydrated = useState<boolean>('geo-hydrated', () => false)
  const pickedCity = useState<string>('geo-picked-city', () => '')

  const pools = computed(() => (filter.value === '全部' ? countries : byContinent[filter.value]))
  const current = computed<Country | null>(() =>
    currentId.value ? countryById.get(currentId.value) ?? null : null,
  )
  /** 命中判断走 Set，避免 includes 的 O(n²) */
  const seenSet = computed(() => new Set(seen.value))
  const seenCount = computed(() => seen.value.length)
  const total = computed(() => countries.length)
  const seenPct = computed(() =>
    countries.length ? Math.round((seen.value.length / countries.length) * 100) : 0,
  )

  /** 当前筛选范围内还没看过的数量 */
  const remaining = computed(() => {
    let n = 0
    for (const c of pools.value) if (!seenSet.value.has(c.id)) n++
    return n
  })
  /** 当前范围已经全部看过，接下来的抽取属于"再刷一遍" */
  const poolCleared = computed(() => pools.value.length > 0 && remaining.value === 0)

  const continentStats = computed(() =>
    CONTINENTS.map((c) => {
      const list = byContinent[c]
      const got = list.filter((x) => seenSet.value.has(x.id)).length
      return { continent: c, got, total: list.length }
    }),
  )

  /** history 第一个是当前，第二个才是"上一个" */
  const canBack = computed(() => history.value.length > 1)

  function hydrate() {
    if (hydrated.value || typeof window === 'undefined') return
    hydrated.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { seen?: string[]; history?: string[]; current?: string }
        if (Array.isArray(parsed.seen)) seen.value = parsed.seen.filter((id) => countryById.has(id))
        if (Array.isArray(parsed.history)) history.value = parsed.history.filter((id) => countryById.has(id))
        if (parsed.current && countryById.has(parsed.current)) currentId.value = parsed.current
      }
    } catch {
      /* 忽略损坏的本地存储 */
    }
  }

  function persist() {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ seen: seen.value, history: history.value, current: currentId.value }),
      )
    } catch {
      /* quota 或隐私模式，直接放弃持久化 */
    }
  }

  if (import.meta.client && !persistenceBound) {
    persistenceBound = true
    // detached scope：watcher 不挂靠调用方组件，任何组件卸载都不会让持久化停摆
    effectScope(true).run(() => watch([seen, history, currentId], persist, { deep: true }))
  }

  function markSeen(id: string) {
    if (!seenSet.value.has(id)) seen.value = [...seen.value, id]
  }

  /** 记录一次"看到"，顺带推进历史 */
  function remember(id: string) {
    markSeen(id)
    history.value = [id, ...history.value.filter((x) => x !== id)].slice(0, HISTORY_LIMIT)
  }

  /** 抽一个：优先没看过的，其次同范围随机，最后全量随机 */
  function draw(): Country | null {
    pickedCity.value = ''
    const list = pools.value
    if (!list.length) return null

    const unseen = list.filter((c) => !seenSet.value.has(c.id))
    let nextId: string | undefined

    if (unseen.length) {
      // 复用上一轮洗好的袋子，保证一轮内不重复；换筛选条件后旧袋子会被交集自然过滤
      const unseenIds = new Set(unseen.map((c) => c.id))
      const rest = pool.value.filter((id) => unseenIds.has(id))
      const bag = rest.length ? rest : shuffle(unseen.map((c) => c.id))
      nextId = bag[0]
      pool.value = bag.slice(1)
    } else {
      const others = list.filter((c) => c.id !== currentId.value)
      nextId = pickOne(others.length ? others : list)?.id
      pool.value = []
    }

    if (!nextId) return null
    currentId.value = nextId
    remember(nextId)
    return countryById.get(nextId) ?? null
  }

  /** 回到上一个抽到的国家（不改变它的已解锁状态） */
  function back(): Country | null {
    if (history.value.length < 2) return null
    const prev = history.value[1]
    history.value = history.value.slice(1)
    if (!prev) return null
    currentId.value = prev
    pickedCity.value = ''
    return countryById.get(prev) ?? null
  }

  /** 在同一国家的城市之间轮换；返回下一个城市名，同时更新 pickedCity */
  function cycleCity(countryId: string, currentName = ''): string | null {
    const c = countryById.get(countryId)
    if (!c || !c.cities.length) return null
    const rest = c.cities.filter((x) => x.name !== currentName)
    const hit = pickOne(rest.length ? rest : c.cities)
    if (!hit) return null
    pickedCity.value = hit.name
    return hit.name
  }

  function focusCountry(id: string) {
    if (!countryById.has(id)) return
    currentId.value = id
    pickedCity.value = ''
    remember(id)
  }

  function setFilter(f: Filter) {
    filter.value = f
    pool.value = []
    const cur = current.value
    if (cur && f !== '全部' && cur.continent !== f) draw()
  }

  function resetProgress() {
    seen.value = []
    history.value = []
    pool.value = []
    currentId.value = ''
    pickedCity.value = ''
  }

  return {
    countries,
    CONTINENTS,
    currentId,
    current,
    filter,
    pools,
    pickedCity,
    seen,
    seenSet,
    seenCount,
    total,
    seenPct,
    remaining,
    poolCleared,
    canBack,
    continentStats,
    hydrated,
    hydrate,
    draw,
    back,
    cycleCity,
    focusCountry,
    setFilter,
    resetProgress,
  }
}
