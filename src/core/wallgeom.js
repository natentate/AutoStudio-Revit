// Wall footprints with cleaned-up joins (L-corners mitered, T-junctions trimmed
// to the through wall's face) and the solid pieces left after cutting openings.

import { add, sub, scale, norm, perp, dist, lineIntersect, closestOnSegment, dot } from './geometry.js';
import { getType, wallHeight, hostedElements, openingExtents } from './model.js';

const JOIN_TOL = 5; // mm

function wallFrame(doc, wall) {
  const type = getType(doc, 'wall', wall.typeId);
  const t = type ? type.thickness : 200;
  const d = norm(sub(wall.b, wall.a));
  return { t, d, n: perp(d), L: dist(wall.a, wall.b) };
}

/**
 * Compute the end condition at one end of a wall.
 * Returns {left, right, joined} in the wall's a→b frame (left = +n side),
 * or null for a plain butt end.
 */
function endCondition(doc, wall, frame, atEnd, others) {
  const E = atEnd ? wall.b : wall.a;
  const other = atEnd ? wall.a : wall.b;
  const dIn = norm(sub(E, other)); // travel direction arriving at E
  const nIn = perp(dIn);
  const half = frame.t / 2;
  const leftLineP = add(E, scale(nIn, half));
  const rightLineP = add(E, scale(nIn, -half));

  const atPoint = others.filter((o) => dist(o.a, E) < JOIN_TOL || dist(o.b, E) < JOIN_TOL);
  let leftIn = null;
  let rightIn = null;
  let joined = false;

  if (atPoint.length === 1) {
    // L-corner: miter with the single wall sharing this endpoint.
    const o = atPoint[0];
    const of = wallFrame(doc, o);
    const away = dist(o.a, E) < JOIN_TOL ? o.b : o.a;
    const dOut = norm(sub(away, E));
    const nOut = perp(dOut);
    const oHalf = of.t / 2;
    leftIn = lineIntersect(leftLineP, dIn, add(E, scale(nOut, oHalf)), dOut);
    rightIn = lineIntersect(rightLineP, dIn, add(E, scale(nOut, -oHalf)), dOut);
    if ((!leftIn || !rightIn) && dot(dIn, dOut) > 0.999) {
      // Straight continuation (e.g. a split wall): square end, but no seam line.
      leftIn = leftLineP;
      rightIn = rightLineP;
    }
    const limit = 4 * Math.max(frame.t, of.t);
    if (!leftIn || !rightIn || dist(leftIn, E) > limit || dist(rightIn, E) > limit) return null;
    joined = true;
  } else if (atPoint.length === 0) {
    // T-junction: this end touches the middle of another wall. Stop at its face.
    for (const o of others) {
      const c = closestOnSegment(E, o.a, o.b);
      if (c.d > JOIN_TOL || c.t < 0.001 || c.t > 0.999) continue;
      const of = wallFrame(doc, o);
      // Face of the through wall on the side this wall comes from.
      const side = Math.sign(dot(sub(other, c.p), of.n)) || 1;
      const faceP = add(c.p, scale(of.n, (side * of.t) / 2));
      leftIn = lineIntersect(leftLineP, dIn, faceP, of.d);
      rightIn = lineIntersect(rightLineP, dIn, faceP, of.d);
      if (!leftIn || !rightIn) return null;
      joined = true;
      break;
    }
    if (!joined) return null;
  } else {
    return null;
  }
  // Arriving at b, travel-left equals the wall's +n side. Arriving at a it is the -n side.
  return atEnd ? { left: leftIn, right: rightIn, joined } : { left: rightIn, right: leftIn, joined };
}

/**
 * Footprints for every wall on a level.
 * Map wallId → { poly: [startRight, endRight, endLeft, startLeft], startJoined, endJoined, frame }
 */
export function wallFootprints(doc, levelId) {
  const walls = doc.elements.filter((e) => e.category === 'wall' && e.levelId === levelId && dist(e.a, e.b) > 1);
  const out = new Map();
  for (const w of walls) {
    const frame = wallFrame(doc, w);
    const others = walls.filter((o) => o !== w);
    const half = frame.t / 2;
    const sc = endCondition(doc, w, frame, false, others);
    const ec = endCondition(doc, w, frame, true, others);
    const startLeft = sc ? sc.left : add(w.a, scale(frame.n, half));
    const startRight = sc ? sc.right : add(w.a, scale(frame.n, -half));
    const endLeft = ec ? ec.left : add(w.b, scale(frame.n, half));
    const endRight = ec ? ec.right : add(w.b, scale(frame.n, -half));
    out.set(w.id, {
      poly: [startRight, endRight, endLeft, startLeft],
      startJoined: !!sc,
      endJoined: !!ec,
      frame,
    });
  }
  return out;
}

/** Openings hosted by a wall, sorted along it. */
export function wallOpenings(doc, wall) {
  return hostedElements(doc, wall.id)
    .map((el) => ({ el, ...openingExtents(doc, el) }))
    .filter((o) => o.u1 > o.u0)
    .sort((a, b) => a.u0 - b.u0);
}

/**
 * Solid prisms that make up a wall after cutting its openings:
 * [{ poly: [{x,y}...], z0, z1 }] with z relative to the wall base.
 */
export function wallPieces(doc, wall, footprint) {
  const H = wallHeight(doc, wall);
  const { poly, frame } = footprint;
  const [sR, eR, eL, sL] = poly;
  const R = (u) => add(add(wall.a, scale(frame.d, u)), scale(frame.n, -frame.t / 2));
  const Lp = (u) => add(add(wall.a, scale(frame.d, u)), scale(frame.n, frame.t / 2));
  const openings = wallOpenings(doc, wall);
  if (!openings.length) return [{ poly, z0: 0, z1: H }];

  const pieces = [];
  let cur = null; // null = still at the (mitered) start
  const quad = (u0, u1) => [R(u0), R(u1), Lp(u1), Lp(u0)];
  for (const o of openings) {
    const start = cur === null ? 0 : cur;
    if (o.u0 > start + 0.5) {
      pieces.push({ poly: cur === null ? [sR, R(o.u0), Lp(o.u0), sL] : quad(cur, o.u0), z0: 0, z1: H });
    }
    const a = Math.max(o.u0, start);
    if (o.u1 > a) {
      const q = quad(a, o.u1);
      if (o.z0 > 0.5) pieces.push({ poly: q, z0: 0, z1: o.z0 });
      if (o.z1 < H - 0.5) pieces.push({ poly: q, z0: o.z1, z1: H });
    }
    cur = Math.max(start, o.u1);
  }
  if (cur < frame.L - 0.5) pieces.push({ poly: [R(cur), eR, eL, Lp(cur)], z0: 0, z1: H });
  return pieces;
}
