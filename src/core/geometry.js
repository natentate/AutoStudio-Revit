// 2D geometry helpers. Points are {x, y} in millimetres (plan coordinates, Y = north).

export const EPS = 1e-6;

export const pt = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a, b) => lerp(a, b, 0.5);

export function norm(a) {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular (rotate +90°). */
export const perp = (a) => ({ x: -a.y, y: a.x });

export function rotate(p, center, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

/** Intersection of infinite lines (p, p+r) and (q, q+s); null when parallel. */
export function lineIntersect(p, r, q, s) {
  const d = cross(r, s);
  if (Math.abs(d) < 1e-9) return null;
  const t = cross(sub(q, p), s) / d;
  return add(p, scale(r, t));
}

/** Intersection of segments ab and cd. Returns {p, t, u} or null. */
export function segmentIntersect(a, b, c, d, tol = 1e-9) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return { p: add(a, scale(r, t)), t, u };
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 < EPS ? 0 : dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  const q = add(a, scale(ab, t));
  return { p: q, t, d: dist(p, q) };
}

/** Signed area (positive = counter-clockwise). */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polygonPerimeter(pts) {
  let l = 0;
  for (let i = 0; i < pts.length; i++) l += dist(pts[i], pts[(i + 1) % pts.length]);
  return l;
}

export function polygonCentroid(pts) {
  const a = polygonArea(pts);
  if (Math.abs(a) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return scale(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function ensureCCW(pts) {
  return polygonArea(pts) < 0 ? [...pts].reverse() : pts;
}

/**
 * Offset a simple polygon outward by d (negative = inward), mitering corners.
 * Works for convex and typical rectilinear building outlines.
 */
export function offsetPolygon(pts, d) {
  const ccw = ensureCCW(pts);
  const n = ccw.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = ccw[(i - 1 + n) % n];
    const cur = ccw[i];
    const next = ccw[(i + 1) % n];
    const d1 = norm(sub(cur, prev));
    const d2 = norm(sub(next, cur));
    // For CCW polygons the outward normal is the right-hand perpendicular.
    const n1 = { x: d1.y, y: -d1.x };
    const n2 = { x: d2.y, y: -d2.x };
    const p1 = add(prev, scale(n1, d));
    const p2 = add(cur, scale(n2, d));
    const ip = lineIntersect(p1, d1, p2, d2);
    out.push(ip ?? add(cur, scale(n1, d)));
  }
  return out;
}

export function bbox(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Snap an angle (radians) to the nearest multiple of `step` when within `tol`. */
export function snapAngle(angle, step = Math.PI / 12, tol = (2 * Math.PI) / 180) {
  const k = Math.round(angle / step);
  return Math.abs(angle - k * step) < tol ? k * step : angle;
}

/** Remove consecutive duplicate and collinear vertices from a closed polygon. */
export function simplifyPolygon(pts, tol = 1) {
  let out = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > tol);
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      if (Math.abs(cross(sub(b, a), sub(c, b))) < tol * Math.max(dist(a, b), dist(b, c))) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}
