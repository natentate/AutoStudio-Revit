// A small single-storey house used as the "Open Sample Project" demo.

import { Model, createEmptyProject } from './model.js';
import { buildingOutline, regionAt } from './topology.js';
import { offsetPolygon } from './geometry.js';

export function createSampleProject() {
  const m = new Model(createEmptyProject('Sample House'));
  m.transact('Create Sample', (doc) => {
    doc.info.client = 'AutoStudio';
    doc.info.address = '1 Example Street';
    const add = (props) => {
      const el = { ...props, id: m.newId() };
      doc.elements.push(el);
      return el;
    };
    const wall = (x1, y1, x2, y2, typeId = 'WT2') =>
      add({ category: 'wall', typeId, levelId: 'L1', a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, height: 3000, topLevelId: 'L2', baseOffset: 0 });

    // Grids
    [0, 4000, 8000, 12000].forEach((x, i) => add({ category: 'grid', name: String(i + 1), a: { x, y: -2500 }, b: { x, y: 10500 } }));
    [0, 4500, 8000].forEach((y, i) => add({ category: 'grid', name: String.fromCharCode(65 + i), a: { x: -2500, y }, b: { x: 14500, y } }));

    // Exterior shell (12 m x 8 m), counter-clockwise.
    const south = wall(0, 0, 12000, 0);
    const east = wall(12000, 0, 12000, 8000);
    const north = wall(12000, 8000, 0, 8000);
    const west = wall(0, 8000, 0, 0);

    // Interior partitions
    const corridor = wall(0, 4500, 12000, 4500, 'WT3');
    const p1 = wall(4000, 4500, 4000, 8000, 'WT3');
    const p2 = wall(8000, 0, 8000, 4500, 'WT3');
    const p3 = wall(8000, 4500, 8000, 8000, 'WT3');

    // Doors
    const door = (host, offset, typeId, mark) => add({ category: 'door', typeId, hostId: host.id, offset, mark, flipFacing: false, flipHand: false });
    door(south, 2000, 'DT3', 'D01');
    door(corridor, 2000, 'DT1', 'D02');
    door(corridor, 6000, 'DT1', 'D03');
    door(corridor, 10000, 'DT2', 'D04');
    door(p2, 2500, 'DT2', 'D05');

    // Windows
    const win = (host, offset, typeId, mark) => add({ category: 'window', typeId, hostId: host.id, offset, sill: typeId === 'NT4' ? 300 : 900, mark });
    win(south, 5500, 'NT4', 'W01');
    win(south, 10000, 'NT1', 'W02');
    win(east, 2250, 'NT1', 'W03');
    win(east, 6250, 'NT2', 'W04');
    win(north, 2000, 'NT1', 'W05');
    win(north, 6000, 'NT1', 'W06');
    win(north, 10000, 'NT2', 'W07');
    win(west, 1750, 'NT1', 'W08');
    win(west, 5500, 'NT3', 'W09');

    // Floor slab to the exterior faces.
    add({ category: 'floor', typeId: 'FT2', levelId: 'L1', points: buildingOutline(doc, 'L1'), offset: 0 });

    // Rooms
    const room = (x, y, name, number) => {
      if (regionAt(doc, 'L1', { x, y })) add({ category: 'room', levelId: 'L1', at: { x, y }, name, number });
    };
    room(4000, 2250, 'Living', '101');
    room(10000, 2250, 'Kitchen', '102');
    room(2000, 6250, 'Bedroom', '103');
    room(6000, 6250, 'Bedroom', '104');
    room(10000, 6250, 'Bath', '105');

    // Gable roof on Level 2 with a 600 mm overhang.
    const outline = buildingOutline(doc, 'L1');
    add({ category: 'roof', typeId: 'RT1', levelId: 'L2', points: offsetPolygon(outline, 600), shape: 'gable', slope: 30, baseOffset: 0 });

    // Text note
    add({ category: 'text', levelId: 'L1', at: { x: 0, y: -1800 }, text: 'SAMPLE HOUSE — GROUND FLOOR', size: 350 });
    void east; void west; void p1; void p3;
  });
  // The sample opens clean, with nothing to undo.
  m.undoStack = [];
  m.markSaved();
  return m;
}
