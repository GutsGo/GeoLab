/** Fisher–Yates，返回新数组（不改入参） */
export function shuffle<T>(input: readonly T[]): T[] {
  const a = [...input]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}

/** 均匀随机取一个；空数组返回 undefined */
export function pickOne<T>(input: readonly T[]): T | undefined {
  if (!input.length) return undefined
  return input[Math.floor(Math.random() * input.length)]
}

/** FNV-1a：把字符串散列成 32 位种子（每日挑战用日期串做种子） */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32：给定种子返回一个确定性的 [0,1) 随机函数 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 种子洗牌：同一种子永远得到同一顺序（同一天的每日挑战题序固定） */
export function seededShuffle<T>(input: readonly T[], seed: string): T[] {
  const rand = seededRandom(hashSeed(seed))
  const a = [...input]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}
