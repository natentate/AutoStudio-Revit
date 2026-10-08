// Project document, element types and the transactional model with undo/redo.
//
// The document is plain JSON so it can be saved as-is (.asbim files) and
// snapshotted for undo. All lengths are millimetres; angles are degrees.

export const FILE_FORMAT = 'autostudio-bim';
export const FILE_VERSION = 1;

export const CATEGORIES = {
  wall: { label: 'Walls', singular: 'Wall' },
  door: { label: 'Doors', singular: 'Door' },
  window: { label: 'Windows', singular: 'Window' },
  floor: { label: 'Floors', singular: 'Floor' },
  roof: { label: 'Roofs', singular: 'Roof' },
  room: { label: 'Rooms', singular: 'Room' },
  grid: { label: 'Grids', singular: 'Grid' },
  dimension: { label: 'Dimensions', singular: 'Dimension' },
  text: { label: 'Text Notes', singular: 'Text Note' },
};

/** Categories that carry a family type. */
export const TYPED_CATEGORIES = ['wall', 'door', 'window', 'floor', 'roof'];

/** Editable fields for each type category: [key, label, kind]. */
export const TYPE_FIELDS = {
  wall: [
    ['thickness', 'Thickness', 'length'],
    ['color', 'Material Color', 'color'],
    ['function', 'Function', ['Exterior', 'Interior', 'Foundation', 'Retaining']],
  ],
  door: [
    ['width', 'Width', 'length'],
    ['height', 'Height', 'length'],
    ['leaves', 'Leaves', ['1', '2']],
    ['color', 'Panel Color', 'color'],
  ],
  window: [
    ['width', 'Width', 'length'],
    ['height', 'Height', 'length'],
    ['defaultSill', 'Default Sill Height', 'length'],
    ['color', 'Frame Color', 'color'],
  ],
  floor: [
    ['thickness', 'Thickness', 'length'],
    ['color', 'Material Color', 'color'],
  ],
  roof: [
    ['thickness', 'Thickness', 'length'],
    ['color', 'Material Color', 'color'],
  ],
};

export function defaultTypes() {
  return {
    wall: [
      { id: 'WT1', name: 'Generic - 200mm', thickness: 200, color: '#c9c4bb', function: 'Exterior' },
      { id: 'WT2', name: 'Exterior - Brick on Block 300mm', thickness: 300, color: '#b8735a', function: 'Exterior' },
      { id: 'WT3', name: 'Interior - 100mm Partition', thickness: 100, color: '#e6e3dc', function: 'Interior' },
      { id: 'WT4', name: 'Basic Wall - Concrete 250mm', thickness: 250, color: '#a7a9ac', function: 'Exterior' },
    ],
    door: [
      { id: 'DT1', name: 'Single Flush 900 x 2100', width: 900, height: 2100, leaves: '1', color: '#9c6b43' },
      { id: 'DT2', name: 'Single Flush 800 x 2100', width: 800, height: 2100, leaves: '1', color: '#9c6b43' },
      { id: 'DT3', name: 'Double Glass 1800 x 2100', width: 1800, height: 2100, leaves: '2', color: '#6c7a89' },
    ],
    window: [
      { id: 'NT1', name: 'Fixed 1200 x 1500', width: 1200, height: 1500, defaultSill: 900, color: '#3d4a57' },
      { id: 'NT2', name: 'Fixed 900 x 1200', width: 900, height: 1200, defaultSill: 900, color: '#3d4a57' },
      { id: 'NT3', name: 'Casement 600 x 900', width: 600, height: 900, defaultSill: 1200, color: '#f2f2f2' },
      { id: 'NT4', name: 'Picture 2400 x 2100', width: 2400, height: 2100, defaultSill: 300, color: '#3d4a57' },
    ],
    floor: [
      { id: 'FT1', name: 'Generic - 300mm', thickness: 300, color: '#bdb8ad' },
      { id: 'FT2', name: 'Concrete Slab - 200mm', thickness: 200, color: '#a7a9ac' },
      { id: 'FT3', name: 'Timber Floor - 250mm', thickness: 250, color: '#c49a6c' },
    ],
    roof: [
      { id: 'RT1', name: 'Generic - 300mm', thickness: 300, color: '#7a4e3a' },
      { id: 'RT2', name: 'Metal Standing Seam - 150mm', thickness: 150, color: '#5f6b73' },
    ],
  };
}

export function createEmptyProject(name = 'Project 1') {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    nextId: 1,
    info: { name, number: '0001', client: '', address: '', author: '', units: 'metric' },
    levels: [
      { id: 'L1', name: 'Level 1', elevation: 0 },
      { id: 'L2', name: 'Level 2', elevation: 3000 },
    ],
    types: defaultTypes(),
    elements: [],
    viewSettings: {},
  };
}

/** Validate and upgrade a parsed document. Throws on files that are not projects. */
export function normalizeDocument(doc) {
  if (!doc || typeof doc !== 'object' || doc.format !== FILE_FORMAT) {
    throw new Error('This file is not an AutoStudio project.');
  }
  if (doc.version > FILE_VERSION) {
    throw new Error(`This project was saved by a newer version of AutoStudio (format ${doc.version}).`);
  }
  const base = createEmptyProject();
  const out = {
    ...base,
    ...doc,
    info: { ...base.info, ...(doc.info || {}) },
    types: { ...base.types, ...(doc.types || {}) },
    levels: Array.isArray(doc.levels) && doc.levels.length ? doc.levels : base.levels,
    elements: Array.isArray(doc.elements) ? doc.elements : [],
    viewSettings: doc.viewSettings || {},
  };
  for (const cat of TYPED_CATEGORIES) if (!Array.isArray(out.types[cat]) || !out.types[cat].length) out.types[cat] = base.types[cat];
  // Make sure nextId is above every numeric id in use.
  let maxId = 0;
  for (const e of out.elements) {
    const n = parseInt(String(e.id).replace(/^\D+/, ''), 10);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
  }
  out.nextId = Math.max(out.nextId || 1, maxId + 1);
  return out;
}

// ---------------------------------------------------------------------------
// Document queries (pure functions on the plain document)

export function sortedLevels(doc) {
  return [...doc.levels].sort((a, b) => a.elevation - b.elevation);
}

export function getLevel(doc, id) {
  return doc.levels.find((l) => l.id === id) || null;
}

export function levelAbove(doc, levelId) {
  const levels = sortedLevels(doc);
  const i = levels.findIndex((l) => l.id === levelId);
  return i >= 0 && i < levels.length - 1 ? levels[i + 1] : null;
}

export function levelBelow(doc, levelId) {
  const levels = sortedLevels(doc);
  const i = levels.findIndex((l) => l.id === levelId);
  return i > 0 ? levels[i - 1] : null;
}

export function getType(doc, category, typeId) {
  const list = doc.types[category] || [];
  return list.find((t) => t.id === typeId) || list[0] || null;
}

export function getElement(doc, id) {
  return doc.elements.find((e) => e.id === id) || null;
}

export function elementsOfCategory(doc, category) {
  return doc.elements.filter((e) => e.category === category);
}

export function hostedElements(doc, wallId) {
  return doc.elements.filter((e) => e.hostId === wallId);
}

/** The level an element belongs to (hosted elements inherit from their host). */
export function elementLevelId(doc, el) {
  if (el.levelId) return el.levelId;
  if (el.hostId) {
    const host = getElement(doc, el.hostId);
    return host ? host.levelId : null;
  }
  return null;
}

export function wallHeight(doc, wall) {
  if (wall.topLevelId) {
    const base = getLevel(doc, wall.levelId);
    const top = getLevel(doc, wall.topLevelId);
    if (base && top && top.elevation + (wall.topOffset || 0) > base.elevation + (wall.baseOffset || 0)) {
      return top.elevation + (wall.topOffset || 0) - base.elevation - (wall.baseOffset || 0);
    }
  }
  return wall.height || 3000;
}

export function wallLength(wall) {
  return Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
}

/** Opening (door/window) extents along and up its host wall, clamped to the wall. */
export function openingExtents(doc, el) {
  const host = getElement(doc, el.hostId);
  const type = getType(doc, el.category, el.typeId);
  if (!host || !type) return null;
  const L = wallLength(host);
  const H = wallHeight(doc, host);
  const w = Math.min(type.width, L);
  const center = Math.max(w / 2, Math.min(L - w / 2, el.offset));
  const z0 = el.category === 'window' ? Math.max(0, el.sill ?? type.defaultSill ?? 900) : 0;
  const z1 = Math.min(H, z0 + type.height);
  return { u0: center - w / 2, u1: center + w / 2, center, z0, z1, width: w, height: z1 - z0 };
}

/** Next unused door/window mark, e.g. D01, W03. */
export function nextMark(doc, category) {
  const prefix = category === 'door' ? 'D' : 'W';
  let n = 0;
  for (const e of elementsOfCategory(doc, category)) {
    const m = String(e.mark || '').match(/^\D*(\d+)$/);
    if (m) n = Math.max(n, parseInt(m[1], 10));
  }
  return `${prefix}${String(n + 1).padStart(2, '0')}`;
}

export function nextRoomNumber(doc, levelId) {
  const level = sortedLevels(doc).findIndex((l) => l.id === levelId) + 1;
  let n = 0;
  for (const r of elementsOfCategory(doc, 'room')) {
    if (r.levelId !== levelId) continue;
    const v = parseInt(r.number, 10);
    if (Number.isFinite(v)) n = Math.max(n, v % 100);
  }
  return String(Math.max(1, level) * 100 + n + 1);
}

export function nextGridName(doc, vertical) {
  const grids = elementsOfCategory(doc, 'grid');
  if (vertical) {
    let n = 0;
    for (const g of grids) if (/^\d+$/.test(g.name)) n = Math.max(n, parseInt(g.name, 10));
    return String(n + 1);
  }
  let max = -1;
  for (const g of grids) if (/^[A-Z]$/.test(g.name)) max = Math.max(max, g.name.charCodeAt(0) - 65);
  return String.fromCharCode(65 + Math.min(25, max + 1));
}

// ---------------------------------------------------------------------------
// Transactional model

const MAX_UNDO = 200;

export class Model {
  constructor(doc = createEmptyProject()) {
    this.doc = normalizeDocument(doc);
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.rev = 0;
    this.revCounter = 0;
    this.savedRev = 0;
    this.activeTx = null;
  }

  static fromJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('The project file is damaged or is not valid JSON.');
    }
    return new Model(parsed);
  }

  toJSON() {
    return JSON.stringify(this.doc, null, 1);
  }

  get dirty() {
    return this.rev !== this.savedRev;
  }

  markSaved() {
    this.savedRev = this.rev;
    this.emit({ type: 'saved' });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(evt) {
    for (const fn of this.listeners) fn(evt);
  }

  /** Run `fn(doc, model)` as one undoable step. Rolls back if it throws. */
  transact(name, fn) {
    if (this.activeTx) return fn(this.doc, this);
    const before = JSON.stringify(this.doc);
    this.activeTx = name;
    let result;
    try {
      result = fn(this.doc, this);
    } catch (err) {
      this.doc = JSON.parse(before);
      this.activeTx = null;
      throw err;
    }
    this.activeTx = null;
    if (JSON.stringify(this.doc) === before) return result;
    this.undoStack.push({ name, snapshot: before, rev: this.rev });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.rev = ++this.revCounter;
    this.emit({ type: 'change', name });
    return result;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ name: entry.name, snapshot: JSON.stringify(this.doc), rev: this.rev });
    this.doc = JSON.parse(entry.snapshot);
    this.rev = entry.rev;
    this.emit({ type: 'change', name: `Undo ${entry.name}` });
    return entry.name;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ name: entry.name, snapshot: JSON.stringify(this.doc), rev: this.rev });
    this.doc = JSON.parse(entry.snapshot);
    this.rev = entry.rev;
    this.emit({ type: 'change', name: `Redo ${entry.name}` });
    return entry.name;
  }

  newId(prefix = 'E') {
    const id = `${prefix}${this.doc.nextId}`;
    this.doc.nextId += 1;
    return id;
  }

  get(id) {
    return getElement(this.doc, id);
  }

  // --- element operations (each is its own transaction unless nested) ---

  addElement(props) {
    return this.transact(`Create ${CATEGORIES[props.category]?.singular ?? 'Element'}`, (doc) => {
      const el = { ...props, id: this.newId() };
      doc.elements.push(el);
      return el;
    });
  }

  updateElement(id, patch, name = 'Modify') {
    return this.transact(name, (doc) => {
      const el = getElement(doc, id);
      if (!el) throw new Error(`Element ${id} not found`);
      Object.assign(el, patch);
      return el;
    });
  }

  /** Delete elements and anything hosted by them. Returns the ids removed. */
  deleteElements(ids, name = 'Delete') {
    return this.transact(name, (doc) => {
      const remove = new Set(ids);
      for (const e of doc.elements) if (e.hostId && remove.has(e.hostId)) remove.add(e.id);
      doc.elements = doc.elements.filter((e) => !remove.has(e.id));
      return [...remove];
    });
  }

  addLevel(name, elevation) {
    return this.transact('Create Level', (doc) => {
      const level = { id: this.newId('L'), name, elevation };
      doc.levels.push(level);
      return level;
    });
  }

  /** Delete a level and every element on it. Refuses to delete the last level. */
  deleteLevel(levelId) {
    return this.transact('Delete Level', (doc) => {
      if (doc.levels.length <= 1) throw new Error('A project needs at least one level.');
      for (const e of doc.elements) if (e.topLevelId === levelId) {
        e.height = wallHeight(doc, e);
        e.topLevelId = null;
      }
      doc.levels = doc.levels.filter((l) => l.id !== levelId);
      const removed = new Set(doc.elements.filter((e) => e.levelId === levelId).map((e) => e.id));
      for (const e of doc.elements) if (e.hostId && removed.has(e.hostId)) removed.add(e.id);
      doc.elements = doc.elements.filter((e) => !removed.has(e.id));
    });
  }

  duplicateType(category, typeId) {
    return this.transact('Duplicate Type', (doc) => {
      const src = getType(doc, category, typeId);
      const names = new Set(doc.types[category].map((t) => t.name));
      let name = `${src.name} 2`;
      for (let i = 3; names.has(name); i++) name = `${src.name} ${i}`;
      const t = { ...src, id: this.newId(`${category[0].toUpperCase()}T`), name };
      doc.types[category].push(t);
      return t;
    });
  }

  deleteType(category, typeId) {
    return this.transact('Delete Type', (doc) => {
      if (doc.types[category].length <= 1) throw new Error('Each category needs at least one type.');
      if (doc.elements.some((e) => e.category === category && e.typeId === typeId)) {
        throw new Error('This type is in use. Change the elements using it first.');
      }
      doc.types[category] = doc.types[category].filter((t) => t.id !== typeId);
    });
  }
}
