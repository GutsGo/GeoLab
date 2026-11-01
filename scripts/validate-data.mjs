/**
 * 数据契约校验。零依赖，直接 node 跑（Node 22 的 --experimental-strip-types 能直读 .ts）。
 *
 *   pnpm data:validate
 *
 * 校验三类东西：
 *   1) 字段完整性与取值区间
 *   2) 与 world-atlas（public/data/countries-110m.json）的 id 对齐
 *   3) 跨条目唯一性（id / code / name）
 *
 * 设计口径：
 *   - id 缺失轮廓只算警告，不算错误：微型国家本来就不在 110m 数据里，
 *     前端有 microPoint + 上下文地图兜底。只有"既没轮廓又没城市坐标"才算错误。
 *   - ethnic 的 pct 允许总和超过 100：新西兰这类普查是多选族群，官方口径本身就重叠。
 *     上限放到 120 用来兜住笔误（比如 67 写成 670）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CONTINENTS = ['亚洲', '欧洲', '非洲', '北美洲', '南美洲', '大洋洲']

/** 每个数据文件允许出现的大洲；america.ts 同时装南北美 */
const BUCKETS = [
  { file: 'asia', key: 'asia', allowed: ['亚洲'] },
  { file: 'europe', key: 'europe', allowed: ['欧洲'] },
  { file: 'africa', key: 'africa', allowed: ['非洲'] },
  { file: 'america', key: 'america', allowed: ['北美洲', '南美洲'] },
  { file: 'oceania', key: 'oceania', allowed: ['大洋洲'] },
]

const errors = []
const warnings = []

function err(msg) {
  errors.push(msg)
}
function warn(msg) {
  warnings.push(msg)
}

/** ISO 3166-1 alpha-2 → 区域指示符 emoji */
function flagEmoji(code) {
  if (!/^[a-z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 97))
}

// ---------- 载入数据 ----------
const rows = []
for (const { file, key, allowed } of BUCKETS) {
  const mod = await import(resolve(root, `app/data/${file}.ts`))
  const list = mod[key]
  if (!Array.isArray(list) || !list.length) {
    err(`app/data/${file}.ts 没有导出 ${key} 数组`)
    continue
  }
  for (const c of list) rows.push({ ...c, __file: file, __allowed: allowed })
}

if (!rows.length) {
  console.error('没有读到任何国家数据')
  process.exit(1)
}

// ---------- 逐条字段校验 ----------
const TEXT_FIELDS = [
  'name',
  'nameEn',
  'capital',
  'subregion',
  'tagline',
  'population',
  'area',
  'language',
  'currency',
  'intro',
  'history',
  'culture',
  'funFact',
]

for (const c of rows) {
  const where = `${c.__file}.ts · ${c.name || '(无 name)'}`

  if (!/^\d{1,3}$/.test(String(c.id ?? ''))) err(`${where}: id 必须是 ISO 3166-1 numeric，实际是 ${JSON.stringify(c.id)}`)
  if (!/^[a-z]{2}$/.test(String(c.code ?? ''))) err(`${where}: code 必须是两位小写 alpha-2，实际是 ${JSON.stringify(c.code)}`)

  for (const f of TEXT_FIELDS) {
    const v = c[f]
    if (typeof v !== 'string' || !v.trim()) err(`${where}: 字段 ${f} 为空`)
  }

  if (!CONTINENTS.includes(c.continent)) {
    err(`${where}: continent 非法值 ${JSON.stringify(c.continent)}`)
  } else if (!c.__allowed.includes(c.continent)) {
    err(`${where}: 放在 ${c.__file}.ts 里但 continent 是 ${c.continent}（允许：${c.__allowed.join('/')}）`)
  }

  const expectFlag = flagEmoji(c.code)
  if (expectFlag && c.flag !== expectFlag) {
    err(`${where}: flag ${c.flag} 与 code ${c.code} 不匹配，应为 ${expectFlag}`)
  }

  // 城市
  if (!Array.isArray(c.cities) || !c.cities.length) {
    err(`${where}: cities 不能为空（至少有首都坐标兜底）`)
  } else {
    const caps = c.cities.filter((x) => x.capital)
    if (caps.length !== 1) err(`${where}: 必须恰好一个 capital，实际 ${caps.length} 个`)
    for (const city of c.cities) {
      if (typeof city.name !== 'string' || !city.name.trim()) err(`${where}: 有城市缺 name`)
      if (!Number.isFinite(city.lat) || city.lat < -90 || city.lat > 90) {
        err(`${where}: 城市 ${city.name} 的 lat 越界（${city.lat}）`)
      }
      if (!Number.isFinite(city.lng) || city.lng < -180 || city.lng > 180) {
        err(`${where}: 城市 ${city.name} 的 lng 越界（${city.lng}）`)
      }
    }
  }

  // 族群占比
  if (!Array.isArray(c.ethnic) || !c.ethnic.length) {
    err(`${where}: ethnic 不能为空`)
  } else {
    let sum = 0
    for (const e of c.ethnic) {
      if (!Number.isFinite(e.pct) || e.pct <= 0 || e.pct > 100) {
        err(`${where}: 族群 ${e.name} 的 pct 非法（${e.pct}）`)
      }
      sum += e.pct
    }
    if (sum > 120) err(`${where}: 族群占比合计 ${sum.toFixed(1)}% 明显异常`)
  }

  // 列表类
  for (const [field, min] of [
    ['landmarks', 2],
    ['foods', 2],
  ]) {
    const list = c[field]
    if (!Array.isArray(list) || list.length < min) {
      err(`${where}: ${field} 至少 ${min} 条，实际 ${Array.isArray(list) ? list.length : 0}`)
    } else {
      for (const item of list) {
        if (!item?.name?.trim() || !item?.desc?.trim()) err(`${where}: ${field} 里有条目缺 name/desc`)
      }
    }
  }
}

// ---------- 唯一性 ----------
for (const key of ['id', 'code', 'name']) {
  const seen = new Map()
  for (const c of rows) {
    const v = String(c[key])
    if (seen.has(v)) err(`重复的 ${key}：${v}（${seen.get(v)} 与 ${c.name}）`)
    else seen.set(v, c.name)
  }
}

// ---------- 与底图 id 对齐 ----------
let topoIds = null
try {
  const topo = JSON.parse(readFileSync(resolve(root, 'public/data/countries-110m.json'), 'utf8'))
  const objectKey = Object.keys(topo.objects ?? {})[0]
  const geoms = objectKey ? topo.objects[objectKey].geometries : []
  topoIds = new Set(geoms.map((g) => String(Number.parseInt(String(g.id), 10))))
} catch (e) {
  err(`读不到 public/data/countries-110m.json：${e.message}`)
}

if (topoIds) {
  for (const c of rows) {
    if (!topoIds.has(String(c.id))) {
      const hasFallback = Array.isArray(c.cities) && c.cities.length > 0
      const msg = `${c.name} (${c.id}) 在 110m 底图里没有轮廓`
      if (hasFallback) warn(`${msg}，依赖 microPoint / 上下文地图兜底`)
      else err(`${msg}，且没有城市坐标，无法渲染`)
    }
  }
}

// ---------- 汇总 ----------
const icon = (n, ch) => (n ? ch : ' ')
console.log(`共校验 ${rows.length} 条国家数据`)

if (warnings.length) {
  console.log(`\n${icon(warnings.length, '⚠')} 警告 ${warnings.length} 条`)
  for (const w of warnings) console.log(`   - ${w}`)
}

if (errors.length) {
  console.log(`\n✖ 错误 ${errors.length} 条`)
  for (const e of errors) console.log(`   - ${e}`)
  console.log('')
  process.exitCode = 1
} else {
  console.log(`\n✔ 全部通过${warnings.length ? `（有 ${warnings.length} 条警告）` : ''}`)
}
