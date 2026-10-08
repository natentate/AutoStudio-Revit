import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSampleProject } from '../src/core/sample.js';
import { exportIFC, ifcGuid, stepString } from '../src/core/ifc.js';
import { buildSchedule, scheduleToCSV } from '../src/core/schedules.js';
import { pitchedRoofFaces } from '../src/core/roofgeom.js';
import { Model } from '../src/core/model.js';

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

test('ifc: GUIDs are 22 characters of the IFC alphabet', () => {
  const g = ifcGuid(seeded(7));
  assert.match(g, /^[0-3][0-9A-Za-z_$]{21}$/);
  assert.notEqual(ifcGuid(seeded(1)), ifcGuid(seeded(2)));
});

test('ifc: STEP strings escape quotes and non-ASCII', () => {
  assert.equal(stepString("O'Neil"), "'O''Neil'");
  assert.equal(stepString('m²'), "'m\\X2\\00B2\\X0\\'");
  assert.equal(stepString(null), '$');
});

test('ifc: sample project exports a complete IFC4 file', () => {
  const m = createSampleProject();
  const ifc = exportIFC(m.doc, { random: seeded(3), timestamp: new Date('2026-01-01T00:00:00Z') });
  assert.match(ifc, /^ISO-10303-21;/);
  assert.match(ifc, /FILE_SCHEMA\(\('IFC4'\)\);/);
  assert.ok(ifc.trimEnd().endsWith('END-ISO-10303-21;'));
  const count = (re) => (ifc.match(re) || []).length;
  assert.equal(count(/=IFCWALL\(/g), 8);
  assert.equal(count(/=IFCDOOR\(/g), 5);
  assert.equal(count(/=IFCWINDOW\(/g), 9);
  assert.equal(count(/=IFCOPENINGELEMENT\(/g), 14);
  assert.equal(count(/=IFCSPACE\(/g), 5);
  assert.equal(count(/=IFCSLAB\(/g), 1);
  assert.equal(count(/=IFCROOF\(/g), 1);
  assert.equal(count(/=IFCBUILDINGSTOREY\(/g), 2);
  // Every referenced entity is defined.
  const defined = new Set([...ifc.matchAll(/^#(\d+)=/gm)].map((x) => x[1]));
  for (const [, ref] of ifc.matchAll(/[(,]#(\d+)/g)) assert.ok(defined.has(ref), `#${ref} is defined`);
});

test('roof: pitched roof faces form a closed solid', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }];
  for (const shape of ['gable', 'hip', 'shed']) {
    const faces = pitchedRoofFaces(pts, shape, 30);
    // Closed manifold: every edge is used exactly twice, in opposite directions.
    const edges = new Map();
    const key = (p) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
    for (const f of faces) {
      for (let i = 0; i < f.length; i++) {
        const k = `${key(f[i])}>${key(f[(i + 1) % f.length])}`;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    for (const k of edges.keys()) {
      const [a, b] = k.split('>');
      assert.equal(edges.get(`${b}>${a}`), 1, `${shape}: edge ${k} has a twin`);
    }
  }
});

test('schedules: sample door, room and wall schedules', () => {
  const m = createSampleProject();
  const doors = buildSchedule(m.doc, 'door');
  assert.equal(doors.rows.length, 5);
  assert.deepEqual(doors.rows.map((r) => r.cells.mark), ['D01', 'D02', 'D03', 'D04', 'D05']);
  const rooms = buildSchedule(m.doc, 'room');
  assert.equal(rooms.rows.length, 5);
  assert.ok(rooms.rows.every((r) => r.cells.area.endsWith('m²')));
  const walls = buildSchedule(m.doc, 'wall');
  assert.equal(walls.rows.length, 8);
  const csv = scheduleToCSV(doors);
  assert.equal(csv.split('\n')[0], 'Mark,Type,Width,Height,Level,Host Wall,Comments');
});

test('sample project round-trips through save and load', () => {
  const m = createSampleProject();
  assert.ok(!m.dirty);
  const copy = Model.fromJSON(m.toJSON());
  assert.deepEqual(copy.doc, m.doc);
});
