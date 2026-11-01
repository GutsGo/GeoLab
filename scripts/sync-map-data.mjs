/**
 * 把 world-atlas 包里的底图同步到 public/data/。
 *
 *   pnpm data:sync
 *
 * 之前 public/data/countries-110m.json 是手工抄进去的副本，依赖装了却没被引用，
 * 版本一升两边就会悄悄漂移。这里让依赖成为唯一来源。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'package.json'))

const FILE = 'countries-110m.json'
const dest = resolve(root, 'public/data', FILE)

let src
try {
  src = require.resolve(`world-atlas/${FILE}`)
} catch {
  console.error(`找不到 world-atlas/${FILE}，先跑 pnpm install`)
  process.exit(1)
}

const hash = (buf) => createHash('sha1').update(buf).digest('hex')
const source = readFileSync(src)

if (existsSync(dest) && hash(readFileSync(dest)) === hash(source)) {
  console.log(`已是最新：public/data/${FILE}`)
} else {
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  console.log(`已同步：world-atlas → public/data/${FILE}（${source.length} 字节）`)
}
