import { computed, effectScope, watch } from 'vue'
import { byContinent, countries, countryById } from '~/data'
import type { Continent, Country } from '~/data/types'
import { pickOne, shuffle, seededShuffle } from '~/lib/random'
import { todayKey, shiftDay } from '~/lib/date'
import { NO_OUTLINE_IDS } from '~/lib/world'
import { useSRS } from '~/composables/useSRS'

/** 第一段题型：认轮廓 / 认国旗 / 地图定位；答对后进入 capital 追问 */
export type PrimaryType = 'country' | 'flag' | 'locate'
export type GameType = PrimaryType | 'capital'

export const GAME_META: Record<GameType, { label: string; question: string; hint: string }> = {
  country: { label: '猜国家', question: '这块轮廓属于哪个国家？', hint: '国名四选一，干扰项都来自同一大洲' },
  flag: { label: '认国旗', question: '这是哪面国旗？', hint: '看配色与图案，国名四选一，干扰项来自同一大洲' },
  locate: { label: '找位置', question: '在世界地图上点出这个国家', hint: '在地图上点击它的位置作答' },
  capital: { label: '追问首都', question: '它的首都是？', hint: '首都四选一，干扰项来自同一大洲' },
}

export const DAILY_SIZE = 10
/** 每日挑战的题型轮换：认轮廓 / 认国旗 / 找位置 循环 */
const PRIMARY_CYCLE: PrimaryType[] = ['country', 'flag', 'locate']

export interface GameRound {
  /** 本轮属于哪种对局：每日挑战按天固定题序，自由练习无限随机 */
  mode: 'daily' | 'free'
  /** 当前阶段题型 */
  type: GameType
  /** 本轮第一段题型 */
  primary: PrimaryType
  target: Country
  /** locate 题没有选项——在地图上直接点 */
  options: string[]
  answer: string
  /** capital 阶段没有提示——它本来就是奖励分 */
  hints: string[]
  revealed: number
  /** country/flag 存选项文本；locate 存点中的国家 id */
  picked: string | null
  /** capital 阶段主动放弃奖励分 */
  skipped: boolean
  ok: boolean | null
  /** 本轮累计得分：认出国家 2 分，连首都答对再 +1 */
  gained: number
  /** 答对国家后的短暂确认停顿：让绿态和加分被看见，再自动进首都题 */
  awaitCapital: boolean
  /** 每日挑战里本轮是否已结算（防止重复计数） */
  committed: boolean
}

export interface GameStats {
  rounds: number
  correct: number
  score: number
  streak: number
  best: number
}

export interface DailyState {
  /** YYYY-MM-DD */
  date: string
  /** 按日期种子固定的目标国 id 序列 */
  ids: string[]
  /** 与 ids 对齐的第一段题型序列 */
  primary: PrimaryType[]
  /** 已完成题数 */
  index: number
  correct: number
  score: number
  finished: boolean
  /** 是否已计入今日打卡 */
  checkedIn: boolean
}

const GAME_KEY = 'geolab.game.v1'
const DAILY_KEY = 'geolab.daily.v1'
const BASE_SCORE_COUNTRY = 2
const BASE_SCORE_CAPITAL = 1
/** 答对国家的确认停顿时长：够看见绿态和加分，不至于拖节奏 */
const ADVANCE_PAUSE_MS = 1200

interface DailyStore {
  daily: DailyState | null
  checkins: string[]
}

let persistenceBound = false
let dailyPersistenceBound = false
let advanceTimer: ReturnType<typeof setTimeout> | null = null

function cancelAdvance() {
  if (advanceTimer) {
    clearTimeout(advanceTimer)
    advanceTimer = null
  }
}

/** 提示阶梯：从模糊方位到决定性线索。注意不能漏首都——那是第二段的答案 */
function hintsFor(c: Country): string[] {
  return [
    `位于${c.continent}的${c.subregion}，人口约 ${c.population}。`,
    `面积约 ${c.area}，官方语言 ${c.language}。`,
    `${c.flag} ${c.tagline}`,
  ]
}

function buildOptions(type: GameType, target: Country): string[] {
  if (type === 'locate') return []

  if (type === 'capital') {
    // capital：干扰项优先同大洲（堵住排除法），凑不满再全球补
    const chosen = new Set<string>([target.capital])
    const out = [target.capital]
    const sameCont = countries.filter((c) => c.continent === target.continent && c.id !== target.id)
    for (const c of [...shuffle(sameCont), ...shuffle(countries)]) {
      if (out.length >= 4) break
      if (chosen.has(c.capital)) continue
      chosen.add(c.capital)
      out.push(c.capital)
    }
    return shuffle(out)
  }

  // country / flag：国名四选一，干扰项都来自同一大洲
  const pool = byContinent[target.continent].filter((c) => c.id !== target.id)
  const near = shuffle(pool).slice(0, 3).map((c) => c.name)
  return shuffle([target.name, ...near])
}

/** 能出题的国家：必须有轮廓 */
function quizPool(): Country[] {
  return countries.filter((c) => !NO_OUTLINE_IDS.has(c.id))
}

/** 按日期种子生成当天挑战：题目与题型顺序当天全局一致 */
function buildDaily(date: string): DailyState {
  const ids = seededShuffle(quizPool().map((c) => c.id), `geolab-daily-${date}`).slice(0, DAILY_SIZE)
  const primary = ids.map((_, i) => PRIMARY_CYCLE[i % PRIMARY_CYCLE.length]!)
  return { date, ids, primary, index: 0, correct: 0, score: 0, finished: false, checkedIn: false }
}

export function useGame() {
  const srs = useSRS()

  const stats = useState<GameStats>('geo-game-stats', () => ({
    rounds: 0,
    correct: 0,
    score: 0,
    streak: 0,
    best: 0,
  }))
  const hydrated = useState<boolean>('geo-game-hydrated', () => false)
  const mode = useState<'daily' | 'free'>('geo-game-mode', () => 'daily')
  const daily = useState<DailyState | null>('geo-game-daily', () => null)
  const checkins = useState<string[]>('geo-game-checkins', () => [])
  const dailyHydrated = useState<boolean>('geo-game-daily-hydrated', () => false)

  function hydrate() {
    if (hydrated.value || typeof window === 'undefined') return
    hydrated.value = true
    srs.hydrate()
    try {
      const raw = localStorage.getItem(GAME_KEY)
      if (!raw) return
      const p = JSON.parse(raw) as Partial<GameStats>
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
      stats.value = {
        rounds: num(p.rounds),
        correct: num(p.correct),
        score: num(p.score),
        streak: num(p.streak),
        best: num(p.best),
      }
    } catch {
      /* 忽略损坏存储 */
    }
  }

  /** 读取每日挑战与打卡记录，跨天自动重出题 */
  function hydrateDaily() {
    if (dailyHydrated.value || typeof window === 'undefined') return
    dailyHydrated.value = true
    try {
      const raw = localStorage.getItem(DAILY_KEY)
      if (raw) {
        const p = JSON.parse(raw) as Partial<DailyStore>
        if (Array.isArray(p.checkins)) {
          checkins.value = p.checkins.filter((x): x is string => /^\d{4}-\d{2}-\d{2}$/.test(x))
        }
        if (p.daily && typeof p.daily.date === 'string' && Array.isArray(p.daily.ids)) {
          daily.value = p.daily as DailyState
        }
      }
    } catch {
      /* 忽略损坏存储 */
    }
    ensureDaily()
  }

  if (import.meta.client && !persistenceBound) {
    persistenceBound = true
    effectScope(true).run(() =>
      watch(
        stats,
        (v) => {
          try {
            localStorage.setItem(GAME_KEY, JSON.stringify(v))
          } catch {
            /* ignore */
          }
        },
        { deep: true },
      ),
    )
  }

  if (import.meta.client && !dailyPersistenceBound) {
    dailyPersistenceBound = true
    effectScope(true).run(() =>
      watch(
        [daily, checkins],
        () => {
          if (typeof window === 'undefined') return
          try {
            const store: DailyStore = { daily: daily.value, checkins: checkins.value }
            localStorage.setItem(DAILY_KEY, JSON.stringify(store))
          } catch {
            /* ignore */
          }
        },
        { deep: true },
      ),
    )
  }

  /** 确保每日挑战是今天的：跨天（或首次）重出题 */
  function ensureDaily() {
    const today = todayKey()
    if (!daily.value || daily.value.date !== today || !Array.isArray(daily.value.ids)) {
      daily.value = buildDaily(today)
    }
  }

  /** 连续打卡天数：今天没打则从昨天起算（不断签） */
  const dailyStreak = computed(() => {
    const set = new Set(checkins.value)
    let cursor = todayKey()
    if (!set.has(cursor)) {
      cursor = shiftDay(cursor, -1)
      if (!set.has(cursor)) return 0
    }
    let n = 0
    while (set.has(cursor)) {
      n++
      cursor = shiftDay(cursor, -1)
    }
    return n
  })

  /**
   * 对局状态放在 useState 里跨挂载共享：
   * 挑战面板挂在 v-else-if 下，切 tab 会卸载组件，局部 ref 会丢题。
   */
  const round = useState<GameRound | null>('geo-game-round', () => null)
  const roundNo = useState<number>('geo-game-round-no', () => 0)
  /** 错题重现队列：答错的国家隔 2 轮后优先重考（仅自由练习） */
  const retryQueue = useState<{ id: string; at: number }[]>('geo-game-retry', () => [])

  function makeRound(mode: 'daily' | 'free', target: Country, primary: PrimaryType): GameRound {
    return {
      mode,
      type: primary,
      primary,
      target,
      options: buildOptions(primary, target),
      answer: target.name,
      hints: hintsFor(target),
      revealed: 0,
      picked: null,
      skipped: false,
      ok: null,
      gained: 0,
      awaitCapital: false,
      committed: false,
    }
  }

  function pickFreeTarget(): Country | null {
    const pool = quizPool()
    if (!pool.length) return null
    const due = retryQueue.value.filter((e) => roundNo.value - e.at >= 2)
    if (due.length) {
      const oldest = due[0]
      retryQueue.value = retryQueue.value.filter((e) => e !== oldest)
      const hit = pool.find((c) => c.id === oldest?.id)
      if (hit) return hit
    }
    return pickOne(pool) ?? null
  }

  /** 开一道新题。组件挂载时只有没有进行中的对局才应该调用 */
  function startRound() {
    if (mode.value === 'daily') {
      ensureDaily()
      const d = daily.value
      if (!d || d.finished || d.index >= d.ids.length) return
      const target = countryById.get(d.ids[d.index] ?? '')
      if (!target) {
        // 脏数据兜底：跳过这一题
        d.index++
        return
      }
      round.value = makeRound('daily', target, d.primary[d.index] ?? 'country')
      roundNo.value++
      return
    }
    const target = pickFreeTarget()
    if (!target) return
    round.value = makeRound('free', target, pickOne(PRIMARY_CYCLE) ?? 'country')
    roundNo.value++
  }

  function clearRound() {
    cancelAdvance()
    round.value = null
    roundNo.value = 0
  }

  /** 切换对局模式：清掉进行中的题，由调用方决定是否立即开新题 */
  function setMode(m: 'daily' | 'free') {
    if (mode.value === m) return
    mode.value = m
    clearRound()
  }

  /** 停顿结束：同一道题进入追问首都阶段，地图不动 */
  function advanceToCapital() {
    const r = round.value
    if (!r || r.type === 'capital' || !r.awaitCapital) return
    cancelAdvance()
    r.type = 'capital'
    r.options = buildOptions('capital', r.target)
    r.answer = r.target.capital
    r.hints = []
    r.picked = null
    r.ok = null
    r.awaitCapital = false
  }

  /** capital 阶段放弃奖励分，直接看结果 */
  function skipBonus() {
    const r = round.value
    if (r && r.type === 'capital' && !r.picked) {
      r.skipped = true
      if (r.mode === 'daily') commitDaily(r)
    }
  }

  function reveal(round: GameRound): boolean {
    if (round.type === 'capital' || round.picked || round.skipped) return false
    if (round.revealed >= round.hints.length) return false
    round.revealed++
    return true
  }

  /** 每日挑战：主题型答对时记 correct */
  function commitDailyCorrect(ok: boolean) {
    const d = daily.value
    if (!d || d.date !== todayKey()) return
    d.correct += ok ? 1 : 0
  }

  /** 每日挑战：本轮终局（主题型答错 / 首都题作答或跳过）时结算得分并推进 */
  function commitDaily(r: GameRound) {
    if (r.committed) return
    r.committed = true
    const d = daily.value
    if (!d || r.mode !== 'daily' || d.date !== todayKey()) return
    d.score += r.gained
    d.index++
    if (d.index >= d.ids.length) {
      d.finished = true
      if (!d.checkedIn) {
        d.checkedIn = true
        const today = todayKey()
        if (!checkins.value.includes(today)) checkins.value = [...checkins.value, today]
      }
    }
  }

  function answer(round: GameRound, choice: string): boolean {
    if (round.picked || round.skipped) return round.ok === true
    round.picked = choice
    // locate 题传的是点中的国家 id，直接与目标 id 比对
    const ok = round.type === 'locate' ? choice === round.target.id : choice === round.answer
    round.ok = ok

    if (round.type !== 'capital') {
      const gained = ok ? Math.max(0, BASE_SCORE_COUNTRY - round.revealed) : 0
      round.gained += gained
      stats.value = {
        rounds: stats.value.rounds + 1,
        correct: stats.value.correct + (ok ? 1 : 0),
        score: stats.value.score + gained,
        streak: ok ? stats.value.streak + 1 : 0,
        best: Math.max(stats.value.best, ok ? stats.value.streak + 1 : stats.value.streak),
      }
      // SRS：答对升阶，答错明天再见
      srs.quiz(round.target.id, ok)
      if (round.mode === 'daily') commitDailyCorrect(ok)

      if (!ok) {
        // 自由练习：答错进错题队列，隔 2 轮重考；已在队列里就不重复记
        if (round.mode === 'free' && !retryQueue.value.some((e) => e.id === round.target.id)) {
          retryQueue.value = [...retryQueue.value, { id: round.target.id, at: roundNo.value }]
        }
      } else {
        // 答对国家：先停在确认态让反馈被看见，随后自动进入首都追问
        round.awaitCapital = true
        cancelAdvance()
        advanceTimer = setTimeout(() => {
          advanceTimer = null
          advanceToCapital()
        }, ADVANCE_PAUSE_MS)
      }
      return ok
    }

    // capital 阶段：纯奖励分，rounds/correct/streak 在认出国家那刻已经记过
    if (ok) {
      round.gained += BASE_SCORE_CAPITAL
      stats.value = { ...stats.value, score: stats.value.score + BASE_SCORE_CAPITAL }
    }
    if (round.mode === 'daily') commitDaily(round)
    return ok
  }

  function reset() {
    stats.value = { rounds: 0, correct: 0, score: 0, streak: 0, best: 0 }
    retryQueue.value = []
    clearRound()
  }

  return {
    stats,
    round,
    roundNo,
    mode,
    daily,
    checkins,
    dailyStreak,
    hydrated,
    hydrate,
    hydrateDaily,
    ensureDaily,
    startRound,
    skipBonus,
    reveal,
    answer,
    advanceToCapital,
    setMode,
    clearRound,
    reset,
    countryById,
  }
}

export type { Country, Continent }
