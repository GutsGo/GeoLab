export const DAY_MS = 86_400_000

/** 本地时区的 YYYY-MM-DD（打卡与每日挑战都用它做 key，避免 UTC 偏移导致打卡提前/滞后） */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 把 YYYY-MM-DD 平移 delta 天（delta 为负即往前），返回同样的 key 格式 */
export function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  date.setDate(date.getDate() + delta)
  return todayKey(date)
}
