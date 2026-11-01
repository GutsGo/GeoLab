/**
 * geoPath 输出的是一整条复合路径（多个 M...Z 子路径拼在一起）。
 * 逐段描边动画需要把每个子路径单独拿出来，所以在这里按 M 切分。
 *
 * 注意：d3-geo 的命令只用大写 M / L / Z，坐标里不会出现字母，
 * 因此按 "M" 切分是安全的。
 */
export function splitSubpaths(d: string): string[] {
  if (!d) return []
  const out: string[] = []
  let start = 0
  for (let i = 1; i < d.length; i++) {
    if (d[i] === 'M') {
      out.push(d.slice(start, i))
      start = i
    }
  }
  out.push(d.slice(start))
  return out.map((s) => s.trim()).filter((s) => s.length > 3)
}

export interface TraceLayers {
  /** 逐段描边的主体（按面积代理值从大到小） */
  head: string[]
  /** 剩余零碎岛屿合并成一条，最后一起收尾 */
  tail: string
}

/** 把国家轮廓拆成「主陆 + 若干岛屿」，供逐段描绘动画使用 */
export function traceLayers(d: string, limit = 14): TraceLayers {
  const parts = splitSubpaths(d)
  if (!parts.length) return { head: [], tail: '' }
  // 路径字符串越长 ≈ 顶点越多 ≈ 面积越大，用它做排序代理，避免引入面积计算
  const sorted = [...parts].sort((a, b) => b.length - a.length)
  const head = sorted.slice(0, limit)
  const tail = sorted.slice(limit).join('')
  return { head, tail }
}
