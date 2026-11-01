export type Continent = '亚洲' | '欧洲' | '非洲' | '北美洲' | '南美洲' | '大洋洲'

export interface Stat {
  label: string
  value: string
}

export interface EthnicGroup {
  name: string
  pct: number
}

export interface Landmark {
  name: string
  desc: string
}

export interface Food {
  name: string
  desc: string
}

export interface CityPin {
  name: string
  lat: number
  lng: number
  capital?: boolean
}

export interface Country {
  /** ISO 3166-1 numeric，与 world-atlas 的 topojson id 对齐 */
  id: string
  /** ISO 3166-1 alpha-2，小写 */
  code: string
  name: string
  nameEn: string
  capital: string
  continent: Continent
  subregion: string
  flag: string
  /** 一句话钩子 */
  tagline: string
  population: string
  area: string
  language: string
  currency: string
  ethnic: EthnicGroup[]
  intro: string
  history: string
  culture: string
  landmarks: Landmark[]
  foods: Food[]
  funFact: string
  cities: CityPin[]
}

export const CONTINENTS: Continent[] = ['亚洲', '欧洲', '非洲', '北美洲', '南美洲', '大洋洲']

export const CONTINENT_META: Record<Continent, { en: string; hue: string; emoji: string }> = {
  亚洲: { en: 'Asia', hue: '#c2410c', emoji: '🏯' },
  欧洲: { en: 'Europe', hue: '#1d4ed8', emoji: '🏰' },
  非洲: { en: 'Africa', hue: '#a16207', emoji: '🦁' },
  北美洲: { en: 'North America', hue: '#0e7490', emoji: '🗽' },
  南美洲: { en: 'South America', hue: '#15803d', emoji: '🌿' },
  大洋洲: { en: 'Oceania', hue: '#7e22ce', emoji: '🏝️' },
}
