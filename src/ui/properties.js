// Properties palette: type selector + instance parameters for the selection,
// or the active view's properties when nothing is selected.

import { h, clear, select as selectEl } from './dom.js';
import {
  CATEGORIES, TYPED_CATEGORIES, getType, getElement, getLevel, sortedLevels, wallLength, wallHeight, elementLevelId, openingExtents,
} from '../core/model.js';
import { setWallLength } from '../core/edit.js';
import { formatLength, formatArea, parseLength } from '../core/units.js';
import { polygonArea, polygonPerimeter } from '../core/geometry.js';
import { ROOF_SHAPES } from '../core/roofgeom.js';
import { regionAt } from '../core/topology.js';

const levelOptions = (doc) => sortedLevels(doc).map((l) => [l.id, l.name]);

/** Parameter definitions: [group, [{ key, label, kind, ... }]] per category. */
function paramsFor(category) {
  const ident = ['Identity Data', [{ key: 'mark', label: 'Mark', kind: 'text' }, { key: 'comments', label: 'Comments', kind: 'text' }]];
  switch (category) {
    case 'wall':
      return [
        ['Constraints', [
          { key: 'levelId', label: 'Base Constraint', kind: 'level' },
          { key: 'baseOffset', label: 'Base Offset', kind: 'length' },
          { key: 'topLevelId', label: 'Top Constraint', kind: 'toplevel' },
          { key: 'height', label: 'Unconnected Height', kind: 'length', enabled: (el) => !el.topLevelId, get: (doc, el) => wallHeight(doc, el) },
          { key: 'topOffset', label: 'Top Offset', kind: 'length', enabled: (el) => !!el.topLevelId },
        ]],
        ['Dimensions', [
          { key: 'length', label: 'Length', kind: 'length', get: (doc, el) => wallLength(el), set: (doc, el, v) => setWallLength(doc, el.id, v) },
          { key: 'thickness', label: 'Width', kind: 'ro', get: (doc, el, u) => formatLength(getType(doc, 'wall', el.typeId).thickness, u) },
          { key: 'area', label: 'Area', kind: 'ro', get: (doc, el, u) => formatArea(wallLength(el) * wallHeight(doc, el), u) },
        ]],
        ident,
      ];
    case 'door':
    case 'window':
      return [
        ['Constraints', [
          { key: 'level', label: 'Level', kind: 'ro', get: (doc, el) => getLevel(doc, elementLevelId(doc, el))?.name ?? '' },
          ...(category === 'window' ? [{ key: 'sill', label: 'Sill Height', kind: 'length', get: (doc, el) => openingExtents(doc, el)?.z0 ?? el.sill }] : []),
          { key: 'offset', label: 'Offset from Wall Start', kind: 'length' },
        ]],
        ['Construction', [
          { key: 'flipFacing', label: 'Flip Facing', kind: 'bool' },
          { key: 'flipHand', label: 'Flip Hand', kind: 'bool' },
        ]],
        ident,
      ];
    case 'floor':
      return [
        ['Constraints', [
          { key: 'levelId', label: 'Level', kind: 'level' },
          { key: 'offset', label: 'Height Offset From Level', kind: 'length' },
        ]],
        ['Dimensions', [
          { key: 'area', label: 'Area', kind: 'ro', get: (doc, el, u) => formatArea(Math.abs(polygonArea(el.points)), u) },
          { key: 'perimeter', label: 'Perimeter', kind: 'ro', get: (doc, el, u) => formatLength(polygonPerimeter(el.points), u) },
        ]],
        ['Identity Data', [{ key: 'comments', label: 'Comments', kind: 'text' }]],
      ];
    case 'roof':
      return [
        ['Constraints', [
          { key: 'levelId', label: 'Base Level', kind: 'level' },
          { key: 'baseOffset', label: 'Base Offset From Level', kind: 'length' },
        ]],
        ['Construction', [
          { key: 'shape', label: 'Roof Shape', kind: 'select', options: ROOF_SHAPES.map((s) => [s, s[0].toUpperCase() + s.slice(1)]) },
          { key: 'slope', label: 'Slope (°)', kind: 'number', enabled: (el) => el.shape && el.shape !== 'flat' },
        ]],
        ['Dimensions', [{ key: 'area', label: 'Footprint Area', kind: 'ro', get: (doc, el, u) => formatArea(Math.abs(polygonArea(el.points)), u) }]],
        ['Identity Data', [{ key: 'comments', label: 'Comments', kind: 'text' }]],
      ];
    case 'room':
      return [
        ['Identity Data', [
          { key: 'number', label: 'Number', kind: 'text' },
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'department', label: 'Department', kind: 'text' },
          { key: 'comments', label: 'Comments', kind: 'text' },
        ]],
        ['Dimensions', [
          { key: 'level', label: 'Level', kind: 'ro', get: (doc, el) => getLevel(doc, el.levelId)?.name ?? '' },
          { key: 'area', label: 'Area', kind: 'ro', get: (doc, el, u) => { const r = regionAt(doc, el.levelId, el.at); return r ? formatArea(polygonArea(r.boundary), u) : 'Not Enclosed'; } },
          { key: 'perimeter', label: 'Perimeter', kind: 'ro', get: (doc, el, u) => { const r = regionAt(doc, el.levelId, el.at); return r ? formatLength(polygonPerimeter(r.boundary), u) : ''; } },
        ]],
      ];
    case 'grid':
      return [['Identity Data', [{ key: 'name', label: 'Name', kind: 'text' }]]];
    case 'dimension':
      return [['Other', [{ key: 'value', label: 'Value', kind: 'ro', get: (doc, el, u) => formatLength(Math.hypot(el.b.x - el.a.x, el.b.y - el.a.y), u) }]]];
    case 'text':
      return [['Text', [{ key: 'text', label: 'Text', kind: 'text' }, { key: 'size', label: 'Text Height', kind: 'length' }]]];
    default:
      return [];
  }
}

function paramValue(doc, el, p, units) {
  return p.get ? p.get(doc, el, units) : el[p.key];
}

function editor(app, p, els, enabled) {
  const doc = app.model.doc;
  const units = doc.info.units;
  const values = els.map((el) => paramValue(doc, el, p, units));
  const same = values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]));
  const value = same ? values[0] : undefined;
  const apply = (v) => {
    app.run(`Modify ${p.label}`, (d) => {
      for (const el of els) {
        const live = getElement(d, el.id);
        if (p.set) p.set(d, live, v);
        else live[p.key] = v;
      }
    });
  };
  const disabled = !enabled;
  switch (p.kind) {
    case 'ro':
      return h('span', {}, same ? String(value ?? '') : '<varies>');
    case 'bool':
      return h('input', { type: 'checkbox', checked: !!value, disabled, onchange: (e) => apply(e.target.checked) });
    case 'level':
      return selectEl(same ? levelOptions(doc) : [['', '<varies>'], ...levelOptions(doc)], value ?? '', { disabled, onchange: (e) => e.target.value && apply(e.target.value) });
    case 'toplevel':
      return selectEl([['', 'Unconnected'], ...levelOptions(doc)], value ?? '', {
        disabled,
        onchange: (e) => apply(e.target.value || null),
      });
    case 'select':
      return selectEl(p.options, value ?? '', { disabled, onchange: (e) => apply(e.target.value) });
    case 'length':
    case 'number':
    case 'text': {
      const shown = !same ? '' : p.kind === 'length' ? formatLength(value ?? 0, units) : String(value ?? '');
      const input = h('input', { type: 'text', value: shown, placeholder: same ? '' : '<varies>', disabled });
      const commit = () => {
        if (input.value === shown) return;
        if (p.kind === 'text') apply(input.value);
        else {
          const v = p.kind === 'length' ? parseLength(input.value, units) : parseFloat(input.value);
          if (!Number.isFinite(v)) {
            app.toast(`${p.label}: enter a valid ${p.kind === 'length' ? 'length' : 'number'}.`, true);
            input.value = shown;
          } else apply(v);
        }
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.value = shown;
          input.blur();
        }
      });
      input.addEventListener('change', commit);
      return input;
    }
    default:
      return h('span', {}, String(value ?? ''));
  }
}

function typeSelector(app, category, typeId, onChange, label) {
  const doc = app.model.doc;
  const types = doc.types[category] || [];
  return h('div', { class: 'prop-type' },
    h('div', { class: 'cat' }, label),
    selectEl(typeId === null ? [['', '<varies>'], ...types.map((t) => [t.id, t.name])] : types.map((t) => [t.id, t.name]), typeId ?? '', {
      onchange: (e) => e.target.value && onChange(e.target.value),
      'aria-label': `${CATEGORIES[category].singular} type`,
    }),
    h('div', { class: 'row' },
      h('span', { style: { color: 'var(--muted)' } }, `${types.length} type${types.length === 1 ? '' : 's'}`),
      h('button', { class: 'btn', onclick: () => app.editTypes(category, typeId || types[0]?.id) }, 'Edit Type…')));
}

function viewProperties(app) {
  const view = app.activeView;
  const doc = app.model.doc;
  const out = [];
  if (!view) return [h('div', { class: 'prop-empty' }, 'Open a view from the Project Browser.')];
  const key = view.key();
  const vs = doc.viewSettings[key] || {};
  const setVS = (patch, name) => app.run(name, (d) => { d.viewSettings[key] = { ...(d.viewSettings[key] || {}), ...patch }; });
  const rows = [['View Name', h('span', {}, view.title())]];
  if (view.kind === 'plan') {
    rows.push(['Associated Level', h('span', {}, getLevel(doc, view.levelId)?.name ?? '')]);
    rows.push(['Scale (approx.)', h('span', {}, `1 : ${view.scaleRatio()}`)]);
    rows.push(['Underlay (level below)', h('input', { type: 'checkbox', checked: vs.underlay !== false, onchange: (e) => setVS({ underlay: e.target.checked }, 'Underlay') })]);
  }
  if (view.kind === '3d' || view.kind === 'elevation') {
    rows.push(['Show Edges', h('input', { type: 'checkbox', checked: vs.edges !== false, onchange: (e) => setVS({ edges: e.target.checked }, 'Visual Style') })]);
    if (view.kind === '3d') rows.push(['Cast Shadows', h('input', { type: 'checkbox', checked: vs.shadows !== false, onchange: (e) => setVS({ shadows: e.target.checked }, 'Shadows') })]);
  }
  if (view.kind !== 'schedule') rows.push(['Visibility/Graphics', h('button', { class: 'btn', onclick: () => app.visibilityDialog() }, 'Edit…')]);
  out.push(h('div', { class: 'prop-type' }, h('div', { class: 'cat' }, view.kind === 'plan' ? 'Floor Plan' : view.kind === '3d' ? '3D View' : view.kind === 'elevation' ? 'Elevation' : 'Schedule')));
  out.push(h('div', { class: 'prop-group' }, 'Graphics'));
  out.push(h('table', { class: 'prop-table' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))));
  out.push(h('div', { class: 'prop-group' }, 'Project'));
  out.push(h('table', { class: 'prop-table' },
    h('tr', {}, h('td', {}, 'Project Name'), h('td', {}, h('span', {}, doc.info.name))),
    h('tr', {}, h('td', {}, 'Units'), h('td', {}, selectEl([['metric', 'Metric (mm)'], ['imperial', 'Imperial (ft-in)']], doc.info.units, {
      onchange: (e) => app.run('Project Units', (d) => { d.info.units = e.target.value; }),
    })))));
  return out;
}

export function renderProperties(app, container) {
  clear(container);
  const doc = app.model.doc;
  const els = [...app.selection].map((id) => getElement(doc, id)).filter(Boolean);

  if (!els.length) {
    const tool = app.tool;
    if (tool?.category && TYPED_CATEGORIES.includes(tool.category)) {
      container.append(typeSelector(app, tool.category, app.currentType(tool.category), (id) => app.setCurrentType(tool.category, id), `New ${CATEGORIES[tool.category].singular}`));
      container.append(h('div', { class: 'prop-empty' }, tool.prompt));
      return;
    }
    container.append(...viewProperties(app));
    return;
  }

  const cats = new Set(els.map((e) => e.category));
  if (cats.size > 1) {
    const counts = [...cats].map((c) => `${els.filter((e) => e.category === c).length} ${CATEGORIES[c].label}`);
    container.append(h('div', { class: 'prop-type' }, h('div', { class: 'cat' }, `Multiple Categories (${els.length})`)),
      h('div', { class: 'prop-empty' }, counts.join(', '), h('br'), 'Select elements of a single category to edit their parameters.'));
    return;
  }
  const category = [...cats][0];
  const label = els.length > 1 ? `${CATEGORIES[category].label} (${els.length})` : CATEGORIES[category].singular;
  if (TYPED_CATEGORIES.includes(category)) {
    const typeIds = new Set(els.map((e) => e.typeId));
    container.append(typeSelector(app, category, typeIds.size === 1 ? els[0].typeId : null, (typeId) => {
      app.run('Change Type', (d) => {
        for (const el of els) getElement(d, el.id).typeId = typeId;
      });
    }, label));
  } else {
    container.append(h('div', { class: 'prop-type' }, h('div', { class: 'cat' }, label)));
  }
  for (const [group, params] of paramsFor(category)) {
    container.append(h('div', { class: 'prop-group' }, group));
    container.append(h('table', { class: 'prop-table' }, params.map((p) => {
      const enabled = els.every((el) => (p.enabled ? p.enabled(el) : true));
      const cell = h('td', { class: p.kind === 'ro' ? 'ro' : '' }, editor(app, p, els, enabled));
      return h('tr', {}, h('td', { title: p.label }, p.label), cell);
    })));
  }
}
