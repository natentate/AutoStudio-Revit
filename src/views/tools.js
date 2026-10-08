// Interactive plan tools. Each tool receives pointer events in model
// coordinates from the active PlanView and draws its own preview overlay.

import { add, sub, scale, norm, perp, dist, dot, closestOnSegment, ensureCCW, polygonArea, offsetPolygon, mid, pointInPolygon } from '../core/geometry.js';
import {
  getType, getElement, wallLength, nextMark, nextRoomNumber, nextGridName, sortedLevels, levelAbove, getLevel,
} from '../core/model.js';
import { regionInFaces, buildingOutline } from '../core/topology.js';
import {
  moveElements, copyElements, mirrorElements, splitWall, trimToCorner, setWallLength, moveWallEnd, defaultWallProps,
} from '../core/edit.js';
import { formatLength, parseLength } from '../core/units.js';
import { ROOF_SHAPES } from '../core/roofgeom.js';
import { h, select as selectEl } from '../ui/dom.js';
import { formDialog } from '../ui/dialogs.js';

const PREVIEW = '#1a73e8';
const PREVIEW_FILL = 'rgba(26, 115, 232, 0.12)';

class Tool {
  constructor(app) {
    this.app = app;
  }
  get view() {
    return this.app.activeView;
  }
  get model() {
    return this.app.model;
  }
  get doc() {
    return this.app.model.doc;
  }
  get levelId() {
    return this.view?.levelId;
  }
  get units() {
    return this.doc.info.units;
  }
  fmt(v) {
    return formatLength(v, this.units);
  }
  activate() {}
  deactivate() {}
  cancel() {
    return false;
  }
  options() {
    return [];
  }
  drawPoly(view, pts, { close = true, fill = null, color = PREVIEW, width = 1.5, dash = null } = {}) {
    if (!pts.length) return;
    const { ctx } = view;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = view.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (close) ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
  }
  /** Draw a "listening" dimension along a→b while drawing. */
  drawTempDim(view, a, b, extra = '') {
    if (dist(a, b) < 1) return;
    const n = perp(norm(sub(b, a)));
    const at = add(mid(a, b), scale(n, view.px(18)));
    view.label(`${this.fmt(dist(a, b))}${extra}`, at, { color: PREVIEW, size: 11, angle: view.readableAngle(a, b), bg: 'rgba(255,255,255,0.9)' });
  }
}

// ---------------------------------------------------------------------------

export class SelectTool extends Tool {
  name = 'select';
  prompt = 'Click to select, drag to move. Drag empty space to box-select (right-to-left = crossing).';
  state = null;

  activate() {
    this.state = null;
  }

  cancel() {
    if (this.state) {
      this.state = null;
      return true;
    }
    if (this.app.selection.size) {
      this.app.select([]);
      return true;
    }
    return false;
  }

  onDown(ev) {
    const view = this.view;
    if (ev.button !== 0) return;
    for (const l of view.labelHits) {
      if (Math.hypot(ev.sx - l.x, ev.sy - l.y) <= l.r && l.kind === 'wall-length') {
        this.editWallLength(l);
        return;
      }
    }
    for (const g of view.grips()) {
      const s = view.toScreen(g.p);
      if (Math.hypot(ev.sx - s.x, ev.sy - s.y) <= 8) {
        this.state = { mode: 'grip', grip: g, id: [...this.app.selection][0], p: g.p };
        return;
      }
    }
    const hit = view.hitTest(ev.p);
    if (hit) {
      if (ev.shift || ev.meta) this.app.toggleSelect(hit.id);
      else if (!this.app.selection.has(hit.id)) this.app.select([hit.id]);
      this.state = { mode: 'pending', start: ev };
    } else {
      if (!ev.shift && !ev.meta) this.app.select([]);
      this.state = { mode: 'boxpending', start: ev, add: ev.shift || ev.meta };
    }
  }

  onMove(ev) {
    const view = this.view;
    const s = this.state;
    if (!s) {
      const hit = view.hitTest(ev.p);
      view.hoverId = hit?.id ?? null;
      view.canvas.style.cursor = hit ? 'pointer' : '';
      return;
    }
    const moved = Math.hypot(ev.sx - (s.start?.sx ?? ev.sx), ev.sy - (s.start?.sy ?? ev.sy)) > 4;
    if (s.mode === 'pending' && moved && this.app.selection.size) {
      this.state = { mode: 'drag', start: s.start, delta: { x: 0, y: 0 } };
    } else if (s.mode === 'boxpending' && moved) {
      this.state = { mode: 'box', start: s.start, cur: ev, add: s.add };
    }
    const st = this.state;
    if (st.mode === 'drag') {
      const snapped = view.snap(ev.p, { from: st.start.p, ortho: ev.shift, exclude: this.app.selection });
      st.delta = sub(snapped.p, st.start.p);
    } else if (st.mode === 'box') {
      st.cur = ev;
    } else if (st.mode === 'grip') {
      const el = getElement(this.doc, st.id);
      const from = st.grip.key === 'a' ? el.b : st.grip.key === 'b' ? el.a : null;
      st.p = view.snap(ev.p, { from, ortho: ev.shift }).p;
    }
  }

  onUp(ev) {
    const s = this.state;
    this.state = null;
    this.view.snapIndicator = null;
    if (!s) return;
    if (s.mode === 'drag' && (s.delta.x || s.delta.y)) {
      this.app.run('Move', (doc) => moveElements(doc, [...this.app.selection], s.delta, { stretchJoins: !ev.alt }));
    } else if (s.mode === 'box') {
      const a = s.start.p;
      const b = s.cur.p;
      const rect = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
      const ids = this.view.elementsInRect(rect, s.cur.sx < s.start.sx);
      this.app.select(s.add ? [...this.app.selection, ...ids] : ids);
    } else if (s.mode === 'grip' && dist(s.p, s.grip.p) > 0.5) {
      const { id, grip, p } = s;
      this.app.run('Drag Grip', (doc) => {
        const el = getElement(doc, id);
        if (el.category === 'wall') moveWallEnd(doc, id, grip.key, p, { dragJoined: !ev.alt });
        else if (grip.key === 'points') el.points[grip.index] = { ...p };
        else el[grip.key] = { ...p };
      });
    }
  }

  onDblClick(ev) {
    const hit = this.view.hitTest(ev.p);
    if (hit?.category === 'room') this.app.editRoom(hit.id);
    else if (hit?.category === 'text') this.app.editText(hit.id);
  }

  editWallLength(l) {
    const wall = getElement(this.doc, l.id);
    const input = h('input', { type: 'text', class: 'length-editor', value: this.fmt(wallLength(wall)) });
    input.style.left = `${l.x - 45}px`;
    input.style.top = `${l.y - 11}px`;
    this.view.host.append(input);
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      input.remove();
      if (apply) {
        const v = parseLength(input.value, this.units);
        if (!Number.isFinite(v)) this.app.toast('Enter a valid length.', true);
        else this.app.run('Change Length', (doc) => setWallLength(doc, l.id, v));
      }
      this.view.canvas.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    // Focus after the canvas finishes handling this click, or it would steal focus back.
    setTimeout(() => {
      input.addEventListener('blur', () => finish(true));
      input.focus();
      input.select();
    }, 0);
  }

  drawOverlay(ctx, view) {
    const s = this.state;
    if (!s) return;
    if (s.mode === 'box') {
      const crossing = s.cur.sx < s.start.sx;
      ctx.save();
      ctx.strokeStyle = PREVIEW;
      ctx.fillStyle = 'rgba(26,115,232,0.07)';
      ctx.setLineDash(crossing ? [5, 4] : []);
      const x = Math.min(s.start.sx, s.cur.sx);
      const y = Math.min(s.start.sy, s.cur.sy);
      ctx.fillRect(x, y, Math.abs(s.cur.sx - s.start.sx), Math.abs(s.cur.sy - s.start.sy));
      ctx.strokeRect(x, y, Math.abs(s.cur.sx - s.start.sx), Math.abs(s.cur.sy - s.start.sy));
      ctx.restore();
    } else if (s.mode === 'drag') {
      for (const id of this.app.selection) {
        const el = getElement(this.doc, id);
        const o = el && view.elementOutline(el);
        if (!o) continue;
        let d = s.delta;
        if (el.hostId) {
          const host = getElement(this.doc, el.hostId);
          const dir = norm(sub(host.b, host.a));
          d = scale(dir, dot(s.delta, dir));
        }
        this.drawPoly(view, o.map((p) => add(p, d)), { dash: [4, 3], close: el.category !== 'grid' });
      }
      if (s.delta.x || s.delta.y) this.drawTempDim(view, s.start.p, add(s.start.p, s.delta));
    } else if (s.mode === 'grip') {
      const el = getElement(this.doc, s.id);
      if (el.category === 'wall' || el.category === 'grid' || el.category === 'dimension') {
        const a = s.grip.key === 'a' ? s.p : el.a;
        const b = s.grip.key === 'b' ? s.p : el.b;
        this.drawPoly(view, [a, b], { close: false, dash: [4, 3] });
        this.drawTempDim(view, a, b);
      } else {
        const pts = el.points.map((p, i) => (i === s.grip.index ? s.p : p));
        this.drawPoly(view, pts, { dash: [4, 3] });
      }
    }
  }
}

// ---------------------------------------------------------------------------

export class WallTool extends Tool {
  name = 'wall';
  category = 'wall';
  prompt = 'Click the wall start point, then each next point. Type a length + Enter for exact walls. Esc to finish.';
  mode = 'line';
  chain = true;
  heightMode = 'auto';
  height = 3000;
  start = null;
  cur = null;
  buffer = '';

  activate() {
    this.start = null;
    this.buffer = '';
  }

  cancel() {
    if (this.start) {
      this.start = null;
      this.buffer = '';
      return true;
    }
    return false;
  }

  options() {
    const levels = sortedLevels(this.doc).filter((l) => l.id !== this.levelId && l.elevation > (getLevel(this.doc, this.levelId)?.elevation ?? 0));
    const heightSel = selectEl(
      [['auto', 'Up to level above'], ...levels.map((l) => [l.id, `Up to: ${l.name}`]), ['unconnected', 'Unconnected']],
      this.heightMode,
      { onchange: (e) => { this.heightMode = e.target.value; this.app.refreshOptions(); } },
    );
    const heightInput = h('input', {
      type: 'text', value: this.fmt(this.height), disabled: this.heightMode !== 'unconnected' && levelAbove(this.doc, this.levelId) ? true : undefined,
      onchange: (e) => {
        const v = parseLength(e.target.value, this.units);
        if (v > 0) this.height = v;
        e.target.value = this.fmt(this.height);
      },
    });
    return [
      h('div', { class: 'seg' },
        h('button', { class: this.mode === 'line' ? 'on' : '', onclick: () => { this.mode = 'line'; this.start = null; this.app.refreshOptions(); } }, 'Line'),
        h('button', { class: this.mode === 'rect' ? 'on' : '', onclick: () => { this.mode = 'rect'; this.start = null; this.app.refreshOptions(); } }, 'Rectangle')),
      h('label', {}, 'Height', heightSel),
      h('label', {}, 'Unconnected', heightInput),
      h('label', {}, h('input', { type: 'checkbox', checked: this.chain, onchange: (e) => { this.chain = e.target.checked; } }), 'Chain'),
    ];
  }

  wallProps(a, b) {
    return {
      category: 'wall',
      typeId: this.app.currentType('wall'),
      levelId: this.levelId,
      a: { ...a },
      b: { ...b },
      height: this.height,
      baseOffset: 0,
      ...defaultWallProps(this.doc, this.levelId, null, this.heightMode),
    };
  }

  create(a, b) {
    if (dist(a, b) < 10) return;
    this.app.run('Create Wall', () => this.model.addElement(this.wallProps(a, b)));
  }

  createRect(a, c) {
    if (Math.abs(a.x - c.x) < 10 || Math.abs(a.y - c.y) < 10) return;
    const x0 = Math.min(a.x, c.x);
    const x1 = Math.max(a.x, c.x);
    const y0 = Math.min(a.y, c.y);
    const y1 = Math.max(a.y, c.y);
    const pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    this.app.run('Create Walls', () => pts.forEach((p, i) => this.model.addElement(this.wallProps(p, pts[(i + 1) % 4]))));
  }

  onMove(ev) {
    this.cur = this.view.snap(ev.p, { from: this.mode === 'line' ? this.start : null, ortho: ev.shift }).p;
  }

  onDown(ev) {
    if (ev.button !== 0) return;
    const p = this.view.snap(ev.p, { from: this.mode === 'line' ? this.start : null, ortho: ev.shift }).p;
    if (!this.start) {
      this.start = p;
      return;
    }
    if (this.mode === 'rect') {
      this.createRect(this.start, p);
      this.start = null;
    } else {
      this.create(this.start, p);
      this.start = this.chain ? p : null;
    }
    this.buffer = '';
  }

  onKey(e) {
    if (!this.start || this.mode !== 'line') return false;
    if (/^[0-9.'"\-/ a-z]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && (this.buffer || /[0-9.]/.test(e.key))) {
      this.buffer += e.key;
      this.app.setPrompt(`Length: ${this.buffer}  (Enter to apply)`);
      return true;
    }
    if (e.key === 'Backspace' && this.buffer) {
      this.buffer = this.buffer.slice(0, -1);
      this.app.setPrompt(`Length: ${this.buffer}`);
      return true;
    }
    if (e.key === 'Enter' && this.buffer && this.cur) {
      const L = parseLength(this.buffer, this.units);
      this.buffer = '';
      this.app.setPrompt(this.prompt);
      const dir = norm(sub(this.cur, this.start));
      if (!Number.isFinite(L) || L <= 0 || (!dir.x && !dir.y)) {
        this.app.toast('Move the cursor to set a direction, then type a length.', true);
        return true;
      }
      const p = add(this.start, scale(dir, L));
      this.create(this.start, p);
      this.start = this.chain ? p : null;
      return true;
    }
    return false;
  }

  drawOverlay(ctx, view) {
    if (!this.start || !this.cur) return;
    const t = getType(this.doc, 'wall', this.app.currentType('wall'))?.thickness ?? 200;
    if (this.mode === 'rect') {
      const a = this.start;
      const c = this.cur;
      const pts = [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }];
      this.drawPoly(view, pts, { fill: PREVIEW_FILL });
      this.drawTempDim(view, pts[0], pts[1]);
      this.drawTempDim(view, pts[1], pts[2]);
      return;
    }
    let b = this.cur;
    if (this.buffer) {
      const L = parseLength(this.buffer, this.units);
      if (Number.isFinite(L)) b = add(this.start, scale(norm(sub(this.cur, this.start)), L));
    }
    const n = perp(norm(sub(b, this.start)));
    const o = scale(n, t / 2);
    this.drawPoly(view, [sub(this.start, o), sub(b, o), add(b, o), add(this.start, o)], { fill: PREVIEW_FILL, width: 1 });
    this.drawPoly(view, [this.start, b], { close: false, dash: [6, 4], width: 1 });
    const ang = (Math.atan2(b.y - this.start.y, b.x - this.start.x) * 180) / Math.PI;
    this.drawTempDim(view, this.start, b, `   ${((ang + 360) % 360).toFixed(1)}°`);
  }
}

// ---------------------------------------------------------------------------

export class OpeningTool extends Tool {
  constructor(app, category) {
    super(app);
    this.category = category;
    this.name = category;
    this.prompt = `Click on a wall to place the ${category}. The side you point at sets the facing.`;
    this.place = null;
  }

  findPlacement(p) {
    const view = this.view;
    const type = getType(this.doc, this.category, this.app.currentType(this.category));
    let best = null;
    for (const w of view.viewElements().filter((e) => e.category === 'wall')) {
      const c = closestOnSegment(p, w.a, w.b);
      const t = getType(this.doc, 'wall', w.typeId)?.thickness ?? 200;
      if (c.d > t / 2 + view.px(14)) continue;
      if (!best || c.d < best.c.d) best = { w, c, t };
    }
    if (!best) return null;
    const { w, c, t } = best;
    const L = wallLength(w);
    if (L < type.width) return { invalid: true, w };
    let offset = Math.round((c.t * L) / 10) * 10;
    if (Math.abs(offset - L / 2) < view.px(10)) offset = L / 2;
    offset = Math.max(type.width / 2, Math.min(L - type.width / 2, offset));
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    return { w, offset, flipFacing: dot(sub(p, c.p), n) < 0, d, n, t, type, L };
  }

  onMove(ev) {
    this.place = this.findPlacement(ev.p);
  }

  onDown(ev) {
    if (ev.button !== 0) return;
    const pl = this.findPlacement(ev.p);
    if (!pl) {
      this.app.toast(`Pick a wall to host the ${this.category}.`, true);
      return;
    }
    if (pl.invalid) {
      this.app.toast(`That wall is too short for this ${this.category} type.`, true);
      return;
    }
    const props = {
      category: this.category, typeId: pl.type.id, hostId: pl.w.id, offset: pl.offset,
      mark: nextMark(this.doc, this.category), flipFacing: pl.flipFacing, flipHand: false,
    };
    if (this.category === 'window') props.sill = pl.type.defaultSill ?? 900;
    this.app.run(`Place ${this.category}`, () => this.model.addElement(props));
  }

  drawOverlay(ctx, view) {
    const pl = this.place;
    if (!pl || pl.invalid) return;
    const { w, offset, d, n, t, type } = pl;
    const at = (u, s) => add(add(w.a, scale(d, u)), scale(n, s));
    const u0 = offset - type.width / 2;
    const u1 = offset + type.width / 2;
    this.drawPoly(view, [at(u0, -t / 2), at(u1, -t / 2), at(u1, t / 2), at(u0, t / 2)], { fill: PREVIEW_FILL });
    if (this.category === 'door') {
      const side = pl.flipFacing ? -1 : 1;
      this.drawPoly(view, [at(u0, (side * t) / 2), add(at(u0, (side * t) / 2), scale(n, side * type.width))], { close: false });
    }
    // Distances to the wall ends.
    this.drawTempDim(view, at(0, -t / 2 - view.px(10)), at(u0, -t / 2 - view.px(10)));
    this.drawTempDim(view, at(u1, -t / 2 - view.px(10)), at(pl.L, -t / 2 - view.px(10)));
  }
}

// ---------------------------------------------------------------------------

export class SketchTool extends Tool {
  constructor(app, category) {
    super(app);
    this.category = category;
    this.name = category;
    this.mode = 'sketch';
    this.pts = [];
    this.cur = null;
    this.shape = 'gable';
    this.slope = 30;
    this.overhang = 600;
    this.targetLevel = null;
  }

  get prompt() {
    const what = this.category === 'roof' ? 'roof edge' : 'floor boundary';
    return {
      sketch: `Click points along the ${what}. Click the first point, double-click or press Enter to finish.`,
      rect: `Click two opposite corners of the ${what}.`,
      region: `Click inside a room enclosed by walls to use its boundary${this.category === 'roof' ? ' (plus overhang)' : ''}.`,
    }[this.mode];
  }

  activate() {
    this.pts = [];
    if (this.category === 'roof') this.targetLevel = levelAbove(this.doc, this.levelId)?.id ?? this.levelId;
  }

  cancel() {
    if (this.pts.length) {
      this.pts = [];
      return true;
    }
    return false;
  }

  options() {
    const modeBtn = (m, label) => h('button', { class: this.mode === m ? 'on' : '', onclick: () => { this.mode = m; this.pts = []; this.app.refreshOptions(); this.app.setPrompt(this.prompt); } }, label);
    const items = [
      h('div', { class: 'seg' }, modeBtn('sketch', 'Polygon'), modeBtn('rect', 'Rectangle'), modeBtn('region', 'Pick Room')),
      h('button', { class: 'btn', onclick: () => this.fromOutline() }, 'From Building Outline'),
    ];
    if (this.category === 'roof') {
      items.push(
        h('label', {}, 'Level', selectEl(sortedLevels(this.doc).map((l) => [l.id, l.name]), this.targetLevel, { onchange: (e) => { this.targetLevel = e.target.value; } })),
        h('label', {}, 'Shape', selectEl(ROOF_SHAPES.map((s) => [s, s[0].toUpperCase() + s.slice(1)]), this.shape, { onchange: (e) => { this.shape = e.target.value; } })),
        h('label', {}, 'Slope°', h('input', { type: 'number', min: 1, max: 75, value: this.slope, style: { width: '56px' }, onchange: (e) => { this.slope = Math.max(1, Math.min(75, +e.target.value || 30)); } })),
        h('label', {}, 'Overhang', h('input', { type: 'text', value: this.fmt(this.overhang), onchange: (e) => { const v = parseLength(e.target.value, this.units); if (v >= 0) this.overhang = v; e.target.value = this.fmt(this.overhang); } })),
      );
    }
    return items;
  }

  fromOutline() {
    const outline = buildingOutline(this.doc, this.levelId);
    if (!outline) {
      this.app.toast('No closed loop of walls on this level.', true);
      return;
    }
    this.finish(outline, true);
  }

  finish(pts, fromWalls = false) {
    let poly = ensureCCW(pts.map((p) => ({ x: p.x, y: p.y })));
    if (poly.length < 3 || Math.abs(polygonArea(poly)) < 1000) {
      this.app.toast('The boundary needs at least three points and some area.', true);
      return;
    }
    if (this.category === 'roof' && fromWalls && this.overhang > 0) poly = offsetPolygon(poly, this.overhang);
    const props = this.category === 'roof'
      ? { category: 'roof', typeId: this.app.currentType('roof'), levelId: this.targetLevel || this.levelId, points: poly, shape: this.shape, slope: this.slope, baseOffset: 0 }
      : { category: 'floor', typeId: this.app.currentType('floor'), levelId: this.levelId, points: poly, offset: 0 };
    const el = this.app.run(`Create ${this.category}`, () => this.model.addElement(props));
    this.pts = [];
    if (el) {
      this.app.select([el.id]);
      if (props.levelId !== this.levelId) this.app.toast(`Roof created on ${getLevel(this.doc, props.levelId)?.name}. It shows dashed here; see it in 3D.`);
    }
  }

  onMove(ev) {
    this.cur = this.view.snap(ev.p, { from: this.pts[this.pts.length - 1] ?? null, ortho: ev.shift, extra: this.pts }).p;
  }

  onDown(ev) {
    if (ev.button !== 0) return;
    if (this.mode === 'region') {
      const r = regionInFaces(this.view.derived().faces, ev.p);
      if (!r) this.app.toast('That point is not enclosed by walls.', true);
      else this.finish(r.boundary, true);
      return;
    }
    const p = this.view.snap(ev.p, { from: this.pts[this.pts.length - 1] ?? null, ortho: ev.shift, extra: this.pts }).p;
    if (this.mode === 'rect') {
      if (!this.pts.length) this.pts = [p];
      else {
        const a = this.pts[0];
        this.finish([a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }]);
      }
      return;
    }
    if (this.pts.length >= 3 && dist(p, this.pts[0]) < this.view.px(10)) {
      this.finish(this.pts);
      return;
    }
    if (!this.pts.length || dist(p, this.pts[this.pts.length - 1]) > 1) this.pts.push(p);
  }

  onDblClick() {
    if (this.mode === 'sketch' && this.pts.length >= 3) this.finish(this.pts);
  }

  onKey(e) {
    if (e.key === 'Enter' && this.pts.length >= 3) {
      this.finish(this.pts);
      return true;
    }
    if (e.key === 'Backspace' && this.pts.length) {
      this.pts.pop();
      return true;
    }
    return false;
  }

  drawOverlay(ctx, view) {
    if (this.mode === 'region' && view.cursor) {
      const r = regionInFaces(view.derived().faces, view.cursor);
      if (r) this.drawPoly(view, r.boundary, { fill: PREVIEW_FILL, dash: [5, 4] });
      return;
    }
    if (!this.pts.length || !this.cur) return;
    if (this.mode === 'rect') {
      const a = this.pts[0];
      const c = this.cur;
      const pts = [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }];
      this.drawPoly(view, pts, { fill: PREVIEW_FILL });
      this.drawTempDim(view, pts[0], pts[1]);
      this.drawTempDim(view, pts[1], pts[2]);
      return;
    }
    this.drawPoly(view, [...this.pts, this.cur], { close: false, fill: PREVIEW_FILL });
    this.drawTempDim(view, this.pts[this.pts.length - 1], this.cur);
  }
}

// ---------------------------------------------------------------------------

export class RoomTool extends Tool {
  name = 'room';
  prompt = 'Click inside an area enclosed by walls to place a room.';
  roomName = 'Room';

  options() {
    return [h('label', {}, 'Name', h('input', { type: 'text', value: this.roomName, onchange: (e) => { this.roomName = e.target.value || 'Room'; } }))];
  }

  onDown(ev) {
    if (ev.button !== 0) return;
    const view = this.view;
    const r = regionInFaces(view.derived().faces, ev.p);
    if (!r) {
      this.app.toast('Not enclosed — rooms must be bounded by walls.', true);
      return;
    }
    const existing = this.doc.elements.find((e) => e.category === 'room' && e.levelId === this.levelId && pointInPolygon(e.at, r.boundary));
    if (existing) {
      this.app.toast(`Room ${existing.number} already occupies this area.`, true);
      return;
    }
    this.app.run('Place Room', () => this.model.addElement({
      category: 'room', levelId: this.levelId, at: { ...ev.p }, name: this.roomName, number: nextRoomNumber(this.doc, this.levelId), department: '',
    }));
  }

  drawOverlay(ctx, view) {
    if (!view.cursor) return;
    const r = regionInFaces(view.derived().faces, view.cursor);
    if (r) this.drawPoly(view, r.boundary, { fill: PREVIEW_FILL, dash: [5, 4] });
  }
}

// ---------------------------------------------------------------------------

/** Generic two-click tool (grid lines, mirror axis, ...). */
class TwoPointTool extends Tool {
  a = null;
  cur = null;
  activate() {
    this.a = null;
  }
  cancel() {
    if (this.a) {
      this.a = null;
      return true;
    }
    return false;
  }
  onMove(ev) {
    this.cur = this.view.snap(ev.p, { from: this.a, ortho: ev.shift }).p;
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const p = this.view.snap(ev.p, { from: this.a, ortho: ev.shift }).p;
    if (!this.a) this.a = p;
    else {
      const a = this.a;
      this.a = null;
      if (dist(a, p) > 10) this.complete(a, p);
    }
  }
  drawOverlay(ctx, view) {
    if (this.a && this.cur) {
      this.drawPoly(view, [this.a, this.cur], { close: false, dash: [8, 4] });
      this.drawTempDim(view, this.a, this.cur);
    }
  }
}

export class GridTool extends TwoPointTool {
  name = 'grid';
  prompt = 'Click the start and end of the grid line.';
  complete(a, b) {
    const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    this.app.run('Create Grid', () => this.model.addElement({ category: 'grid', name: nextGridName(this.doc, vertical), a, b }));
  }
}

export class MirrorTool extends TwoPointTool {
  name = 'mirror';
  prompt = 'Draw the mirror axis: click its first point, then its second point.';
  copy = true;
  activate() {
    super.activate();
    if (!this.app.selection.size) {
      this.app.toast('Select elements to mirror first.', true);
      queueMicrotask(() => this.app.setTool('select'));
    }
  }
  options() {
    return [h('label', {}, h('input', { type: 'checkbox', checked: this.copy, onchange: (e) => { this.copy = e.target.checked; } }), 'Copy')];
  }
  complete(a, b) {
    const ids = [...this.app.selection];
    const created = this.app.run('Mirror', (doc) => mirrorElements(doc, ids, a, b, { copy: this.copy, newId: () => this.model.newId() }));
    if (created?.length) this.app.select(created);
    this.app.setTool('select');
  }
}

export class DimensionTool extends Tool {
  name = 'dimension';
  prompt = 'Click the first point, the second point, then where to place the dimension line.';
  pts = [];
  cur = null;
  activate() {
    this.pts = [];
  }
  cancel() {
    if (this.pts.length) {
      this.pts = [];
      return true;
    }
    return false;
  }
  offsetFor(p) {
    const [a, b] = this.pts;
    return dot(sub(p, a), perp(norm(sub(b, a))));
  }
  onMove(ev) {
    this.cur = this.pts.length === 2 ? ev.p : this.view.snap(ev.p, { from: this.pts[0] ?? null, ortho: ev.shift }).p;
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    if (this.pts.length < 2) {
      const p = this.view.snap(ev.p, { from: this.pts[0] ?? null, ortho: ev.shift }).p;
      if (this.pts.length === 1 && dist(p, this.pts[0]) < 1) return;
      this.pts.push(p);
      return;
    }
    const [a, b] = this.pts;
    const offset = this.offsetFor(ev.p);
    this.pts = [];
    this.app.run('Create Dimension', () => this.model.addElement({ category: 'dimension', levelId: this.levelId, a, b, offset }));
  }
  drawOverlay(ctx, view) {
    if (!this.cur) return;
    if (this.pts.length === 1) this.drawPoly(view, [this.pts[0], this.cur], { close: false, dash: [4, 3] });
    if (this.pts.length === 2) view.drawDimension({ a: this.pts[0], b: this.pts[1], offset: this.offsetFor(this.cur) }, PREVIEW);
  }
}

export class TextTool extends Tool {
  name = 'text';
  prompt = 'Click where the text note should start.';
  size = 250;
  options() {
    return [h('label', {}, 'Text height', h('input', { type: 'text', value: this.fmt(this.size), onchange: (e) => { const v = parseLength(e.target.value, this.units); if (v > 0) this.size = v; e.target.value = this.fmt(this.size); } }))];
  }
  async onDown(ev) {
    if (ev.button !== 0) return;
    const at = { ...ev.p };
    const levelId = this.levelId;
    const r = await formDialog('Text Note', [{ key: 'text', label: 'Text', kind: 'textarea', value: '', required: true }], { okLabel: 'Place' });
    if (r?.text?.trim()) this.app.run('Create Text', () => this.model.addElement({ category: 'text', levelId, at, text: r.text.trim(), size: this.size }));
  }
}

// ---------------------------------------------------------------------------

export class MoveCopyTool extends Tool {
  constructor(app, copy) {
    super(app);
    this.copy = copy;
    this.name = copy ? 'copy' : 'move';
    this.prompt = `Click a base point, then the destination point to ${copy ? 'copy' : 'move'} the selection.`;
    this.base = null;
    this.cur = null;
    this.multiple = false;
  }
  activate() {
    this.base = null;
    if (!this.app.selection.size) {
      this.app.toast(`Select elements to ${this.copy ? 'copy' : 'move'} first.`, true);
      queueMicrotask(() => this.app.setTool('select'));
    }
  }
  cancel() {
    if (this.base) {
      this.base = null;
      return true;
    }
    return false;
  }
  options() {
    return this.copy ? [h('label', {}, h('input', { type: 'checkbox', checked: this.multiple, onchange: (e) => { this.multiple = e.target.checked; } }), 'Multiple')] : [];
  }
  onMove(ev) {
    this.cur = this.view.snap(ev.p, { from: this.base, ortho: ev.shift }).p;
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const p = this.view.snap(ev.p, { from: this.base, ortho: ev.shift }).p;
    if (!this.base) {
      this.base = p;
      return;
    }
    const delta = sub(p, this.base);
    const ids = [...this.app.selection];
    if (this.copy) {
      const created = this.app.run('Copy', (doc) => copyElements(doc, ids, (q) => add(q, delta), () => this.model.newId(), { delta }));
      if (!this.multiple) {
        if (created) this.app.select(created);
        this.app.setTool('select');
      }
    } else {
      this.app.run('Move', (doc) => moveElements(doc, ids, delta));
      this.app.setTool('select');
    }
  }
  drawOverlay(ctx, view) {
    if (!this.base || !this.cur) return;
    const delta = sub(this.cur, this.base);
    this.drawPoly(view, [this.base, this.cur], { close: false, dash: [4, 3] });
    this.drawTempDim(view, this.base, this.cur);
    for (const id of this.app.selection) {
      const el = getElement(this.doc, id);
      const o = el && !el.hostId && view.elementOutline(el);
      if (o) this.drawPoly(view, o.map((q) => add(q, delta)), { dash: [4, 3], close: el.category !== 'grid' });
    }
  }
}

export class TrimTool extends Tool {
  name = 'trim';
  prompt = 'Trim/Extend to Corner: click the first wall, then the second wall.';
  first = null;
  activate() {
    this.first = null;
  }
  cancel() {
    if (this.first) {
      this.first = null;
      this.app.select([]);
      return true;
    }
    return false;
  }
  onMove(ev) {
    const hit = this.view.hitTest(ev.p);
    this.view.hoverId = hit?.category === 'wall' ? hit.id : null;
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const hit = this.view.hitTest(ev.p);
    if (hit?.category !== 'wall') return;
    if (!this.first) {
      this.first = hit.id;
      this.app.select([hit.id]);
      return;
    }
    const a = this.first;
    this.first = null;
    this.app.run('Trim/Extend to Corner', (doc) => trimToCorner(doc, a, hit.id));
    this.app.select([]);
  }
}

export class SplitTool extends Tool {
  name = 'split';
  prompt = 'Click a wall where it should be split in two.';
  cur = null;
  onMove(ev) {
    const hit = this.view.hitTest(ev.p);
    this.view.hoverId = hit?.category === 'wall' ? hit.id : null;
    this.cur = hit?.category === 'wall' ? closestOnSegment(ev.p, hit.a, hit.b).p : null;
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const hit = this.view.hitTest(ev.p);
    if (hit?.category !== 'wall') return;
    const id = this.app.run('Split Wall', (doc) => splitWall(doc, hit.id, ev.p, () => this.model.newId()));
    if (id === null) this.app.toast('Too close to the end of the wall to split.', true);
  }
  drawOverlay(ctx, view) {
    if (!this.cur) return;
    const s = view.toScreen(this.cur);
    ctx.save();
    ctx.strokeStyle = PREVIEW;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - 8, s.y + 8);
    ctx.lineTo(s.x + 8, s.y - 8);
    ctx.stroke();
    ctx.restore();
  }
}

export function createTool(app, name) {
  switch (name) {
    case 'wall': return new WallTool(app);
    case 'door': return new OpeningTool(app, 'door');
    case 'window': return new OpeningTool(app, 'window');
    case 'floor': return new SketchTool(app, 'floor');
    case 'roof': return new SketchTool(app, 'roof');
    case 'room': return new RoomTool(app);
    case 'grid': return new GridTool(app);
    case 'dimension': return new DimensionTool(app);
    case 'text': return new TextTool(app);
    case 'move': return new MoveCopyTool(app, false);
    case 'copy': return new MoveCopyTool(app, true);
    case 'mirror': return new MirrorTool(app);
    case 'trim': return new TrimTool(app);
    case 'split': return new SplitTool(app);
    default: return new SelectTool(app);
  }
}
