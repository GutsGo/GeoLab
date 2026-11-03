// 生成 public/data/china-provinces.json
// 来源：阿里 DataV GeoAtlas（areas_v3/bound/100000_full.json），含 34 省级行政区 + 九段线
// 用法：node scripts/build-china.mjs [/tmp/china_full.json]
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2] || '/tmp/china_full.json'
const gj = JSON.parse(readFileSync(src, 'utf8'))

const r4 = (n) => Math.round(n * 1e4) / 1e4
const round = (c) => (typeof c[0] === 'number' ? c.map(r4) : c.map(round))

/** 环的有符号面积：>0 逆时针（GeoJSON 外环规范），<0 顺时针 */
function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return a / 2
}

/**
 * d3 按球面绕向解释多边形：外环顺时针（planar 负面积）时内部才是多边形本体，
 * 逆时针会被渲染成「除该地以外的全世界」。DataV 源数据整体是顺时针外环，
 * 仅个别要素（如澳门）绕向相反，出现全画布矩形挡住整个地图的点击。
 */
function fixWinding(coordinates) {
  if (typeof coordinates[0][0][0] === 'number') {
    // Polygon
    return fixPolygonWinding(coordinates)
  }
  // MultiPolygon
  return coordinates.map(fixPolygonWinding)
}

function fixPolygonWinding(rings) {
  return rings.map((ring, i) => {
    const isExterior = i === 0
    const cw = ringArea(ring) < 0
    if (isExterior !== cw) ring = [...ring].reverse()
    return ring
  })
}

const features = gj.features.map((f) => ({
  type: 'Feature',
  properties: { name: f.properties.name, adcode: String(f.properties.adcode) },
  geometry: {
    type: f.geometry.type,
    coordinates: f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
      ? fixWinding(round(f.geometry.coordinates))
      : round(f.geometry.coordinates),
  },
}))

const out = { type: 'FeatureCollection', features }
writeFileSync('public/data/china-provinces.json', JSON.stringify(out))
const prov = features.filter((f) => f.properties.adcode !== '100000_JD')
console.log(`省级行政区 ${prov.length} 个 + 九段线 1 条，写入 public/data/china-provinces.json`)
