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
