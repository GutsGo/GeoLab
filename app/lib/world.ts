import { feature } from 'topojson-client'
import type { Feature, Geometry } from 'geojson'
import type { Topology } from 'topojson-specification'

/** GeoJsonProperties 是联合类型（含 null），不能拿来 extends，所以显式声明 */
export type WorldProperties = Record<string, unknown>

export interface WorldFeature extends Feature<Geometry, WorldProperties> {
  /** 规范化后的 ISO 3166-1 numeric；没有官方 id 的地区退化为 `x-<slug>` */
  id: string
  name: string
}

/**
 * world-atlas 的 countries-110m 里有三个 feature 没有 id：
 * N. Cyprus / Somaliland / Kosovo。原先它们全都被规范化成空串，
 * 导致 v-for 出现重复 key。这里用名称派生合成 id 兜住。
 */
const SYNTHETIC_PREFIX = 'x-'

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeId(id: unknown, name = ''): string {
  if (id === undefined || id === null || id === '') {
    return SYNTHETIC_PREFIX + (slugify(name) || 'unknown')
  }
  const raw = String(id)
  // ISO numeric 会被导出成 076 这样的补零形式，统一去零后比较
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? String(n) : raw
}

/**
 * 抽卡主图会把单个国家放大到满屏。
 * 110m 国界对面积小的国家只有十来个顶点（斯里兰卡 10 个、荷兰 14 个），
 * 放大后就是一个多边形色块；新加坡、马耳他、萨摩亚甚至完全没有轮廓。
 * 凡 110m 顶点数低于阈值（ROUGH_THRESHOLD）的收录国改由
 * `/data/detail-shapes.json` 描绘（目前 92 个，约 1MB gzip），由
 * `scripts/build-detail-shapes.mjs` 从 10m 数据按显示尺度简化生成。
 */

/**
 * 画不出轮廓、因而不能进答题池的国家。
 * 补丁上线后所有收录国家都能画出来，这里暂时为空；
 * 保留这个出口是为了以后新增收录国而补丁没跟上时不至于给玩家一块空图。
 */
export const NO_OUTLINE_IDS = new Set<string>()

/** 合成 id 不对应任何数据条目，不能作为可点击目标 */
export function isSyntheticId(id: string): boolean {
  return id.startsWith(SYNTHETIC_PREFIX)
}

let cache: Promise<WorldFeature[]> | null = null

const CHINA_ID = '156'
const TAIWAN_ID = '158'

function polygonsOf(geometry: Geometry | null | undefined): number[][][][] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates as number[][][]]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as number[][][][]
  return []
}

/**
 * world-atlas 把台湾拆成了独立要素（id 158）。
 * 中国版图必须完整，这里把它的几何并入中国要素，并移除独立要素，
 * 避免台湾在图上被渲染成"其他国家"。
 */
function mergeTaiwanIntoChina(features: WorldFeature[]): WorldFeature[] {
  const cn = features.find((f) => f.id === CHINA_ID)
  const tw = features.find((f) => f.id === TAIWAN_ID)
  if (cn && tw) {
    cn.geometry = {
      type: 'MultiPolygon',
      coordinates: [...polygonsOf(cn.geometry), ...polygonsOf(tw.geometry)],
    } as Geometry
  }
  return features.filter((f) => f.id !== TAIWAN_ID)
}

/** 只加载一次世界国界数据（TopoJSON），并展开成 GeoJSON feature 列表 */
export function loadWorld(): Promise<WorldFeature[]> {  if (cache) return cache
  cache = fetch('/data/countries-110m.json')
    .then((r) => {
      if (!r.ok) throw new Error(`地图数据加载失败：${r.status}`)
      return r.json() as Promise<Topology>
    })
    .then((topo) => {
      const firstKey = Object.keys(topo.objects)[0]
      const object = firstKey ? topo.objects[firstKey] : undefined
      if (!object) throw new Error('地图数据缺少 objects 字段')

      const fc = feature(topo, object)
      if (fc.type !== 'FeatureCollection') throw new Error('地图数据 objects 不是 GeometryCollection')

      return mergeTaiwanIntoChina(
        fc.features.map((f): WorldFeature => {
          const props = (f.properties ?? {}) as WorldProperties
          const name = typeof props.name === 'string' ? props.name : ''
          return {
            type: 'Feature' as const,
            id: normalizeId(f.id, name),
            name,
            geometry: f.geometry,
            properties: { ...props, name },
          }
        }),
      )
    })
    .catch((err: unknown) => {
      cache = null
      throw err
    })
  return cache
}

let detailCache: Promise<DetailPatch> | null = null

export interface DetailPatch {
  /** 国家 id → 本国精细轮廓 */
  self: Map<string, WorldFeature>
  /**
   * 国家 id → 该国视口范围内的邻国陆块。
   * 与本国轮廓由同一套 10m 弧段简化而来，边界天生贴合，
   * 用来替代和精细轮廓对不上的 110m 粗邻国（缝隙会漏出海色背景）。
   * 跨反子午线的国家没有补丁，运行时退回 110m。
   */
  contexts: Map<string, WorldFeature[]>
}

/**
 * 小国的精细轮廓补丁 + 周边邻国陆块（10m 数据源，按 1px 的显示精度做过简化）。
 * 只影响抽卡主图；全球视图仍用 110m，避免首屏多下几 MB。
 */
export function loadDetailShapes(): Promise<DetailPatch> {
  if (detailCache) return detailCache
  detailCache = fetch('/data/detail-shapes.json')
    .then((r) => {
      if (!r.ok) throw new Error(`精细轮廓加载失败：${r.status}`)
      return r.json() as Promise<{
        features: { id: string; geometry: Geometry }[]
        contexts?: Record<string, { id: string; geometry: Geometry }[]>
      }>
    })
    .then((fc) => {
      const toFeature = (f: { id: string; geometry: Geometry }): WorldFeature | null => {
        if (!f?.geometry) return null
        const id = normalizeId(f.id)
        return {
          type: 'Feature' as const,
          id,
          name: '',
          geometry: f.geometry,
          properties: {},
        }
      }
      const self = new Map<string, WorldFeature>()
      for (const f of fc.features ?? []) {
        const wf = toFeature(f)
        if (wf) self.set(wf.id, wf)
      }
      const contexts = new Map<string, WorldFeature[]>()
      for (const [id, list] of Object.entries(fc.contexts ?? {})) {
        const feats = (list ?? [])
          .map(toFeature)
          .filter((f): f is WorldFeature => !!f)
        if (feats.length) contexts.set(normalizeId(id), feats)
      }
      return { self, contexts }
    })
    .catch((err: unknown) => {
      // 补丁拿不到不该让整张地图挂掉，退回 110m 即可
      detailCache = null
      throw err
    })
  return detailCache
}
