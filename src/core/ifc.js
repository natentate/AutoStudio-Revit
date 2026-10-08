// IFC4 (ISO 10303-21 / STEP) export of the building model.

import { sortedLevels, getType, wallHeight, openingExtents, elementsOfCategory } from './model.js';
import { wallFootprints } from './wallgeom.js';
import { regionAt } from './topology.js';
import { ensureCCW, polygonArea, sub, norm } from './geometry.js';
import { pitchedRoofFaces } from './roofgeom.js';

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** A new IFC GlobalId: 128 random bits in IFC's 22-character base64. */
export function ifcGuid(random = Math.random) {
  const bytes = [];
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 22; i++) {
    s = B64[Number(n & 63n)] + s;
    n >>= 6n;
  }
  return s;
}

/** Encode a string as a STEP string literal (with \X2\ escapes for non-ASCII). */
export function stepString(value) {
  if (value === null || value === undefined) return '$';
  let out = '';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (code >= 32 && code < 127) out += ch;
    else if (code <= 0xffff) out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else out += `\\X4\\${code.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }
  return `'${out}'`;
}

const num = (v) => {
  const r = Math.round(v * 1e4) / 1e4;
  const s = String(r);
  return s.includes('.') || s.includes('e') ? s : `${s}.`;
};

class StepWriter {
  constructor() {
    this.lines = [];
    this.id = 0;
  }
  add(entity) {
    this.id += 1;
    this.lines.push(`#${this.id}=${entity};`);
    return `#${this.id}`;
  }
  point3(x, y, z) {
    return this.add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  }
  point2(x, y) {
    return this.add(`IFCCARTESIANPOINT((${num(x)},${num(y)}))`);
  }
  dir3(x, y, z) {
    return this.add(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
  }
  placement3(origin = [0, 0, 0], xDir = null) {
    const o = this.point3(...origin);
    if (!xDir) return this.add(`IFCAXIS2PLACEMENT3D(${o},$,$)`);
    const z = this.dir3(0, 0, 1);
    const x = this.dir3(xDir[0], xDir[1], 0);
    return this.add(`IFCAXIS2PLACEMENT3D(${o},${z},${x})`);
  }
  localPlacement(relTo, origin, xDir) {
    return this.add(`IFCLOCALPLACEMENT(${relTo ?? '$'},${this.placement3(origin, xDir)})`);
  }
  polyline2(pts) {
    const refs = pts.map((p) => this.point2(p.x, p.y));
    refs.push(refs[0]);
    return this.add(`IFCPOLYLINE((${refs.join(',')}))`);
  }
}

/**
 * Export the document as IFC4 text.
 * @param {object} doc project document
 * @param {object} [opts] { random, timestamp } for deterministic output in tests
 */
export function exportIFC(doc, opts = {}) {
  const random = opts.random ?? Math.random;
  const guid = () => ifcGuid(random);
  const w = new StepWriter();
  const S = stepString;
  const app = 'AutoStudio';

  // Units, context and spatial structure.
  const lenUnit = w.add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const areaUnit = w.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const volUnit = w.add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const angUnit = w.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = w.add(`IFCUNITASSIGNMENT((${lenUnit},${areaUnit},${volUnit},${angUnit}))`);
  const worldPl = w.placement3([0, 0, 0]);
  const north = w.add('IFCDIRECTION((0.,1.))');
  const ctx = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${worldPl},${north})`);
  const body = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const project = w.add(`IFCPROJECT('${guid()}',$,${S(doc.info.name)},${S(doc.info.address || null)},$,$,$,(${ctx}),${units})`);

  const sitePl = w.localPlacement(null, [0, 0, 0]);
  const site = w.add(`IFCSITE('${guid()}',$,'Default Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldgPl = w.localPlacement(sitePl, [0, 0, 0]);
  const building = w.add(`IFCBUILDING('${guid()}',$,${S(doc.info.name)},$,$,${bldgPl},$,$,.ELEMENT.,$,$,$)`);
  w.add(`IFCRELAGGREGATES('${guid()}',$,$,$,${project},(${site}))`);
  w.add(`IFCRELAGGREGATES('${guid()}',$,$,$,${site},(${building}))`);

  const shape = (items, type = 'SweptSolid') => {
    const rep = w.add(`IFCSHAPEREPRESENTATION(${body},'Body',${S(type)},(${items.join(',')}))`);
    return w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  const extrudePolygon = (pts, depth, z = 0) => {
    const profile = w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${w.polyline2(pts)})`);
    const pos = w.placement3([0, 0, z]);
    const up = w.dir3(0, 0, 1);
    return w.add(`IFCEXTRUDEDAREASOLID(${profile},${pos},${up},${num(depth)})`);
  };
  const extrudeBox = (x0, y0, x1, y1, z0, z1) => extrudePolygon(
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], z1 - z0, z0,
  );

  const levels = sortedLevels(doc);
  const storeys = [];
  const storeyEntities = new Map();
  levels.forEach((level, i) => {
    const pl = w.localPlacement(bldgPl, [0, 0, level.elevation]);
    const storey = w.add(`IFCBUILDINGSTOREY('${guid()}',$,${S(level.name)},$,$,${pl},$,$,.ELEMENT.,${num(level.elevation)})`);
    storeys.push(storey);
    const next = levels[i + 1];
    storeyEntities.set(level.id, { storey, pl, contained: [], spaces: [], height: next ? next.elevation - level.elevation : 3000 });
  });
  w.add(`IFCRELAGGREGATES('${guid()}',$,$,$,${building},(${storeys.join(',')}))`);

  for (const level of levels) {
    const st = storeyEntities.get(level.id);
    const footprints = wallFootprints(doc, level.id);

    // Walls with their openings, doors and windows.
    for (const wall of doc.elements.filter((e) => e.category === 'wall' && e.levelId === level.id)) {
      const fp = footprints.get(wall.id);
      if (!fp) continue;
      const type = getType(doc, 'wall', wall.typeId);
      const H = wallHeight(doc, wall);
      const d = norm(sub(wall.b, wall.a));
      const base = wall.baseOffset || 0;
      const wallPl = w.localPlacement(st.pl, [wall.a.x, wall.a.y, base], [d.x, d.y]);
      // Footprint in the wall's local frame (x along the wall, y to its left).
      const local = fp.poly.map((p) => {
        const r = sub(p, wall.a);
        return { x: r.x * d.x + r.y * d.y, y: -r.x * d.y + r.y * d.x };
      });
      const solid = extrudePolygon(ensureCCW(local), H);
      const wallEnt = w.add(`IFCWALL('${guid()}',$,${S(type.name)},$,${S(type.name)},${wallPl},${shape([solid])},${S(wall.id)},.STANDARD.)`);
      st.contained.push(wallEnt);

      for (const el of doc.elements.filter((e) => e.hostId === wall.id)) {
        const ex = openingExtents(doc, el);
        if (!ex) continue;
        const t = fp.frame.t;
        const opPl = w.localPlacement(wallPl, [0, 0, 0]);
        const opSolid = extrudeBox(ex.u0, -t, ex.u1, t, ex.z0, ex.z1);
        const opening = w.add(`IFCOPENINGELEMENT('${guid()}',$,'Opening',$,$,${opPl},${shape([opSolid])},$,.OPENING.)`);
        w.add(`IFCRELVOIDSELEMENT('${guid()}',$,$,$,${wallEnt},${opening})`);
        const et = getType(doc, el.category, el.typeId);
        const fillPl = w.localPlacement(wallPl, [0, 0, 0]);
        const depth = el.category === 'door' ? 50 : 80;
        const fillSolid = extrudeBox(ex.u0, -depth / 2, ex.u1, depth / 2, ex.z0, ex.z1);
        const tag = S(el.mark || el.id);
        let fill;
        if (el.category === 'door') {
          fill = w.add(`IFCDOOR('${guid()}',$,${S(et.name)},$,${S(et.name)},${fillPl},${shape([fillSolid])},${tag},${num(ex.height)},${num(ex.width)},.DOOR.,${et.leaves === '2' ? '.DOUBLE_DOOR_SINGLE_SWING.' : '.SINGLE_SWING_LEFT.'},$)`);
        } else {
          fill = w.add(`IFCWINDOW('${guid()}',$,${S(et.name)},$,${S(et.name)},${fillPl},${shape([fillSolid])},${tag},${num(ex.height)},${num(ex.width)},.WINDOW.,.SINGLE_PANEL.,$)`);
        }
        w.add(`IFCRELFILLSELEMENT('${guid()}',$,$,$,${opening},${fill})`);
        st.contained.push(fill);
      }
    }

    // Floors (slabs) hang below their level.
    for (const fl of doc.elements.filter((e) => e.category === 'floor' && e.levelId === level.id)) {
      const type = getType(doc, 'floor', fl.typeId);
      const pl = w.localPlacement(st.pl, [0, 0, (fl.offset || 0) - type.thickness]);
      const solid = extrudePolygon(ensureCCW(fl.points), type.thickness);
      st.contained.push(w.add(`IFCSLAB('${guid()}',$,${S(type.name)},$,${S(type.name)},${pl},${shape([solid])},${S(fl.id)},.FLOOR.)`));
    }

    // Roofs.
    for (const rf of doc.elements.filter((e) => e.category === 'roof' && e.levelId === level.id)) {
      const type = getType(doc, 'roof', rf.typeId);
      const pl = w.localPlacement(st.pl, [0, 0, rf.baseOffset || 0]);
      let rep;
      let predefined = '.FLAT_ROOF.';
      if (rf.shape === 'flat' || !rf.shape) {
        rep = shape([extrudePolygon(ensureCCW(rf.points), type.thickness)]);
      } else {
        predefined = rf.shape === 'hip' ? '.HIP_ROOF.' : rf.shape === 'shed' ? '.SHED_ROOF.' : '.GABLE_ROOF.';
        const faces = pitchedRoofFaces(rf.points, rf.shape, rf.slope ?? 30).map((f) => {
          const loop = w.add(`IFCPOLYLOOP((${f.map((p) => w.point3(p.x, p.y, p.z)).join(',')}))`);
          const bound = w.add(`IFCFACEOUTERBOUND(${loop},.T.)`);
          return w.add(`IFCFACE((${bound}))`);
        });
        const shell = w.add(`IFCCLOSEDSHELL((${faces.join(',')}))`);
        rep = shape([w.add(`IFCFACETEDBREP(${shell})`)], 'Brep');
      }
      st.contained.push(w.add(`IFCROOF('${guid()}',$,${S(type.name)},$,${S(type.name)},${pl},${rep},${S(rf.id)},${predefined})`));
    }

    // Rooms become spaces.
    for (const room of elementsOfCategory(doc, 'room').filter((r) => r.levelId === level.id)) {
      const region = regionAt(doc, level.id, room.at);
      if (!region || polygonArea(region.boundary) <= 0) continue;
      const pl = w.localPlacement(st.pl, [0, 0, 0]);
      const solid = extrudePolygon(region.boundary, room.height || st.height);
      st.spaces.push(w.add(`IFCSPACE('${guid()}',$,${S(room.number)},$,$,${pl},${shape([solid])},${S(room.name)},.ELEMENT.,.INTERNAL.,$)`));
    }

    if (st.contained.length) {
      w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',$,$,$,(${st.contained.join(',')}),${st.storey})`);
    }
    if (st.spaces.length) {
      w.add(`IFCRELAGGREGATES('${guid()}',$,$,$,${st.storey},(${st.spaces.join(',')}))`);
    }
  }

  const ts = (opts.timestamp ?? new Date()).toISOString().slice(0, 19);
  const fileName = `${doc.info.name || 'project'}.ifc`;
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${S(fileName)},'${ts}',(${S(doc.info.author || '')}),(${S(doc.info.client || '')}),${S(app)},${S(app)},'');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...w.lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
