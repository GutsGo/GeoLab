import { effectScope, watch } from 'vue'
import { byContinent, countries, countryById } from '~/data'
import type { Continent, Country } from '~/data/types'
import { pickOne, shuffle } from '~/lib/random'
import { NO_OUTLINE_IDS } from '~/lib/world'

export type GameType = 'country' | 'capital'

export const GAME_META: Record<GameType, { label: string; question: string; hint: string }> = {
  country: { label: '猜国家', question: '这块轮廓属于哪个国家？', hint: '国名四选一，干扰项都来自同一大洲' },
  capital: { label: '追问首都', question: '它的首都是？', hint: '首都四选一，干扰项来自同一大洲' },
}

export interface GameRound {
  /** 当前阶段：country 答对后自动进入 capital 追问 */
  type: GameType
  target: Country
  options: string[]
  answer: string
  /** capital 阶段没有提示——它本来就是奖励分 */
  hints: string[]
  revealed: number
  picked: string | null
  /** capital 阶段主动放弃奖励分 */
  skipped: boolean
  ok: boolean | null
  /** 本轮累计得分：认出国家 2 分，连首都答对再 +1 */
  gained: number
  /** 答对国家后的短暂确认停顿：让绿态和加分被看见，再自动进首都题 */
  awaitCapital: boolean
}

export interface GameStats {
  rounds: number
  correct: number
  score: number
  streak: number
  best: number
}

const GAME_KEY = 'geolab.game.v1'
const BASE_SCORE_COUNTRY = 2
const BASE_SCORE_CAPITAL = 1
/** 答对国家的确认停顿时长：够看见绿态和加分，不至于拖节奏 */
const ADVANCE_PAUSE_MS = 1200
let persistenceBound = false
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
  if (type === 'country') {
    const pool = byContinent[target.continent].filter((c) => c.id !== target.id)
    const near = shuffle(pool).slice(0, 3).map((c) => c.name)
    return shuffle([target.name, ...near])
  }

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

export function useGame() {
  const stats = useState<GameStats>('geo-game-stats', () => ({
    rounds: 0,
    correct: 0,
    score: 0,
    streak: 0,
    best: 0,
  }))
  const hydrated = useState<boolean>('geo-game-hydrated', () => false)

  function hydrate() {
    if (hydrated.value || typeof window === 'undefined') return
    hydrated.value = true
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

  /**
   * 对局状态放在 useState 里跨挂载共享：
   * 挑战面板挂在 v-else-if 下，切 tab 会卸载组件，局部 ref 会丢题。
   */
  const round = useState<GameRound | null>('geo-game-round', () => null)
  const roundNo = useState<number>('geo-game-round-no', () => 0)
  /** 错题重现队列：答错的国家隔 2 轮后优先重考 */
  const retryQueue = useState<{ id: string; at: number }[]>('geo-game-retry', () => [])

  function pickTarget(): Country | null {
    // 没有轮廓的国家（新加坡、马耳他）只看得到点，不适合出轮廓题
    const pool = countries.filter((c) => !NO_OUTLINE_IDS.has(c.id))
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
    const target = pickTarget()
    if (!target) return
    round.value = {
      type: 'country',
      target,
      options: buildOptions('country', target),
      answer: target.name,
      hints: hintsFor(target),
      revealed: 0,
      picked: null,
      skipped: false,
      ok: null,
      gained: 0,
      awaitCapital: false,
    }
    roundNo.value++
  }

  function clearRound() {
    cancelAdvance()
    round.value = null
    roundNo.value = 0
  }

  /** 停顿结束：同一道题进入追问首都阶段，地图不动 */
  function advanceToCapital() {
    const r = round.value
    if (!r || r.type !== 'country' || !r.awaitCapital) return
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
    if (r && r.type === 'capital' && !r.picked) r.skipped = true
  }

  function reveal(round: GameRound): boolean {
    if (round.type !== 'country' || round.picked || round.skipped) return false
    if (round.revealed >= round.hints.length) return false
    round.revealed++
    return true
  }

  function answer(round: GameRound, choice: string): boolean {
    if (round.picked || round.skipped) return round.ok === true
    round.picked = choice
    const ok = choice === round.answer
    round.ok = ok

    if (round.type === 'country') {
      const gained = ok ? Math.max(0, BASE_SCORE_COUNTRY - round.revealed) : 0
      round.gained += gained
      stats.value = {
        rounds: stats.value.rounds + 1,
        correct: stats.value.correct + (ok ? 1 : 0),
        score: stats.value.score + gained,
        streak: ok ? stats.value.streak + 1 : 0,
        best: Math.max(stats.value.best, ok ? stats.value.streak + 1 : stats.value.streak),
      }
      if (!ok) {
        // 答错进错题队列，隔 2 轮重考；已在队列里就不重复记
        if (!retryQueue.value.some((e) => e.id === round.target.id)) {
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
    hydrated,
    hydrate,
    startRound,
    skipBonus,
    reveal,
    answer,
    advanceToCapital,
    reset,
    countryById,
  }
}

export type { Country, Continent }
