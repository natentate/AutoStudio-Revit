import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Model, createEmptyProject } from '../src/core/model.js';
import {
  moveElements, copyElements, rotateElements, mirrorElements, mirrorPoint, splitWall, trimToCorner, setWallLength, moveWallEnd,
} from '../src/core/edit.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

function setup() {
  const m = new Model(createEmptyProject());
  const wall = (a, b) => m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a, b, height: 3000 });
  const w1 = wall({ x: 0, y: 0 }, { x: 6000, y: 0 });
  const w2 = wall({ x: 6000, y: 0 }, { x: 6000, y: 4000 });
  const door = m.addElement({ category: 'door', typeId: 'DT1', hostId: w1.id, offset: 4000, mark: 'D01' });
  return { m, w1, w2, door };
}

test('move stretches walls joined at moved endpoints', () => {
  const { m, w1, w2 } = setup();
  m.transact('Move', (doc) => moveElements(doc, [w1.id], { x: 0, y: -1000 }));
  assert.deepEqual(m.get(w1.id).a, { x: 0, y: -1000 });
  assert.deepEqual(m.get(w2.id).a, { x: 6000, y: -1000 }, 'joined end follows');
  assert.deepEqual(m.get(w2.id).b, { x: 6000, y: 4000 }, 'far end stays');
});

test('moving a door alone slides it along its host', () => {
  const { m, door } = setup();
  m.transact('Move', (doc) => moveElements(doc, [door.id], { x: -1000, y: 500 }));
  assert.equal(m.get(door.id).offset, 3000);
});

test('copying a wall copies its hosted door with a new mark', () => {
  const { m, w1 } = setup();
  const created = m.transact('Copy', (doc) => copyElements(doc, [w1.id], (p) => ({ x: p.x, y: p.y + 5000 }), () => m.newId()));
  assert.equal(created.length, 2);
  const [cw, cd] = created.map((id) => m.get(id));
  assert.equal(cw.a.y, 5000);
  assert.equal(cd.hostId, cw.id);
  assert.equal(cd.mark, 'D02');
});

test('rotate and mirror', () => {
  const { m, w1 } = setup();
  m.transact('Rotate', (doc) => rotateElements(doc, [w1.id], { x: 0, y: 0 }, Math.PI / 2));
  near(m.get(w1.id).b.x, 0);
  near(m.get(w1.id).b.y, 6000);
  const p = mirrorPoint({ x: 1, y: 2 }, { x: 0, y: 0 }, { x: 1, y: 0 });
  near(p.x, 1);
  near(p.y, -2);
  const created = m.transact('Mirror', (doc) => mirrorElements(doc, [w1.id], { x: 1000, y: 0 }, { x: 1000, y: 1 }, { copy: true, newId: () => m.newId() }));
  assert.equal(m.get(created[0]).a.x, 2000);
  assert.equal(m.get(created[1]).flipHand, true, 'mirrored door flips hand');
});

test('split wall moves openings past the split to the new wall', () => {
  const { m, w1, door } = setup();
  const nid = m.transact('Split', (doc) => splitWall(doc, w1.id, { x: 2000, y: 30 }, () => m.newId()));
  assert.deepEqual(m.get(w1.id).b, { x: 2000, y: 0 });
  assert.deepEqual(m.get(nid).a, { x: 2000, y: 0 });
  assert.equal(m.get(door.id).hostId, nid);
  assert.equal(m.get(door.id).offset, 2000);
});

test('trim/extend two walls to a corner', () => {
  const m = new Model(createEmptyProject());
  const a = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, height: 3000 });
  const b = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 5000, y: 1000 }, b: { x: 5000, y: 4000 }, height: 3000 });
  m.transact('Trim', (doc) => trimToCorner(doc, a.id, b.id));
  assert.deepEqual(m.get(a.id).b, { x: 5000, y: 0 });
  assert.deepEqual(m.get(b.id).a, { x: 5000, y: 0 });
  const c = m.addElement({ category: 'wall', typeId: 'WT1', levelId: 'L1', a: { x: 0, y: 500 }, b: { x: 4000, y: 500 }, height: 3000 });
  assert.throws(() => m.transact('Trim', (doc) => trimToCorner(doc, a.id, c.id)), /parallel/);
});

test('set wall length drags the joined wall along', () => {
  const { m, w1, w2 } = setup();
  m.transact('Length', (doc) => setWallLength(doc, w1.id, 8000));
  assert.deepEqual(m.get(w1.id).b, { x: 8000, y: 0 });
  assert.deepEqual(m.get(w2.id).a, { x: 8000, y: 0 });
  assert.throws(() => m.transact('Length', (doc) => setWallLength(doc, w1.id, 0)));
});

test('dragging a wall start keeps openings in place', () => {
  const { m, w1, door } = setup();
  m.transact('Grip', (doc) => moveWallEnd(doc, w1.id, 'a', { x: 1000, y: 0 }));
  assert.equal(m.get(door.id).offset, 3000, 'door stays at x = 4000');
});
