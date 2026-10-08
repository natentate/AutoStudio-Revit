// Tabular schedules (quantity take-offs) and CSV export.

import { getLevel, getType, getElement, wallHeight, wallLength, openingExtents, elementLevelId, sortedLevels } from './model.js';
import { regionAt } from './topology.js';
import { polygonArea, polygonPerimeter } from './geometry.js';
import { formatLength, formatArea, formatVolume } from './units.js';
import { roofRise } from './roofgeom.js';

export const SCHEDULES = {
  wall: 'Wall Schedule',
  door: 'Door Schedule',
  window: 'Window Schedule',
  room: 'Room Schedule',
  floor: 'Floor Schedule',
  roof: 'Roof Schedule',
};

const levelOrder = (doc) => new Map(sortedLevels(doc).map((l, i) => [l.id, i]));

/**
 * Build a schedule. Returns { title, columns: [{key, label, editable?}], rows: [{id, cells: {key: display}, raw}], totals }.
 */
export function buildSchedule(doc, category) {
  const units = doc.info.units;
  const L = (v) => formatLength(v, units);
  const lname = (id) => getLevel(doc, id)?.name ?? '';
  const order = levelOrder(doc);
  const els = doc.elements
    .filter((e) => e.category === category)
    .sort((a, b) => (order.get(elementLevelId(doc, a)) ?? 0) - (order.get(elementLevelId(doc, b)) ?? 0));

  let columns;
  let rows;
  const totals = {};

  if (category === 'wall') {
    columns = [
      { key: 'type', label: 'Type' }, { key: 'level', label: 'Base Level' }, { key: 'length', label: 'Length' },
      { key: 'height', label: 'Height' }, { key: 'area', label: 'Area' }, { key: 'volume', label: 'Volume' },
      { key: 'comments', label: 'Comments', editable: true },
    ];
    let tl = 0;
    let ta = 0;
    let tv = 0;
    rows = els.map((w) => {
      const t = getType(doc, 'wall', w.typeId);
      const len = wallLength(w);
      const h = wallHeight(doc, w);
      let openArea = 0;
      for (const o of doc.elements.filter((e) => e.hostId === w.id)) {
        const ex = openingExtents(doc, o);
        if (ex) openArea += ex.width * ex.height;
      }
      const area = len * h - openArea;
      const vol = area * t.thickness;
      tl += len;
      ta += area;
      tv += vol;
      return { id: w.id, cells: { type: t.name, level: lname(w.levelId), length: L(len), height: L(h), area: formatArea(area, units), volume: formatVolume(vol, units), comments: w.comments || '' } };
    });
    Object.assign(totals, { type: `Total: ${rows.length}`, length: L(tl), area: formatArea(ta, units), volume: formatVolume(tv, units) });
  } else if (category === 'door' || category === 'window') {
    columns = [
      { key: 'mark', label: 'Mark', editable: true }, { key: 'type', label: 'Type' }, { key: 'width', label: 'Width' },
      { key: 'height', label: 'Height' },
      ...(category === 'window' ? [{ key: 'sill', label: 'Sill Height' }] : []),
      { key: 'level', label: 'Level' }, { key: 'host', label: 'Host Wall' }, { key: 'comments', label: 'Comments', editable: true },
    ];
    rows = els.map((e) => {
      const t = getType(doc, category, e.typeId);
      const ex = openingExtents(doc, e);
      const host = getElement(doc, e.hostId);
      return {
        id: e.id,
        cells: {
          mark: e.mark || '', type: t.name, width: L(t.width), height: L(t.height),
          sill: L(ex ? ex.z0 : e.sill), level: lname(elementLevelId(doc, e)),
          host: host ? getType(doc, 'wall', host.typeId).name : '', comments: e.comments || '',
        },
      };
    });
    totals.mark = `Total: ${rows.length}`;
  } else if (category === 'room') {
    columns = [
      { key: 'number', label: 'Number', editable: true }, { key: 'name', label: 'Name', editable: true },
      { key: 'level', label: 'Level' }, { key: 'area', label: 'Area' }, { key: 'perimeter', label: 'Perimeter' },
      { key: 'department', label: 'Department', editable: true },
    ];
    let ta = 0;
    rows = els.map((r) => {
      const region = regionAt(doc, r.levelId, r.at);
      const area = region ? polygonArea(region.boundary) : 0;
      ta += area;
      return {
        id: r.id,
        cells: {
          number: r.number || '', name: r.name || '', level: lname(r.levelId),
          area: region ? formatArea(area, units) : 'Not Enclosed',
          perimeter: region ? L(polygonPerimeter(region.boundary)) : '', department: r.department || '',
        },
      };
    });
    Object.assign(totals, { number: `Total: ${rows.length}`, area: formatArea(ta, units) });
  } else if (category === 'floor' || category === 'roof') {
    columns = [
      { key: 'type', label: 'Type' }, { key: 'level', label: 'Level' }, { key: 'area', label: 'Area' },
      { key: 'perimeter', label: 'Perimeter' }, { key: 'thickness', label: 'Thickness' },
      ...(category === 'roof' ? [{ key: 'shape', label: 'Shape' }, { key: 'rise', label: 'Ridge Height' }] : []),
      { key: 'comments', label: 'Comments', editable: true },
    ];
    let ta = 0;
    rows = els.map((e) => {
      const t = getType(doc, category, e.typeId);
      const area = Math.abs(polygonArea(e.points));
      ta += area;
      return {
        id: e.id,
        cells: {
          type: t.name, level: lname(e.levelId), area: formatArea(area, units), perimeter: L(polygonPerimeter(e.points)),
          thickness: L(t.thickness), shape: e.shape || 'flat',
          rise: category === 'roof' ? L(roofRise(e.points, e.shape || 'flat', e.slope ?? 30, t.thickness)) : '',
          comments: e.comments || '',
        },
      };
    });
    Object.assign(totals, { type: `Total: ${rows.length}`, area: formatArea(ta, units) });
  } else {
    throw new Error(`No schedule for ${category}`);
  }
  return { title: SCHEDULES[category], columns, rows, totals };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function scheduleToCSV(schedule) {
  const lines = [schedule.columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of schedule.rows) lines.push(schedule.columns.map((c) => csvCell(r.cells[c.key])).join(','));
  return `${lines.join('\n')}\n`;
}
