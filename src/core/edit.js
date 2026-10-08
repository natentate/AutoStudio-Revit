// Editing operations shared by the modify tools. Each mutates the document in
// place and is meant to run inside Model.transact().

import { getElement, getType, wallLength, levelAbove, elementsOfCategory, nextGridName, nextMark, nextRoomNumber } from './model.js';
import { add, sub, dot, norm, dist, rotate, closestOnSegment, lineIntersect, scale } from './geometry.js';

const JOIN_TOL = 5;

/** Apply a point transform to an element's free geometry. Hosted elements are untouched. */
export function transformGeometry(el, fn) {
  if (el.a) el.a = fn(el.a);
  if (el.b) el.b = fn(el.b);
  if (el.at) el.at = fn(el.at);
  if (el.points) el.points = el.points.map(fn);
}

function clampOffset(doc, el) {
  const host = getElement(doc, el.hostId);
  const type = getType(doc, el.category, el.typeId);
  if (!host || !type) return;
  const L = wallLength(host);
  el.offset = Math.max(Math.min(type.width / 2, L / 2), Math.min(L - Math.min(type.width / 2, L / 2), el.offset));
}

/** Translate elements; walls joined to moved walls are stretched to stay connected. */
export function moveElements(doc, ids, delta, { stretchJoins = true } = {}) {
  const set = new Set(ids);
  const moved = doc.elements.filter((e) => set.has(e.id));
  const movedWalls = moved.filter((e) => e.category === 'wall');
  const T = (p) => add(p, delta);

  if (stretchJoins) {
    const ends = movedWalls.flatMap((w) => [{ p: w.a, levelId: w.levelId }, { p: w.b, levelId: w.levelId }]);
    for (const w of elementsOfCategory(doc, 'wall')) {
      if (set.has(w.id)) continue;
      for (const key of ['a', 'b']) {
        if (ends.some((e) => e.levelId === w.levelId && dist(e.p, w[key]) < JOIN_TOL)) w[key] = T(w[key]);
      }
    }
  }
  for (const el of moved) {
    if (el.hostId) {
      if (set.has(el.hostId)) continue;
      const host = getElement(doc, el.hostId);
      if (!host) continue;
      el.offset += dot(delta, norm(sub(host.b, host.a)));
      clampOffset(doc, el);
    } else transformGeometry(el, T);
  }
}

/** Duplicate elements through a point transform. Hosted children of copied walls come along. */
export function copyElements(doc, ids, fn, newId, { mirrored = false, delta = null } = {}) {
  const set = new Set(ids);
  const created = [];
  const idMap = new Map();
  const sources = doc.elements.filter((e) => set.has(e.id));
  const fresh = (el) => {
    const c = JSON.parse(JSON.stringify(el));
    c.id = newId();
    idMap.set(el.id, c.id);
    return c;
  };
  for (const el of sources) {
    if (el.hostId) continue;
    const c = fresh(el);
    transformGeometry(c, fn);
    if (c.category === 'grid') c.name = nextGridName(doc, Math.abs(c.b.x - c.a.x) < Math.abs(c.b.y - c.a.y));
    if (c.category === 'room') c.number = nextRoomNumber(doc, c.levelId);
    if (c.category === 'dimension' && mirrored) c.offset = -c.offset;
    doc.elements.push(c);
    created.push(c.id);
  }
  // Hosted elements: follow a copied host, or slide along the original host.
  const hosted = [
    ...doc.elements.filter((e) => e.hostId && set.has(e.hostId) && !set.has(e.id)),
    ...sources.filter((e) => e.hostId),
  ];
  for (const el of hosted) {
    const c = fresh(el);
    if (idMap.has(el.hostId)) c.hostId = idMap.get(el.hostId);
    else if (delta) {
      const host = getElement(doc, el.hostId);
      if (!host) continue;
      c.offset += dot(delta, norm(sub(host.b, host.a)));
      clampOffset(doc, c);
    } else continue;
    if (mirrored) c.flipHand = !c.flipHand;
    c.mark = nextMark(doc, c.category);
    doc.elements.push(c);
    created.push(c.id);
  }
  return created;
}

export function rotateElements(doc, ids, center, angleRad) {
  const set = new Set(ids);
  for (const el of doc.elements) {
    if (!set.has(el.id) || el.hostId) continue;
    transformGeometry(el, (p) => rotate(p, center, angleRad));
  }
}

/** Mirror point p across the line through a and b. */
export function mirrorPoint(p, a, b) {
  const d = norm(sub(b, a));
  const ap = sub(p, a);
  const proj = add(a, scale(d, dot(ap, d)));
  return sub(scale(proj, 2), p);
}

export function mirrorElements(doc, ids, a, b, { copy = true, newId } = {}) {
  const fn = (p) => mirrorPoint(p, a, b);
  if (copy) return copyElements(doc, ids, fn, newId, { mirrored: true });
  const set = new Set(ids);
  for (const el of doc.elements) {
    if (!set.has(el.id)) continue;
    if (el.hostId) {
      if (set.has(el.hostId)) el.flipHand = !el.flipHand;
      continue;
    }
    transformGeometry(el, fn);
    if (el.category === 'dimension') el.offset = -el.offset;
  }
  // Hosted elements of mirrored walls flip hand.
  for (const el of doc.elements) if (el.hostId && set.has(el.hostId) && !set.has(el.id)) el.flipHand = !el.flipHand;
  return [];
}

/** Split a wall at the point nearest p. Returns the new wall's id or null. */
export function splitWall(doc, wallId, p, newId) {
  const w = getElement(doc, wallId);
  if (!w) return null;
  const c = closestOnSegment(p, w.a, w.b);
  const L = wallLength(w);
  const u = c.t * L;
  if (u < 10 || L - u < 10) return null;
  const nw = { ...JSON.parse(JSON.stringify(w)), id: newId(), a: c.p, b: { ...w.b } };
  w.b = { ...c.p };
  doc.elements.push(nw);
  for (const el of doc.elements) {
    if (el.hostId !== w.id) continue;
    if (el.offset > u) {
      el.hostId = nw.id;
      el.offset -= u;
    }
  }
  return nw.id;
}

/** Trim/extend two walls so they meet at a corner. */
export function trimToCorner(doc, idA, idB) {
  const A = getElement(doc, idA);
  const B = getElement(doc, idB);
  if (!A || !B || A === B) throw new Error('Pick two different walls.');
  const ip = lineIntersect(A.a, sub(A.b, A.a), B.a, sub(B.b, B.a));
  if (!ip) throw new Error('The walls are parallel and cannot meet at a corner.');
  for (const w of [A, B]) {
    const key = dist(w.a, ip) < dist(w.b, ip) ? 'a' : 'b';
    const other = key === 'a' ? w.b : w.a;
    if (dist(other, ip) < 10) throw new Error('The corner would collapse one of the walls.');
    // Keep openings at the same absolute position when the start point moves.
    if (key === 'a') {
      const shift = dot(sub(ip, w.a), norm(sub(w.b, w.a)));
      for (const el of doc.elements) if (el.hostId === w.id) el.offset -= shift;
    }
    w[key] = ip;
  }
}

/** Change a wall's length by moving its end point (and any wall joined there). */
export function setWallLength(doc, wallId, length) {
  const w = getElement(doc, wallId);
  if (!w || !(length > 10)) throw new Error('Enter a length greater than 10 mm.');
  const d = norm(sub(w.b, w.a));
  const nb = add(w.a, scale(d, length));
  const delta = sub(nb, w.b);
  for (const o of elementsOfCategory(doc, 'wall')) {
    if (o === w || o.levelId !== w.levelId) continue;
    for (const key of ['a', 'b']) if (dist(o[key], w.b) < JOIN_TOL) o[key] = add(o[key], delta);
  }
  w.b = nb;
}

/** Move one wall endpoint (and endpoints joined to it). */
export function moveWallEnd(doc, wallId, key, p, { dragJoined = true } = {}) {
  const w = getElement(doc, wallId);
  const old = w[key];
  if (dragJoined) {
    for (const o of elementsOfCategory(doc, 'wall')) {
      if (o === w || o.levelId !== w.levelId) continue;
      for (const k of ['a', 'b']) if (dist(o[k], old) < JOIN_TOL) o[k] = { ...p };
    }
  }
  if (key === 'a') {
    const shift = dot(sub(p, w.a), norm(sub(w.b, w.a)));
    for (const el of doc.elements) if (el.hostId === w.id) el.offset -= shift;
  }
  w[key] = { ...p };
}

/** Default wall placement props for a level (height up to the level above when there is one). */
export function defaultWallProps(doc, levelId, typeId, heightMode) {
  const above = levelAbove(doc, levelId);
  if (heightMode === 'unconnected' || !above) return { topLevelId: null };
  return { topLevelId: heightMode && heightMode !== 'auto' ? heightMode : above.id };
}
