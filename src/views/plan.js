// 2D floor plan view: drawing, navigation, hit testing and snapping.

import {
  add, sub, scale, norm, perp, dist, mid, closestOnSegment, segmentIntersect, pointInPolygon,
  polygonArea, bbox, lineIntersect, snapAngle,
} from '../core/geometry.js';
import { getType, getLevel, getElement, levelBelow, levelAbove, openingExtents, wallLength } from '../core/model.js';
import { wallFootprints } from '../core/wallgeom.js';
import { levelFaces, regionInFaces } from '../core/topology.js';
import { formatLength, formatArea } from '../core/units.js';
import { pitchedRoofFaces } from '../core/roofgeom.js';

const COLORS = {
  wallFill: '#a3a9b0',
  wallLine: '#1d2228',
  underlay: '#c9ced4',
  floorFill: '#f3f2ee',
  floorLine: '#b9b6ad',
  roomFill: 'rgba(124, 170, 230, 0.07)',
  grid: '#4f6275',
  dim: '#1d2228',
  select: '#1a73e8',
  hover: '#5aa0ff',
  snap: '#e8710a',
  guide: 'rgba(232, 113, 10, 0.55)',
  preview: '#1a73e8',
  roof: '#8a6a5a',
  text: '#1d2228',
};

const SNAP_PX = 10;

export class PlanView {
  constructor(app, levelId) {
    this.app = app;
    this.levelId = levelId;
    this.kind = 'plan';
    this.scale = 0.05; // px per mm
    this.ox = 0;
    this.oy = 0;
    this.fitted = false;
    this.cache = null;
    this.snapIndicator = null;
    this.hoverId = null;
    this.cursor = null;
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.ctx = this.canvas.getContext('2d');
    this.pending = false;
    this.labelHits = [];
    this.bind();
  }

  get model() {
    return this.app.model;
  }

  get doc() {
    return this.app.model.doc;
  }

  title() {
    return `Floor Plan: ${getLevel(this.doc, this.levelId)?.name ?? '?'}`;
  }

  key() {
    return `plan:${this.levelId}`;
  }

  mount(host) {
    host.append(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.host = host;
    this.resize();
    if (!this.fitted) {
      this.zoomToFit();
      this.fitted = true;
    }
    this.invalidate();
  }

  unmount() {
    this.resizeObserver?.disconnect();
    this.canvas.remove();
  }

  resize() {
    if (!this.host) return;
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const oldW = this.width || r.width;
    const oldH = this.height || r.height;
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    // Keep the view centre stable while resizing.
    this.ox += (r.width - oldW) / 2;
    this.oy += (r.height - oldH) / 2;
    this.invalidate(true);
  }

  // ---- transforms --------------------------------------------------------

  toScreen(p) {
    return { x: this.ox + p.x * this.scale, y: this.oy - p.y * this.scale };
  }

  toModel(sx, sy) {
    return { x: (sx - this.ox) / this.scale, y: (this.oy - sy) / this.scale };
  }

  px(n) {
    return n / this.scale;
  }

  zoomAt(sx, sy, factor) {
    const before = this.toModel(sx, sy);
    this.scale = Math.max(0.002, Math.min(5, this.scale * factor));
    this.ox = sx - before.x * this.scale;
    this.oy = sy + before.y * this.scale;
    this.invalidate(true);
    this.app.updateViewBar();
  }

  zoomToFit() {
    const pts = [];
    for (const el of this.doc.elements) {
      if (el.levelId && el.levelId !== this.levelId && el.category !== 'roof') continue;
      if (el.a) pts.push(el.a, el.b);
      if (el.points) pts.push(...el.points);
      if (el.at) pts.push(el.at);
    }
    const w = this.width || 800;
    const h = this.height || 600;
    if (!pts.length) {
      this.scale = 0.05;
      this.ox = w / 2;
      this.oy = h / 2;
    } else {
      const b = bbox(pts);
      const bw = Math.max(1000, b.maxX - b.minX);
      const bh = Math.max(1000, b.maxY - b.minY);
      this.scale = Math.min((w - 80) / bw, (h - 80) / bh);
      this.ox = w / 2 - ((b.minX + b.maxX) / 2) * this.scale;
      this.oy = h / 2 + ((b.minY + b.maxY) / 2) * this.scale;
    }
    this.invalidate(true);
    this.app.updateViewBar();
  }

  /** Drawing scale as "1 : N" assuming 96 dpi. */
  scaleRatio() {
    return Math.max(1, Math.round(3.7795 / this.scale));
  }

  // ---- derived data ------------------------------------------------------

  derived() {
    const rev = this.model.rev;
    if (this.cache && this.cache.rev === rev && this.cache.levelId === this.levelId && this.cache.doc === this.doc) return this.cache;
    const doc = this.doc;
    const footprints = wallFootprints(doc, this.levelId);
    const faces = levelFaces(doc, this.levelId);
    const rooms = new Map();
    for (const r of doc.elements) {
      if (r.category === 'room' && r.levelId === this.levelId) rooms.set(r.id, regionInFaces(faces, r.at));
    }
    const below = levelBelow(doc, this.levelId);
    this.cache = {
      rev, levelId: this.levelId, doc, footprints, faces, rooms,
      underlay: below ? wallFootprints(doc, below.id) : new Map(),
    };
    return this.cache;
  }

  visible(category) {
    const hidden = this.doc.viewSettings[this.key()]?.hidden || [];
    return !hidden.includes(category);
  }

  /** Elements drawn in this view. */
  viewElements() {
    const above = levelAbove(this.doc, this.levelId);
    return this.doc.elements.filter((e) => {
      if (!this.visible(e.category)) return false;
      if (e.category === 'grid') return true;
      if (e.hostId) {
        const host = getElement(this.doc, e.hostId);
        return host && host.levelId === this.levelId && this.visible('wall');
      }
      if (e.category === 'roof') return e.levelId === this.levelId || (above && e.levelId === above.id);
      return e.levelId === this.levelId;
    });
  }

  openingPoly(el) {
    const host = getElement(this.doc, el.hostId);
    const fp = this.derived().footprints.get(el.hostId);
    const ex = openingExtents(this.doc, el);
    if (!host || !fp || !ex) return null;
    const { d, n, t } = fp.frame;
    const at = (u, s) => add(add(host.a, scale(d, u)), scale(n, (s * t) / 2));
    return { poly: [at(ex.u0, -1), at(ex.u1, -1), at(ex.u1, 1), at(ex.u0, 1)], host, ex, frame: fp.frame };
  }

  elementOutline(el) {
    const dv = this.derived();
    switch (el.category) {
      case 'wall':
        return dv.footprints.get(el.id)?.poly ?? [el.a, el.b];
      case 'door':
      case 'window':
        return this.openingPoly(el)?.poly ?? null;
      case 'floor':
      case 'roof':
        return el.points;
      case 'room': {
        const r = dv.rooms.get(el.id);
        return r ? r.boundary : [el.at];
      }
      case 'grid':
        return [el.a, el.b];
      case 'dimension': {
        const n = perp(norm(sub(el.b, el.a)));
        return [el.a, el.b, add(el.b, scale(n, el.offset)), add(el.a, scale(n, el.offset))];
      }
      case 'text': {
        const w = (el.text || '').length * (el.size || 250) * 0.6;
        return [el.at, add(el.at, { x: w, y: 0 }), add(el.at, { x: w, y: el.size || 250 }), add(el.at, { x: 0, y: el.size || 250 })];
      }
      default:
        return null;
    }
  }

  // ---- hit testing --------------------------------------------------------

  hitTest(p, tolPx = 6) {
    const tol = this.px(tolPx);
    const els = this.viewElements();
    const dv = this.derived();
    const best = (cands) => cands.sort((a, b) => a.d - b.d)[0]?.el ?? null;
    const near = (el, d) => (d <= tol ? { el, d } : null);
    const segD = (a, b) => closestOnSegment(p, a, b).d;
    const polyEdgeD = (pts) => Math.min(...pts.map((q, i) => segD(q, pts[(i + 1) % pts.length])));

    // Openings first so doors/windows can be picked inside walls.
    const tiers = [
      els.filter((e) => e.hostId).map((e) => {
        const o = this.openingPoly(e);
        return o && (pointInPolygon(p, o.poly) ? { el: e, d: 0 } : near(e, polyEdgeD(o.poly)));
      }),
      els.filter((e) => e.category === 'dimension' || e.category === 'text').map((e) => {
        const o = this.elementOutline(e);
        if (e.category === 'text') return pointInPolygon(p, o) ? { el: e, d: 0 } : null;
        return near(e, segD(o[3], o[2]));
      }),
      els.filter((e) => e.category === 'wall').map((e) => {
        const fp = dv.footprints.get(e.id);
        if (fp && pointInPolygon(p, fp.poly)) return { el: e, d: 0 };
        return near(e, fp ? polyEdgeD(fp.poly) : segD(e.a, e.b));
      }),
      els.filter((e) => e.category === 'grid').map((e) => {
        const r = this.px(12);
        const bubble = Math.min(dist(p, this.gridBubble(e, 'a')), dist(p, this.gridBubble(e, 'b')));
        return bubble <= r ? { el: e, d: 0 } : near(e, segD(e.a, e.b));
      }),
      els.filter((e) => e.category === 'room').map((e) => {
        if (dist(p, e.at) < this.px(30)) return { el: e, d: 0 };
        const r = dv.rooms.get(e.id);
        return r && pointInPolygon(p, r.boundary) ? { el: e, d: Math.abs(polygonArea(r.boundary)) } : null;
      }),
      els.filter((e) => e.category === 'roof').map((e) => near(e, polyEdgeD(e.points))),
      els.filter((e) => e.category === 'floor').map((e) => (pointInPolygon(p, e.points) ? { el: e, d: Math.abs(polygonArea(e.points)) } : near(e, polyEdgeD(e.points)))),
    ];
    for (const tier of tiers) {
      const hit = best(tier.filter(Boolean));
      if (hit) return hit;
    }
    return null;
  }

  /** Elements inside (window) or touching (crossing) a model-space rectangle. */
  elementsInRect(r, crossing) {
    const out = [];
    for (const el of this.viewElements()) {
      const o = this.elementOutline(el);
      if (!o) continue;
      const b = bbox(o);
      const inside = b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY;
      const touches = b.maxX >= r.minX && b.minX <= r.maxX && b.maxY >= r.minY && b.minY <= r.maxY;
      if (inside || (crossing && touches)) out.push(el.id);
    }
    return out;
  }

  gridBubble(g, end) {
    const d = norm(sub(g.b, g.a));
    const r = this.px(12);
    return end === 'a' ? sub(g.a, scale(d, r)) : add(g.b, scale(d, r));
  }

  // ---- snapping ------------------------------------------------------------

  snapCandidates(extra = []) {
    const pts = [];
    const lines = [];
    for (const el of this.viewElements()) {
      if (el.category === 'wall') {
        pts.push({ p: el.a, kind: 'endpoint' }, { p: el.b, kind: 'endpoint' }, { p: mid(el.a, el.b), kind: 'midpoint' });
        lines.push({ a: el.a, b: el.b, el });
        const fp = this.derived().footprints.get(el.id);
        if (fp) for (const q of fp.poly) pts.push({ p: q, kind: 'endpoint' });
      } else if (el.category === 'grid') {
        pts.push({ p: el.a, kind: 'endpoint' }, { p: el.b, kind: 'endpoint' });
        lines.push({ a: el.a, b: el.b, el });
      } else if (el.points && el.levelId === this.levelId) {
        for (const q of el.points) pts.push({ p: q, kind: 'endpoint' });
      } else if (el.category === 'dimension') {
        pts.push({ p: el.a, kind: 'endpoint' }, { p: el.b, kind: 'endpoint' });
      }
    }
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const hit = segmentIntersect(lines[i].a, lines[i].b, lines[j].a, lines[j].b);
        if (hit) pts.push({ p: hit.p, kind: 'intersection' });
      }
    }
    for (const q of extra) pts.push({ p: q, kind: 'endpoint' });
    return { pts, lines };
  }

  /**
   * Snap a model point. opts: { from, ortho, extra, exclude:Set, noSnap, nearest }.
   * Returns { p, kind, guides }.
   */
  snap(p, opts = {}) {
    const tol = this.px(SNAP_PX);
    let result = { p, kind: null, guides: [] };
    if (opts.noSnap) {
      this.snapIndicator = null;
      return result;
    }
    if (!this._snapCache || this._snapCache.rev !== this.model.rev || this._snapCache.extra !== opts.extra) {
      this._snapCache = { rev: this.model.rev, extra: opts.extra, ...this.snapCandidates(opts.extra || []) };
    }
    const { pts, lines } = this._snapCache;

    // 1. Point snaps.
    let bestPt = null;
    for (const c of pts) {
      const d = dist(c.p, p);
      const bias = c.kind === 'midpoint' ? 0.6 : 1; // prefer endpoints/intersections
      if (d <= tol * bias && (!bestPt || d < bestPt.d)) bestPt = { ...c, d };
    }
    if (bestPt && !opts.ortho) {
      result = { p: { ...bestPt.p }, kind: bestPt.kind, guides: [] };
      this.snapIndicator = result;
      return result;
    }

    // 2. Angle snap from a reference point, combined with alignment to existing points.
    let q = { ...p };
    let ray = null;
    if (opts.from) {
      const v = sub(p, opts.from);
      const L = Math.hypot(v.x, v.y);
      if (L > 1) {
        const ang = Math.atan2(v.y, v.x);
        const snapped = opts.ortho ? Math.round(ang / (Math.PI / 2)) * (Math.PI / 2) : snapAngle(ang, Math.PI / 12, (3 * Math.PI) / 180);
        if (snapped !== ang || opts.ortho) {
          ray = { x: Math.cos(snapped), y: Math.sin(snapped) };
          q = add(opts.from, scale(ray, L * Math.cos(ang - snapped)));
          result.kind = 'angle';
        }
      }
    }
    // Alignment with existing points (dashed guides).
    let alignX = null;
    let alignY = null;
    for (const c of pts) {
      if (Math.abs(c.p.x - q.x) < tol && (!alignX || Math.abs(c.p.x - q.x) < Math.abs(alignX.x - q.x))) alignX = c.p;
      if (Math.abs(c.p.y - q.y) < tol && (!alignY || Math.abs(c.p.y - q.y) < Math.abs(alignY.y - q.y))) alignY = c.p;
    }
    if (ray) {
      // Constrain the ray by an alignment line that crosses it.
      let best = null;
      if (alignX && Math.abs(ray.x) > 1e-3) {
        const ip = lineIntersect(opts.from, ray, { x: alignX.x, y: 0 }, { x: 0, y: 1 });
        if (ip && dist(ip, q) < tol) best = { ip, g: alignX };
      }
      if (!best && alignY && Math.abs(ray.y) > 1e-3) {
        const ip = lineIntersect(opts.from, ray, { x: 0, y: alignY.y }, { x: 1, y: 0 });
        if (ip && dist(ip, q) < tol) best = { ip, g: alignY };
      }
      if (best) {
        q = best.ip;
        result.guides.push([best.g, q]);
        result.kind = 'align';
      } else {
        // Round the length to a tidy increment.
        const L = dist(opts.from, q);
        const inc = this.doc.info.units === 'imperial' ? 25.4 / 2 : 10;
        q = add(opts.from, scale(ray, Math.round(L / inc) * inc));
      }
    } else {
      if (alignX) {
        q.x = alignX.x;
        result.guides.push([alignX, q]);
        result.kind = 'align';
      }
      if (alignY) {
        q.y = alignY.y;
        result.guides.push([alignY, q]);
        result.kind = 'align';
      }
    }
    // 3. Nearest point on a line.
    if (!result.kind && opts.nearest !== false) {
      let bestL = null;
      for (const l of lines) {
        const c = closestOnSegment(p, l.a, l.b);
        if (c.d <= tol && (!bestL || c.d < bestL.d)) bestL = c;
      }
      if (bestL) {
        q = bestL.p;
        result.kind = 'nearest';
      }
    }
    result.p = q;
    this.snapIndicator = result.kind ? result : null;
    return result;
  }

  // ---- rendering -------------------------------------------------------------

  invalidate(now = false) {
    if (now) {
      this.render();
      return;
    }
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    const { ctx } = this;
    if (!this.width) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, this.height);
    const dv = this.derived();
    const els = this.viewElements();
    const sel = this.app.selection;
    const by = (cat) => els.filter((e) => e.category === cat);
    this.labelHits = [];

    // Underlay: walls of the level below.
    if (this.doc.viewSettings[this.key()]?.underlay !== false) {
      ctx.strokeStyle = COLORS.underlay;
      ctx.lineWidth = 1;
      for (const fp of dv.underlay.values()) this.pathPoly(fp.poly), ctx.stroke();
    }

    for (const f of by('floor')) {
      this.pathPoly(f.points);
      ctx.fillStyle = COLORS.floorFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.floorLine;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const r of by('room')) {
      const region = dv.rooms.get(r.id);
      if (region) {
        this.pathPoly(region.boundary);
        ctx.fillStyle = COLORS.roomFill;
        ctx.fill();
      }
    }

    for (const g of by('grid')) this.drawGrid(g);

    // Walls: fill, then outline edges (skipping joined ends so corners read clean).
    const walls = by('wall');
    ctx.fillStyle = COLORS.wallFill;
    for (const w of walls) {
      const fp = dv.footprints.get(w.id);
      if (fp) this.pathPoly(fp.poly), ctx.fill();
    }
    ctx.strokeStyle = COLORS.wallLine;
    ctx.lineWidth = 1.4;
    for (const w of walls) {
      const fp = dv.footprints.get(w.id);
      if (!fp) continue;
      const [sR, eR, eL, sL] = fp.poly;
      this.line(sR, eR);
      this.line(sL, eL);
      if (!fp.startJoined) this.line(sR, sL);
      if (!fp.endJoined) this.line(eR, eL);
    }

    for (const el of els.filter((e) => e.hostId)) this.drawOpening(el);
    for (const r of by('roof')) this.drawRoof(r, r.levelId !== this.levelId);
    for (const r of by('room')) this.drawRoomTag(r, dv.rooms.get(r.id));
    for (const d of by('dimension')) this.drawDimension(d, COLORS.dim);
    for (const t of by('text')) this.drawText(t, COLORS.text);

    // Hover and selection highlights.
    if (this.hoverId && !sel.has(this.hoverId)) {
      const el = getElement(this.doc, this.hoverId);
      if (el) this.highlight(el, COLORS.hover, 1.5);
    }
    for (const id of sel) {
      const el = getElement(this.doc, id);
      if (el && els.includes(el)) this.highlight(el, COLORS.select, 2.2);
    }
    this.drawSelectionDecorations();

    this.app.tool?.drawOverlay?.(ctx, this);
    this.drawSnap();
  }

  pathPoly(pts) {
    const { ctx } = this;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  line(a, b) {
    const { ctx } = this;
    const sa = this.toScreen(a);
    const sb = this.toScreen(b);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  }

  label(text, p, { color = '#1d2228', size = 11, bold = false, align = 'center', baseline = 'middle', angle = 0, bg = null } = {}) {
    const { ctx } = this;
    const s = this.toScreen(p);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    ctx.font = `${bold ? '600 ' : ''}${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    const w = ctx.measureText(text).width;
    if (bg) {
      ctx.fillStyle = bg;
      const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
      ctx.fillRect(x0 - 3, -size / 2 - 3, w + 6, size + 6);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return { x: s.x, y: s.y, w, h: size };
  }

  /** Text angle that keeps labels reading left-to-right / bottom-to-top. */
  readableAngle(a, b) {
    let ang = -Math.atan2(b.y - a.y, b.x - a.x);
    if (ang > Math.PI / 2 + 1e-6) ang -= Math.PI;
    if (ang <= -Math.PI / 2 + 1e-6) ang += Math.PI;
    return ang;
  }

  drawGrid(g) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([18, 4, 3, 4]);
    this.line(g.a, g.b);
    ctx.setLineDash([]);
    for (const end of ['a', 'b']) {
      const c = this.toScreen(this.gridBubble(g, end));
      ctx.beginPath();
      ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.grid;
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.name, c.x, c.y + 0.5);
    }
    ctx.restore();
  }

  drawOpening(el) {
    const o = this.openingPoly(el);
    if (!o) return;
    const { ctx } = this;
    const { host, ex, frame } = o;
    const { d, n, t } = frame;
    const type = getType(this.doc, el.category, el.typeId);
    const P = (u, s) => add(add(host.a, scale(d, u)), scale(n, s));
    // Clear the wall poché across the opening.
    ctx.fillStyle = '#ffffff';
    this.pathPoly([P(ex.u0, -t / 2 - this.px(1)), P(ex.u1, -t / 2 - this.px(1)), P(ex.u1, t / 2 + this.px(1)), P(ex.u0, t / 2 + this.px(1))]);
    ctx.fill();
    ctx.strokeStyle = COLORS.wallLine;
    ctx.lineWidth = 1.2;
    this.line(P(ex.u0, -t / 2), P(ex.u0, t / 2));
    this.line(P(ex.u1, -t / 2), P(ex.u1, t / 2));

    if (el.category === 'window') {
      ctx.lineWidth = 1;
      this.line(P(ex.u0, -t / 2), P(ex.u1, -t / 2));
      this.line(P(ex.u0, t / 2), P(ex.u1, t / 2));
      this.line(P(ex.u0, -t / 10), P(ex.u1, -t / 10));
      this.line(P(ex.u0, t / 10), P(ex.u1, t / 10));
    } else {
      // Door leaves swing to the facing side; hinge side set by flipHand.
      const side = el.flipFacing ? -1 : 1;
      const leaves = type.leaves === '2' ? [[ex.u0, ex.center], [ex.u1, ex.center]] : [el.flipHand ? [ex.u1, ex.u0] : [ex.u0, ex.u1]];
      ctx.lineWidth = 1.2;
      for (const [hinge, free] of leaves) {
        const r = Math.abs(free - hinge);
        const h0 = P(hinge, (side * t) / 2);
        const open = add(h0, scale(n, side * r));
        this.line(h0, open);
        // Swing arc from the open leaf back to the closed position.
        const c = this.toScreen(h0);
        const a1 = Math.atan2(-(open.y - h0.y), open.x - h0.x);
        const closed = P(free, (side * t) / 2);
        const a2 = Math.atan2(-(closed.y - h0.y), closed.x - h0.x);
        ctx.save();
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        let delta = a2 - a1;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        ctx.arc(c.x, c.y, r * this.scale, a1, a1 + delta, delta < 0);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (el.mark && this.scale > 0.025) {
      const side = el.category === 'door' && !el.flipFacing ? -1 : 1;
      this.label(el.mark, P(ex.center, side * (t / 2 + this.px(14))), { size: 10, color: '#3d4a57', bg: 'rgba(255,255,255,0.8)' });
    }
  }

  drawRoof(r, overhead) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = COLORS.roof;
    ctx.lineWidth = overhead ? 1 : 1.4;
    ctx.setLineDash(overhead ? [8, 5] : []);
    this.pathPoly(r.points);
    ctx.stroke();
    if (r.shape && r.shape !== 'flat') {
      // Ridge / hip lines from the top edges of the pitched faces.
      // Each edge is shared by two faces; draw it once so dashes stay readable.
      const seen = new Set();
      const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
      for (const f of pitchedRoofFaces(r.points, r.shape, r.slope ?? 30)) {
        for (let i = 0; i < f.length; i++) {
          const a = f[i];
          const b = f[(i + 1) % f.length];
          const k = [key(a), key(b)].sort().join('|');
          if ((a.z > 1 || b.z > 1) && !seen.has(k)) {
            seen.add(k);
            this.line(a, b);
          }
        }
      }
    }
    ctx.restore();
  }

  drawRoomTag(r, region) {
    const units = this.doc.info.units;
    const at = r.at;
    if (this.scale < 0.012) return;
    this.label(r.name || 'Room', at, { bold: true, size: 12, baseline: 'bottom' });
    this.label(r.number || '', add(at, { x: 0, y: -this.px(2) }), { size: 11, baseline: 'top' });
    this.label(region ? formatArea(polygonArea(region.boundary), units) : 'Not Enclosed', add(at, { x: 0, y: -this.px(17) }), {
      size: 10, baseline: 'top', color: region ? '#5f6b7a' : '#c62828',
    });
  }

  drawDimension(dm, color) {
    const { ctx } = this;
    const dir = norm(sub(dm.b, dm.a));
    const n = perp(dir);
    const A = add(dm.a, scale(n, dm.offset));
    const B = add(dm.b, scale(n, dm.offset));
    const ext = this.px(4) * Math.sign(dm.offset || 1);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    this.line(add(dm.a, scale(n, this.px(3) * Math.sign(dm.offset || 1))), add(A, scale(n, ext)));
    this.line(add(dm.b, scale(n, this.px(3) * Math.sign(dm.offset || 1))), add(B, scale(n, ext)));
    this.line(sub(A, scale(dir, this.px(6))), add(B, scale(dir, this.px(6))));
    ctx.lineWidth = 1.6;
    const tick = scale(norm(add(dir, n)), this.px(4));
    this.line(sub(A, tick), add(A, tick));
    this.line(sub(B, tick), add(B, tick));
    ctx.restore();
    const angle = this.readableAngle(dm.a, dm.b);
    const up = { x: -Math.sin(-angle), y: Math.cos(-angle) };
    this.label(formatLength(dist(dm.a, dm.b), this.doc.info.units), add(mid(A, B), scale(up, this.px(8))), { size: 11, color, angle });
  }

  drawText(t, color) {
    const size = Math.max(6, (t.size || 250) * this.scale);
    this.label(t.text || '', t.at, { size, color, align: 'left', baseline: 'bottom' });
  }

  highlight(el, color, width) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (el.category === 'grid') this.line(el.a, el.b);
    else if (el.category === 'dimension') this.drawDimension(el, color);
    else if (el.category === 'text') this.drawText(el, color);
    else if (el.category === 'room') {
      const r = this.derived().rooms.get(el.id);
      if (r) {
        this.pathPoly(r.boundary);
        ctx.stroke();
        const b = r.boundary;
        ctx.lineWidth = 0.8;
        const c = bbox(b);
        this.line({ x: c.minX, y: c.minY }, { x: c.maxX, y: c.maxY });
        this.line({ x: c.minX, y: c.maxY }, { x: c.maxX, y: c.minY });
      }
      const s = this.toScreen(el.at);
      ctx.strokeRect(s.x - 40, s.y - 18, 80, 44);
    } else {
      const o = this.elementOutline(el);
      if (o) this.pathPoly(o), ctx.stroke();
    }
    ctx.restore();
  }

  /** Grips for the single selected element: [{ p, key, index }]. */
  grips() {
    if (this.app.selection.size !== 1) return [];
    const el = getElement(this.doc, [...this.app.selection][0]);
    if (!el) return [];
    if (el.category === 'wall' || el.category === 'grid' || el.category === 'dimension') {
      return [{ p: el.a, key: 'a' }, { p: el.b, key: 'b' }];
    }
    if (el.points && el.levelId === this.levelId) return el.points.map((p, index) => ({ p, key: 'points', index }));
    return [];
  }

  drawSelectionDecorations() {
    const { ctx } = this;
    for (const g of this.grips()) {
      const s = this.toScreen(g.p);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Temporary length dimension for a single selected wall (click to edit).
    if (this.app.selection.size === 1) {
      const el = getElement(this.doc, [...this.app.selection][0]);
      if (el?.category === 'wall' && el.levelId === this.levelId) {
        const fp = this.derived().footprints.get(el.id);
        const off = (fp ? fp.frame.t / 2 : 100) + this.px(22);
        const n = perp(norm(sub(el.b, el.a)));
        const angle = this.readableAngle(el.a, el.b);
        const at = add(mid(el.a, el.b), scale(n, off));
        const r = this.label(formatLength(wallLength(el), this.doc.info.units), at, {
          size: 11, color: COLORS.select, angle, bg: 'rgba(255,255,255,0.92)',
        });
        ctx.save();
        ctx.strokeStyle = COLORS.select;
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 0.8;
        this.line(add(el.a, scale(n, off - this.px(10))), add(el.b, scale(n, off - this.px(10))));
        ctx.restore();
        this.labelHits.push({ kind: 'wall-length', id: el.id, x: r.x, y: r.y, r: Math.max(r.w, r.h) / 2 + 6 });
      }
    }
  }

  drawSnap() {
    const s = this.snapIndicator;
    if (!s) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = COLORS.guide;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const [a, b] of s.guides || []) {
      const sa = this.toScreen(a);
      const sb = this.toScreen(b);
      const d = norm(sub(sb, sa));
      ctx.beginPath();
      ctx.moveTo(sa.x - d.x * 2000, sa.y - d.y * 2000);
      ctx.lineTo(sb.x + d.x * 2000, sb.y + d.y * 2000);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const c = this.toScreen(s.p);
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (s.kind === 'endpoint') ctx.rect(c.x - 5, c.y - 5, 10, 10);
    else if (s.kind === 'midpoint') {
      ctx.moveTo(c.x, c.y - 6);
      ctx.lineTo(c.x + 6, c.y + 5);
      ctx.lineTo(c.x - 6, c.y + 5);
      ctx.closePath();
    } else if (s.kind === 'intersection') {
      ctx.moveTo(c.x - 5, c.y - 5);
      ctx.lineTo(c.x + 5, c.y + 5);
      ctx.moveTo(c.x + 5, c.y - 5);
      ctx.lineTo(c.x - 5, c.y + 5);
    } else if (s.kind === 'nearest') {
      ctx.moveTo(c.x - 5, c.y - 5);
      ctx.lineTo(c.x + 5, c.y - 5);
      ctx.lineTo(c.x - 5, c.y + 5);
      ctx.lineTo(c.x + 5, c.y + 5);
      ctx.closePath();
    } else {
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---- input -----------------------------------------------------------------

  bind() {
    const c = this.canvas;
    let panning = null;
    const evt = (e) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      return { sx, sy, p: this.toModel(sx, sy), button: e.button, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, detail: e.detail, raw: e };
    };
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      c.setPointerCapture(e.pointerId);
      const ev = evt(e);
      if (e.button === 1 || (e.button === 0 && this.app.spaceDown)) {
        panning = { sx: ev.sx, sy: ev.sy, ox: this.ox, oy: this.oy };
        c.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 2) {
        this.app.tool?.onContext?.(ev);
        return;
      }
      this.app.tool?.onDown?.(ev);
    });
    c.addEventListener('pointermove', (e) => {
      const ev = evt(e);
      this.cursor = ev.p;
      if (panning) {
        this.ox = panning.ox + ev.sx - panning.sx;
        this.oy = panning.oy + ev.sy - panning.sy;
        this.invalidate();
        return;
      }
      this.app.setCoords(ev.p);
      this.app.tool?.onMove?.(ev);
      this.invalidate();
    });
    c.addEventListener('pointerup', (e) => {
      if (panning) {
        panning = null;
        c.style.cursor = '';
        return;
      }
      this.app.tool?.onUp?.(evt(e));
      this.invalidate();
    });
    c.addEventListener('dblclick', (e) => this.app.tool?.onDblClick?.(evt(e)));
    c.addEventListener('pointerleave', () => {
      this.snapIndicator = null;
      this.hoverId = null;
      this.invalidate();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || e.metaKey || e.altKey || mouseWheel) {
        const k = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0018;
        this.zoomAt(sx, sy, Math.exp(-e.deltaY * k));
      } else {
        this.ox -= e.deltaX;
        this.oy -= e.deltaY;
        this.invalidate();
      }
    }, { passive: false });
  }

  /** Export the current view as a PNG data URL. */
  toDataURL() {
    this.snapIndicator = null;
    this.render();
    return this.canvas.toDataURL('image/png');
  }
}
