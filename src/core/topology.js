// Planar wall graph: finds enclosed regions (for rooms and floors) from wall
// centrelines, then offsets them to the wall faces.

import {
  sub, dist, segmentIntersect, closestOnSegment, polygonArea, pointInPolygon,
  lineIntersect, norm, add, scale, simplifyPolygon,
} from './geometry.js';
import { getType } from './model.js';

const TOL = 5; // mm

/**
 * Build a planar graph from segments [{a, b, t}] (t = wall thickness), splitting
 * at crossings and T-junctions. Returns { vertices, edges } where each vertex has
 * an angle-sorted adjacency list and each edge carries its thickness.
 */
export function buildGraph(segments) {
  const cuts = segments.map(() => [0, 1]);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const o = segments[j];
      const hit = segmentIntersect(s.a, s.b, o.a, o.b, 1e-6);
      if (hit) {
        cuts[i].push(hit.t);
        cuts[j].push(hit.u);
      }
    }
    // Endpoints of other segments lying on this one (T-junctions within tolerance).
    for (let j = 0; j < segments.length; j++) {
      if (j === i) continue;
      for (const p of [segments[j].a, segments[j].b]) {
        const c = closestOnSegment(p, s.a, s.b);
        if (c.d < TOL) cuts[i].push(c.t);
      }
    }
  }

  const vertices = [];
  const findVertex = (p) => {
    for (let i = 0; i < vertices.length; i++) if (dist(vertices[i], p) < TOL) return i;
    vertices.push({ x: p.x, y: p.y, adj: [] });
    return vertices.length - 1;
  };

  const edgeMap = new Map();
  segments.forEach((s, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(Math.min(1, Math.max(0, t)) * 1e6) / 1e6))].sort((a, b) => a - b);
    for (let k = 0; k < ts.length - 1; k++) {
      const p = { x: s.a.x + (s.b.x - s.a.x) * ts[k], y: s.a.y + (s.b.y - s.a.y) * ts[k] };
      const q = { x: s.a.x + (s.b.x - s.a.x) * ts[k + 1], y: s.a.y + (s.b.y - s.a.y) * ts[k + 1] };
      if (dist(p, q) < TOL) continue;
      const u = findVertex(p);
      const v = findVertex(q);
      if (u === v) continue;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      const prev = edgeMap.get(key);
      edgeMap.set(key, { u: Math.min(u, v), v: Math.max(u, v), t: Math.max(prev?.t ?? 0, s.t ?? 0) });
    }
  });

  // Iteratively prune dangling edges (stubs that cannot bound a region).
  let edges = [...edgeMap.values()];
  for (;;) {
    const deg = new Array(vertices.length).fill(0);
    for (const e of edges) {
      deg[e.u]++;
      deg[e.v]++;
    }
    const kept = edges.filter((e) => deg[e.u] > 1 && deg[e.v] > 1);
    if (kept.length === edges.length) break;
    edges = kept;
  }

  for (const v of vertices) v.adj = [];
  edges.forEach((e, idx) => {
    vertices[e.u].adj.push({ to: e.v, edge: idx });
    vertices[e.v].adj.push({ to: e.u, edge: idx });
  });
  for (const v of vertices) {
    v.adj.sort((p, q) => Math.atan2(vertices[p.to].y - v.y, vertices[p.to].x - v.x) - Math.atan2(vertices[q.to].y - v.y, vertices[q.to].x - v.x));
  }
  return { vertices, edges };
}

/**
 * Trace all faces of the planar graph. Bounded faces come out counter-clockwise
 * (positive area); each connected component's outer face is clockwise.
 * Returns [{ pts, thick: [per-edge thickness], area }].
 */
export function traceFaces(graph) {
  const { vertices, edges } = graph;
  const used = new Set();
  const faces = [];
  for (let ei = 0; ei < edges.length; ei++) {
    for (const [s, t] of [[edges[ei].u, edges[ei].v], [edges[ei].v, edges[ei].u]]) {
      if (used.has(`${s}>${t}`)) continue;
      const pts = [];
      const thick = [];
      let u = s;
      let v = t;
      let guard = 0;
      while (!used.has(`${u}>${v}`) && guard++ < 10000) {
        used.add(`${u}>${v}`);
        pts.push({ x: vertices[u].x, y: vertices[u].y });
        const adj = vertices[v].adj;
        const back = adj.findIndex((a) => a.to === u);
        thick.push(edges[adj[back].edge].t);
        // Next edge clockwise from the reverse edge: interior stays on the left.
        const next = adj[(back - 1 + adj.length) % adj.length];
        u = v;
        v = next.to;
      }
      if (pts.length >= 3) faces.push({ pts, thick, area: polygonArea(pts) });
    }
  }
  return faces;
}

/** Offset a CCW polygon with a distinct distance per edge (positive = outward). */
export function offsetPolygonPerEdge(pts, ds) {
  const n = pts.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = norm(sub(b, a));
    const outward = { x: d.y, y: -d.x };
    lines.push({ p: add(a, scale(outward, ds[i])), d });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    out.push(lineIntersect(prev.p, prev.d, cur.p, cur.d) ?? cur.p);
  }
  return out;
}

export function wallSegments(doc, levelId) {
  return doc.elements
    .filter((e) => e.category === 'wall' && e.levelId === levelId)
    .map((w) => ({ a: w.a, b: w.b, t: getType(doc, 'wall', w.typeId)?.thickness ?? 200 }));
}

/** All faces of the wall graph on a level (compute once, query many times). */
export function levelFaces(doc, levelId) {
  return traceFaces(buildGraph(wallSegments(doc, levelId)));
}

/** The smallest enclosed face containing p, offset to the wall faces. */
export function regionInFaces(faces, p) {
  const hits = faces.filter((f) => f.area > 1 && pointInPolygon(p, f.pts));
  if (!hits.length) return null;
  hits.sort((a, b) => a.area - b.area);
  const f = hits[0];
  const boundary = simplifyPolygon(offsetPolygonPerEdge(f.pts, f.thick.map((t) => -t / 2)));
  if (boundary.length < 3 || polygonArea(boundary) <= 0 || !pointInPolygon(p, boundary)) return null;
  return { boundary, centerline: f.pts };
}

/**
 * The enclosed region around point p on a level, bounded by wall faces.
 * Returns { boundary (CCW, at wall faces), centerline } or null when p is not enclosed.
 */
export function regionAt(doc, levelId, p) {
  return regionInFaces(levelFaces(doc, levelId), p);
}

/**
 * The outer outline of the largest enclosed group of walls on a level, at the
 * exterior wall faces (CCW). Null when the walls do not enclose anything.
 */
export function buildingOutline(doc, levelId) {
  const graph = buildGraph(wallSegments(doc, levelId));
  const outer = traceFaces(graph).filter((f) => f.area < -1);
  if (!outer.length) return null;
  outer.sort((a, b) => a.area - b.area); // most negative = largest
  const f = outer[0];
  const pts = [...f.pts].reverse();
  // Reversing the loop reverses edge order: edge i of the CCW loop is edge (n-2-i) of the CW loop.
  const n = f.pts.length;
  const thick = pts.map((_, i) => f.thick[(n - 2 - i + n) % n]);
  return simplifyPolygon(offsetPolygonPerEdge(pts, thick.map((t) => t / 2)));
}
