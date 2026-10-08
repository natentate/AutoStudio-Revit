// Project management dialogs: type properties, levels, project information,
// visibility/graphics and About.

import { h, clear, select as selectEl } from './dom.js';
import { openModal, formDialog, confirmDialog } from './dialogs.js';
import { LOGO } from './icons.js';
import { CATEGORIES, TYPE_FIELDS, TYPED_CATEGORIES, getType, sortedLevels } from '../core/model.js';
import { formatLength, parseLength } from '../core/units.js';

/** Type Properties: pick a type, edit its fields, duplicate / rename / delete. */
export async function typesDialog(app, category = 'wall', typeId = null) {
  let cat = category;
  let current = typeId || app.model.doc.types[cat][0].id;
  const body = h('div', {});
  const err = h('div', { style: { color: 'var(--danger)', minHeight: '14px' } });

  const render = () => {
    const doc = app.model.doc;
    const units = doc.info.units;
    if (!doc.types[cat].some((t) => t.id === current)) current = doc.types[cat][0].id;
    const type = getType(doc, cat, current);
    const list = h('div', { class: 'list' }, doc.types[cat].map((t) => h('div', {
      class: t.id === current ? 'on' : '',
      onclick: () => { current = t.id; render(); },
    }, t.name)));
    const used = doc.elements.filter((e) => e.category === cat && e.typeId === current).length;
    const rows = TYPE_FIELDS[cat].map(([key, label, kind]) => {
      let input;
      const commit = (v) => {
        try {
          app.run('Edit Type', (d) => { getType(d, cat, current)[key] = v; });
          err.textContent = '';
        } catch (e) {
          err.textContent = e.message;
        }
      };
      if (Array.isArray(kind)) input = selectEl(kind.map((k) => [k, k]), type[key], { onchange: (e) => commit(e.target.value) });
      else if (kind === 'color') input = h('input', { type: 'color', value: type[key], onchange: (e) => commit(e.target.value) });
      else {
        input = h('input', {
          type: 'text', value: formatLength(type[key], units),
          onchange: (e) => {
            const v = parseLength(e.target.value, units);
            if (!(v > 0)) {
              err.textContent = `${label}: enter a positive length.`;
              e.target.value = formatLength(type[key], units);
            } else commit(v);
          },
        });
      }
      return h('tr', {}, h('td', {}, label), h('td', {}, input));
    });
    const nameInput = h('input', {
      type: 'text', value: type.name,
      onchange: (e) => {
        const name = e.target.value.trim();
        if (!name) {
          e.target.value = type.name;
          return;
        }
        app.run('Rename Type', (d) => { getType(d, cat, current).name = name; });
        render();
      },
    });
    clear(body).append(
      h('label', { class: 'field' }, h('span', {}, 'Category'), selectEl(TYPED_CATEGORIES.map((c) => [c, CATEGORIES[c].label]), cat, {
        onchange: (e) => { cat = e.target.value; current = app.model.doc.types[cat][0].id; render(); },
      })),
      h('div', { class: 'twocol' },
        h('div', { style: { display: 'grid', gap: '6px', alignContent: 'start' } }, list,
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn', onclick: () => { const t = app.run('Duplicate Type', () => app.model.duplicateType(cat, current)); if (t) current = t.id; render(); } }, 'Duplicate'),
            h('button', {
              class: 'btn danger',
              onclick: async () => {
                if (!(await confirmDialog('Delete Type', `Delete the type “${type.name}”?`, 'Delete', true))) return;
                app.run('Delete Type', () => app.model.deleteType(cat, current));
                render();
              },
            }, 'Delete'))),
        h('div', { style: { display: 'grid', gap: '8px', alignContent: 'start' } },
          h('label', { class: 'field' }, h('span', {}, 'Type Name'), nameInput),
          h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Parameter'), h('th', {}, 'Value'))), h('tbody', {}, rows)),
          h('div', { style: { color: 'var(--muted)' } }, `${used} instance${used === 1 ? '' : 's'} in the project use this type.`),
          err)),
    );
  };
  render();
  await openModal({ title: 'Type Properties', body, buttons: [{ label: 'Done', value: true, primary: true }], width: '720px' });
}

/** Levels: rename, set elevations, add and delete. */
export async function levelsDialog(app) {
  const body = h('div', {});
  const err = h('div', { style: { color: 'var(--danger)', minHeight: '14px' } });
  const render = () => {
    const doc = app.model.doc;
    const units = doc.info.units;
    const rows = sortedLevels(doc).map((l) => h('tr', {},
      h('td', {}, h('input', {
        type: 'text', value: l.name,
        onchange: (e) => { if (e.target.value.trim()) app.run('Rename Level', (d) => { d.levels.find((x) => x.id === l.id).name = e.target.value.trim(); }); render(); },
      })),
      h('td', {}, h('input', {
        type: 'text', value: formatLength(l.elevation, units),
        onchange: (e) => {
          const v = parseLength(e.target.value, units);
          if (!Number.isFinite(v)) err.textContent = 'Enter a valid elevation.';
          else {
            err.textContent = '';
            app.run('Level Elevation', (d) => { d.levels.find((x) => x.id === l.id).elevation = v; });
          }
          render();
        },
      })),
      h('td', {}, h('button', {
        class: 'btn danger',
        onclick: async () => {
          const n = doc.elements.filter((e) => e.levelId === l.id).length;
          const ok = await confirmDialog('Delete Level', n ? `Deleting “${l.name}” also deletes the ${n} element(s) on it.` : `Delete “${l.name}”?`, 'Delete', true);
          if (!ok) return;
          app.run('Delete Level', () => app.model.deleteLevel(l.id));
          app.closeViewsForMissingLevels();
          render();
        },
      }, 'Delete'))));
    clear(body).append(
      h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, `Elevation (${units === 'imperial' ? 'ft-in' : 'mm'})`), h('th', {}))), h('tbody', {}, rows)),
      h('div', { class: 'row-actions' }, h('button', { class: 'btn', onclick: () => { addLevel(app).then(render); } }, 'Add Level…')),
      err,
    );
  };
  render();
  await openModal({ title: 'Levels', body, buttons: [{ label: 'Done', value: true, primary: true }], width: '560px' });
}

export async function addLevel(app) {
  const doc = app.model.doc;
  const levels = sortedLevels(doc);
  const top = levels[levels.length - 1];
  const r = await formDialog('New Level', [
    { key: 'name', label: 'Name', kind: 'text', value: `Level ${levels.length + 1}`, required: true },
    { key: 'elevation', label: 'Elevation', kind: 'length', value: (top?.elevation ?? 0) + 3000 },
  ], { okLabel: 'Create', units: doc.info.units });
  if (!r) return null;
  const level = app.run('Create Level', () => app.model.addLevel(r.name.trim(), r.elevation));
  return level;
}

export async function projectInfoDialog(app) {
  const info = app.model.doc.info;
  const r = await formDialog('Project Information', [
    { key: 'name', label: 'Project Name', kind: 'text', value: info.name, required: true },
    { key: 'number', label: 'Project Number', kind: 'text', value: info.number },
    { key: 'client', label: 'Client Name', kind: 'text', value: info.client },
    { key: 'address', label: 'Project Address', kind: 'text', value: info.address },
    { key: 'author', label: 'Author', kind: 'text', value: info.author },
    { key: 'units', label: 'Units', kind: 'select', value: info.units, options: [['metric', 'Metric (mm)'], ['imperial', 'Imperial (ft-in)']] },
  ]);
  if (r) app.run('Project Information', (doc) => Object.assign(doc.info, r));
}

export async function visibilityDialog(app) {
  const view = app.activeView;
  if (!view || view.kind === 'schedule') return;
  const key = view.key();
  const hidden = new Set(app.model.doc.viewSettings[key]?.hidden || []);
  const cats = Object.keys(CATEGORIES).filter((c) => view.kind === 'plan' || ['wall', 'door', 'window', 'floor', 'roof'].includes(c));
  const boxes = cats.map((c) => {
    const cb = h('input', { type: 'checkbox', checked: !hidden.has(c) });
    cb.dataset.cat = c;
    return h('label', {}, cb, CATEGORIES[c].label);
  });
  const ok = await openModal({
    title: `Visibility/Graphics — ${view.title()}`,
    body: [h('div', { class: 'msg' }, 'Choose which model and annotation categories are visible in this view.'), h('div', { class: 'cats' }, boxes)],
    buttons: [{ label: 'Cancel', value: false }, { label: 'OK', value: true, primary: true }],
  });
  if (!ok) return;
  const nextHidden = boxes.map((b) => b.querySelector('input')).filter((cb) => !cb.checked).map((cb) => cb.dataset.cat);
  app.run('Visibility/Graphics', (doc) => { doc.viewSettings[key] = { ...(doc.viewSettings[key] || {}), hidden: nextHidden }; });
}

export function aboutDialog(version) {
  return openModal({
    title: 'About AutoStudio',
    body: h('div', { class: 'about' },
      h('div', { class: 'logo', html: LOGO }),
      h('div', { style: { fontSize: '16px', fontWeight: 600 } }, 'AutoStudio'),
      h('div', {}, `Version ${version}`),
      h('div', { style: { color: 'var(--muted)' } }, 'Building information modeling for macOS.'),
      h('div', { style: { color: 'var(--muted)', marginTop: '8px' } }, 'Walls, doors, windows, floors, roofs, rooms, levels, grids, schedules and IFC4 export.')),
  });
}

export function shortcutsDialog(shortcuts) {
  return openModal({
    title: 'Keyboard Shortcuts',
    body: h('table', { class: 'grid' }, h('tbody', {}, shortcuts.map(([k, d]) => h('tr', {}, h('td', { style: { fontFamily: 'var(--mono)', width: '110px' } }, k), h('td', {}, d))))),
    width: '520px',
  });
}
