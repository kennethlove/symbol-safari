export function pip(x, y, vs) {
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x, yi = vs[i].y, xj = vs[j].x, yj = vs[j].y
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

export function polyArea(vs) {
  let a = 0
  for (let i = 0; i < vs.length; i++) {
    const j = (i + 1) % vs.length
    a += vs[i].x * vs[j].y - vs[j].x * vs[i].y
  }
  return Math.abs(a) / 2
}

function edgeDist(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(ax + t * dx - cx, ay + t * dy - cy)
}

export function minEdgeDist(cx, cy, vs) {
  let md = Infinity
  for (let i = 0; i < vs.length; i++) {
    const j = (i + 1) % vs.length
    md = Math.min(md, edgeDist(vs[i].x, vs[i].y, vs[j].x, vs[j].y, cx, cy))
  }
  return md
}

function circumcenter(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-10) return null
  const ax = a.x * a.x + a.y * a.y, bx = b.x * b.x + b.y * b.y, cx = c.x * c.x + c.y * c.y
  return {
    x: (ax * (b.y - c.y) + bx * (c.y - a.y) + cx * (a.y - b.y)) / d,
    y: (ax * (c.x - b.x) + bx * (a.x - c.x) + cx * (b.x - a.x)) / d,
  }
}

function inCircle(a, b, c, p) {
  const cc = circumcenter(a, b, c)
  if (!cc) return false
  const r2 = (a.x - cc.x) ** 2 + (a.y - cc.y) ** 2
  return (p.x - cc.x) ** 2 + (p.y - cc.y) ** 2 < r2
}

function sharedEdge(t1, t2) {
  let s = 0
  if (t1.a === t2.a || t1.a === t2.b || t1.a === t2.c) s++
  if (t1.b === t2.a || t1.b === t2.b || t1.b === t2.c) s++
  if (t1.c === t2.a || t1.c === t2.b || t1.c === t2.c) s++
  return s === 2
}

function dedupEdges(edges) {
  const count = new Map()
  for (const e of edges) {
    const key = e[0] < e[1] ? `${e[0]},${e[1]}` : `${e[1]},${e[0]}`
    count.set(key, (count.get(key) || 0) + 1)
  }
  return edges.filter(e => {
    const key = e[0] < e[1] ? `${e[0]},${e[1]}` : `${e[1]},${e[0]}`
    return count.get(key) === 1
  })
}

export function delaunay(pts) {
  const n = pts.length
  if (n < 3) return []
  const idx = pts.map((_, i) => i)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const dx = maxX - minX || 1, dy = maxY - minY || 1
  const dmax = Math.max(dx, dy)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const si = [
    { x: cx - 20 * dmax, y: cy - dmax },
    { x: cx, y: cy + 20 * dmax },
    { x: cx + 20 * dmax, y: cy - dmax },
  ]
  const all = [...pts, ...si]
  const allIdx = idx.concat([n, n + 1, n + 2])
  const tris = [{ a: n, b: n + 1, c: n + 2 }]
  for (let i = 0; i < n; i++) {
    const bad = []
    for (let j = tris.length - 1; j >= 0; j--) {
      if (inCircle(all[tris[j].a], all[tris[j].b], all[tris[j].c], pts[i]))
        bad.push(tris.splice(j, 1)[0])
    }
    const edges = []
    for (const t of bad) {
      edges.push([t.a, t.b], [t.b, t.c], [t.c, t.a])
    }
    const boundary = dedupEdges(edges)
    for (const e of boundary) {
      tris.push({ a: e[0], b: e[1], c: i })
    }
  }
  return tris.filter(t => t.a < n && t.b < n && t.c < n)
}

function clipPoly(vertices, w, h) {
  if (vertices.length < 3) return null
  let out = vertices.slice()
  const clips = [
    { axis: 'x', dir: 1, limit: 0 },
    { axis: 'x', dir: -1, limit: w },
    { axis: 'y', dir: 1, limit: 0 },
    { axis: 'y', dir: -1, limit: h },
  ]
  for (const clip of clips) {
    if (out.length < 3) return null
    const next = []
    for (let i = 0; i < out.length; i++) {
      const cur = out[i], nxt = out[(i + 1) % out.length]
      const curIn = clip.axis === 'x' ? cur.x * clip.dir >= clip.limit * clip.dir : cur.y * clip.dir >= clip.limit * clip.dir
      const nxtIn = clip.axis === 'x' ? nxt.x * clip.dir >= clip.limit * clip.dir : nxt.y * clip.dir >= clip.limit * clip.dir
      if (curIn) next.push(cur)
      if (curIn !== nxtIn) {
        const t = clip.axis === 'x'
          ? (clip.limit - cur.x) / (nxt.x - cur.x)
          : (clip.limit - cur.y) / (nxt.y - cur.y)
        next.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) })
      }
    }
    out = next
  }
  return out.length >= 3 ? out : null
}

export function voronoi(tris, sites, w, h) {
  const adj = new Map()
  for (const t of tris) {
    for (const s of [t.a, t.b, t.c]) {
      if (s < sites.length) {
        if (!adj.has(s)) adj.set(s, [])
        adj.get(s).push(t)
      }
    }
  }
  const cells = []
  for (const [si, triList] of adj) {
    const verts = []
    for (const t of triList) {
      const cc = circumcenter(sites[t.a], sites[t.b], sites[t.c])
      if (cc) verts.push(cc)
    }
    if (verts.length < 3) continue
    const cx = sites[si].x, cy = sites[si].y
    verts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
    const clipped = clipPoly(verts, w, h)
    if (!clipped || clipped.length < 3) continue
    cells.push({ site: sites[si], vertices: clipped })
  }
  return cells
}

export function genV(w, h, count, rand) {
  const rng = rand || Math.random
  const sites = []
  for (let i = 0; i < count; i++) {
    sites.push({ x: rng() * w, y: rng() * h })
  }
  const m = Math.max(w, h), cx = w / 2, cy = h / 2
  const all = [...sites,
    { x: cx - m, y: cy - m }, { x: cx, y: cy - m }, { x: cx + m, y: cy - m },
    { x: cx - m, y: cy }, { x: cx + m, y: cy },
    { x: cx - m, y: cy + m }, { x: cx, y: cy + m }, { x: cx + m, y: cy + m },
  ]
  const tris = delaunay(all)
  return voronoi(tris, sites, w, h)
}
