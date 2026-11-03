import { computed, effectScope, watch } from 'vue'
import { CN_PROVINCES, CN_REGION_META } from '~/data/china'
import type { CnRegion } from '~/data/china'

const SEEN_KEY = 'geolab.china.seen.v1'
const QUIZ_KEY = 'geolab.china.quiz.v1'
const HISTORY_LIMIT = 40

export interface CnRegionStat {
  region: CnRegion
  hue: string
  got: number
  total: number
}

/**
 * 省级学习进度：
 * - seen：浏览过详情卡即解锁，localStorage 持久化
 * - quizStats：省区挑战累计答对/作答数（成就用）
 * - 抽卡优先没看过的省区，与国家抽卡同一个策略
 */
export function useChina() {
  const seen = useState<string[]>('geo-cn-seen', () => [])
  const hydrated = useState<boolean>('geo-cn-hydrated', () => false)
  const currentId = useState<string>('geo-cn-current', () => '')
  const history = useState<string[]>('geo-cn-history', () => [])
  const quizStats = useState('geo-cn-quiz-stats', () => ({ correct: 0, asked: 0 }))

  const seenSet = computed(() => new Set(seen.value))
  const seenCount = computed(() => seen.value.length)
  const total = CN_PROVINCES.length

  const current = computed(() => CN_PROVINCES.find((p) => p.id === currentId.value) ?? null)

  const regionStats = computed<CnRegionStat[]>(() =>
    (Object.keys(CN_REGION_META) as CnRegion[]).map((region) => {
      const list = CN_PROVINCES.filter((p) => p.region === region)
      return {
        region,
        hue: CN_REGION_META[region].hue,
        got: list.filter((p) => seenSet.value.has(p.id)).length,
        total: list.length,
      }
    }),
  )

  function hydrate() {
    if (hydrated.value || typeof window === 'undefined') return
    hydrated.value = true
    try {
      const raw = localStorage.getItem(SEEN_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          const ids = new Set(CN_PROVINCES.map((p) => p.id))
          seen.value = parsed.filter((x): x is string => typeof x === 'string' && ids.has(x))
        }
      }
      const qr = localStorage.getItem(QUIZ_KEY)
      if (qr) {
        const parsed = JSON.parse(qr) as { correct?: unknown; asked?: unknown }
        quizStats.value = {
          correct: typeof parsed.correct === 'number' && parsed.correct >= 0 ? parsed.correct : 0,
          asked: typeof parsed.asked === 'number' && parsed.asked >= 0 ? parsed.asked : 0,
        }
      }
    } catch {
      /* 忽略损坏存储 */
    }
    if (typeof window !== 'undefined') bindPersistence()
  }

  let persistenceBound = false
  function bindPersistence() {
    if (persistenceBound) return
    persistenceBound = true
    effectScope(true).run(() => {
      watch(seen, (v) => localStorage.setItem(SEEN_KEY, JSON.stringify(v)), { deep: true })
      watch(quizStats, (v) => localStorage.setItem(QUIZ_KEY, JSON.stringify(v)), { deep: true })
    })
  }

  /** 记录一次「看过」 */
  function remember(id: string) {
    if (!seenSet.value.has(id)) seen.value = [...seen.value, id]
    history.value = [id, ...history.value.filter((x) => x !== id)].slice(0, HISTORY_LIMIT)
  }

  /** 抽一个：优先没看过的，其次全量随机 */
  function draw() {
    const unseen = CN_PROVINCES.filter((p) => !seenSet.value.has(p.id))
    const list = unseen.length ? unseen : CN_PROVINCES
    const p = list[Math.floor(Math.random() * list.length)] ?? CN_PROVINCES[0]
    if (!p) return null
    currentId.value = p.id
    remember(p.id)
    return current.value
  }

  function focusProvince(id: string) {
    const p = CN_PROVINCES.find((x) => x.id === id)
    if (!p) return
    currentId.value = p.id
    remember(p.id)
  }

  function recordAnswer(ok: boolean) {
    quizStats.value.asked += 1
    if (ok) quizStats.value.correct += 1
  }

  function resetProgress() {
    seen.value = []
    history.value = []
    currentId.value = ''
    quizStats.value = { correct: 0, asked: 0 }
  }

  return {
    seen,
    seenSet,
    seenCount,
    total,
    current,
    currentId,
    history,
    regionStats,
    quizStats,
    hydrated,
    hydrate,
    draw,
    focusProvince,
    recordAnswer,
    resetProgress,
  }
}
