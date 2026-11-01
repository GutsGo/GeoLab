import type { Country, Continent } from './types'
import { asia } from './asia'
import { europe } from './europe'
import { africa } from './africa'
import { america } from './america'
import { oceania } from './oceania'

export const countries: Country[] = [...asia, ...europe, ...africa, ...america, ...oceania]

export const byContinent: Record<Continent, Country[]> = {
  亚洲: asia,
  欧洲: europe,
  非洲: africa,
  北美洲: america.filter((c) => c.continent === '北美洲'),
  南美洲: america.filter((c) => c.continent === '南美洲'),
  大洋洲: oceania,
}

export const countryById = new Map(countries.map((c) => [c.id, c]))

/** 用稳定 hash 把字符串映射到色相，用于同一国家在 UI 中的颜色一致性 */
export function hueOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

export * from './types'
