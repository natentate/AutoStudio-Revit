import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatLength, parseLength, formatArea } from '../src/core/units.js';
import { polygonArea, offsetPolygon, pointInPolygon } from '../src/core/geometry.js';
import { Model, createEmptyProject, wallHeight, openingExtents, nextMark, nextRoomNumber } from '../src/core/model.js';
import { regionAt, buildingOutline } from '../src/core/topology.js';
import { wallFootprints, wallPieces } from '../src/core/wallgeom.js';

const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

function box(model, x0, y0, x1, y1, typeId = 'WT1') {
  const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return c.map((a, i) => model.addElement({ category: 'wall', typeId, levelId: 'L1', a, b: c[(i + 1) % 4], height: 3000 }));
}

test('units: metric and imperial formatting', () => {
  assert.equal(formatLength(3000), '3000');
  assert.equal(formatLength(304.8, 'imperial'), `1' 0"`);
  assert.equal(formatLength(3200.4, 'imperial'), `10' 6"`);
  assert.equal(formatLength(25.4 * 6.5, 'imperial'), `0' 6 1/2"`);
  assert.equal(formatArea(12e6), '12.00 m²');
});

test('units: parsing lengths', () => {
  assert.equal(parseLength('3000'), 3000);
  assert.equal(parseLength('3m'), 3000);
  assert.equal(parseLength('30cm'), 300);
  near(parseLength(`10'6"`), 3200.4, 0.01);
  near(parseLength(`10' 6 1/2"`), 3213.1, 0.01);
  near(parseLength(`6"`), 152.4, 0.01);
  near(parseLength('10', 'imperial'), 3048, 0.01);
  assert.ok(Number.isNaN(parseLength('abc')));
  assert.ok(Number.isNaN(parseLength('')));
});

test('geometry: polygon area and offset', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(polygonArea(sq), 100);
  const big = offsetPolygon(sq, 1);
  near(polygonArea(big), 144, 1e-6);
  assert.ok(pointInPolygon({ x: 5, y: 5 }, sq));
  assert.ok(!pointInPolygon({ x: 15, y: 5 }, sq));
});

test('model: transactions, undo and redo', () => {
  const m = new Model(createEmptyProject());
  assert.ok(!m.dirty);
  const w = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, height: 3000 });
  assert.ok(m.dirty);
  m.updateElement(w.id, { height: 4000 });
  assert.equal(m.get(w.id).height, 4000);
  m.undo();
  assert.equal(m.get(w.id).height, 3000);
  m.undo();
  assert.equal(m.get(w.id), null);
  assert.ok(!m.dirty, 'undoing back to the saved state clears dirty');
  m.redo();
  m.redo();
  assert.equal(m.get(w.id).height, 4000);
});

test('model: failed transaction rolls back', () => {
  const m = new Model(createEmptyProject());
  assert.throws(() => m.transact('Bad', (doc) => {
    doc.elements.push({ id: 'X', category: 'wall' });
    throw new Error('boom');
  }));
  assert.equal(m.doc.elements.length, 0);
  assert.ok(!m.canUndo());
});

test('model: deleting a wall removes its doors and windows', () => {
  const m = new Model(createEmptyProject());
  const w = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, height: 3000 });
  m.addElement({ category: 'door', typeId: 'DT1', hostId: w.id, offset: 1000, mark: nextMark(m.doc, 'door') });
  m.addElement({ category: 'window', typeId: 'NT1', hostId: w.id, offset: 3000, sill: 900 });
  assert.equal(nextMark(m.doc, 'door'), 'D02');
  const removed = m.deleteElements([w.id]);
  assert.equal(removed.length, 3);
  assert.equal(m.doc.elements.length, 0);
});

test('model: wall height follows top constraint level', () => {
  const doc = createEmptyProject();
  const wall = { levelId: 'L1', topLevelId: 'L2', height: 1000 };
  assert.equal(wallHeight(doc, wall), 3000);
  doc.levels[1].elevation = 4000;
  assert.equal(wallHeight(doc, wall), 4000);
});

test('model: save/load round trip and file validation', () => {
  const m = new Model(createEmptyProject('Test'));
  box(m, 0, 0, 4000, 3000);
  const copy = Model.fromJSON(m.toJSON());
  assert.equal(copy.doc.elements.length, 4);
  assert.equal(copy.doc.info.name, 'Test');
  assert.throws(() => Model.fromJSON('{"hello":1}'), /not an AutoStudio project/);
  assert.throws(() => Model.fromJSON('not json'), /damaged/);
});

test('openings clamp to their host wall', () => {
  const m = new Model(createEmptyProject());
  const w = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, height: 3000 });
  const d = m.addElement({ category: 'door', typeId: 'DT1', hostId: w.id, offset: 100 });
  const ex = openingExtents(m.doc, d);
  assert.equal(ex.u0, 0);
  assert.equal(ex.u1, 900);
  assert.equal(ex.z1, 2100);
});

test('topology: room region inside four walls at wall faces', () => {
  const m = new Model(createEmptyProject());
  box(m, 0, 0, 5000, 4000);
  const r = regionAt(m.doc, 'L1', { x: 2500, y: 2000 });
  assert.ok(r, 'region found');
  // 200mm walls → inner faces 100mm in from centrelines.
  near(polygonArea(r.boundary), 4800 * 3800, 1);
  assert.equal(regionAt(m.doc, 'L1', { x: 9000, y: 2000 }), null);
});

test('topology: interior wall splits a region into two rooms', () => {
  const m = new Model(createEmptyProject());
  box(m, 0, 0, 6000, 4000);
  m.addElement({ category: 'wall', typeId: 'WT3', levelId: 'L1', a: { x: 3000, y: 0 }, b: { x: 3000, y: 4000 }, height: 3000 });
  const left = regionAt(m.doc, 'L1', { x: 1000, y: 2000 });
  const right = regionAt(m.doc, 'L1', { x: 5000, y: 2000 });
  // Left: x 100..2950, y 100..3900
  near(polygonArea(left.boundary), 2850 * 3800, 1);
  near(polygonArea(right.boundary), 2850 * 3800, 1);
});

test('topology: open walls do not enclose a region', () => {
  const m = new Model(createEmptyProject());
  m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, height: 3000 });
  m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 5000, y: 0 }, b: { x: 5000, y: 5000 }, height: 3000 });
  assert.equal(regionAt(m.doc, 'L1', { x: 2500, y: 2500 }), null);
  assert.equal(buildingOutline(m.doc, 'L1'), null);
});

test('topology: building outline at exterior faces', () => {
  const m = new Model(createEmptyProject());
  box(m, 0, 0, 5000, 4000);
  m.addElement({ category: 'wall', typeId: 'WT3', levelId: 'L1', a: { x: 2000, y: 0 }, b: { x: 2000, y: 4000 }, height: 3000 });
  const o = buildingOutline(m.doc, 'L1');
  assert.ok(polygonArea(o) > 0, 'CCW');
  near(polygonArea(o), 5200 * 4200, 1);
});

test('room numbers count up per level', () => {
  const m = new Model(createEmptyProject());
  assert.equal(nextRoomNumber(m.doc, 'L1'), '101');
  m.addElement({ category: 'room', levelId: 'L1', at: { x: 0, y: 0 }, name: 'Room', number: '101' });
  assert.equal(nextRoomNumber(m.doc, 'L1'), '102');
  assert.equal(nextRoomNumber(m.doc, 'L2'), '201');
});

test('wallgeom: L-corners are mitered to the outer faces', () => {
  const m = new Model(createEmptyProject());
  const [bottom] = box(m, 0, 0, 5000, 4000);
  const fp = wallFootprints(m.doc, 'L1').get(bottom.id);
  assert.ok(fp.startJoined && fp.endJoined);
  const [sR, eR, eL, sL] = fp.poly;
  // Bottom wall runs +x; right side (-n) is the exterior (y = -100).
  near(sR.x, -100); near(sR.y, -100);
  near(eR.x, 5100); near(eR.y, -100);
  near(eL.x, 4900); near(eL.y, 100);
  near(sL.x, 100); near(sL.y, 100);
});

test('wallgeom: T-junction stops at the through wall face', () => {
  const m = new Model(createEmptyProject());
  const through = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, height: 3000 });
  const stem = m.addElement({ category: 'wall', typeId: 'WT3', levelId: 'L1', a: { x: 3000, y: 0 }, b: { x: 3000, y: 3000 }, height: 3000 });
  const fp = wallFootprints(m.doc, 'L1');
  const [sR, , , sL] = fp.get(stem.id).poly;
  near(sR.y, 100); near(sL.y, 100);
  assert.ok(!fp.get(through.id).startJoined);
});

test('wallgeom: openings cut the wall into pieces', () => {
  const m = new Model(createEmptyProject());
  const w = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, height: 3000 });
  m.addElement({ category: 'door', typeId: 'DT1', hostId: w.id, offset: 1500 });
  m.addElement({ category: 'window', typeId: 'NT1', hostId: w.id, offset: 4000, sill: 900 });
  const fp = wallFootprints(m.doc, 'L1').get(w.id);
  const pieces = wallPieces(m.doc, w, fp);
  // left solid, above door, between, below window, above window, right solid
  assert.equal(pieces.length, 6);
  const volume = pieces.reduce((s, p) => s + Math.abs(polygonArea(p.poly)) * (p.z1 - p.z0), 0);
  const expected = 6000 * 200 * 3000 - 900 * 200 * 2100 - 1200 * 200 * 1500;
  near(volume, expected, 1);
});

test('wallgeom: collinear walls join without a seam', () => {
  const m = new Model(createEmptyProject());
  const a = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, height: 3000 });
  m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 3000, y: 0 }, b: { x: 6000, y: 0 }, height: 3000 });
  const fp = wallFootprints(m.doc, 'L1').get(a.id);
  assert.ok(fp.endJoined);
  near(fp.poly[1].x, 3000);
  near(fp.poly[1].y, -100);
});
