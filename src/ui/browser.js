// Project Browser tree: views, schedules and family types.

import { h, clear } from './dom.js';
import { ICONS } from './icons.js';
import { sortedLevels, CATEGORIES, TYPED_CATEGORIES } from '../core/model.js';
import { SCHEDULES } from '../core/schedules.js';

const collapsed = new Set(['fam', ...TYPED_CATEGORIES.map((c) => `fam-${c}`)]);

function node(label, icon, { active = false, onopen, title } = {}) {
  return h('div', {
    class: `node${active ? ' active' : ''}`, title: title || label, role: 'treeitem',
    onclick: onopen,
  }, h('span', { class: 'caret' }), h('span', { html: ICONS[icon] || '' }), label);
}

function group(id, label, children, icon = 'folder') {
  const li = h('li', { class: `group${collapsed.has(id) ? ' collapsed' : ''}` });
  const head = h('div', {
    class: 'node', role: 'treeitem', 'aria-expanded': String(!collapsed.has(id)),
    onclick: () => {
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      li.classList.toggle('collapsed');
      head.querySelector('.caret').textContent = collapsed.has(id) ? '▸' : '▾';
    },
  }, h('span', { class: 'caret' }, collapsed.has(id) ? '▸' : '▾'), h('span', { html: ICONS[icon] }), label);
  li.append(head, h('ul', { role: 'group' }, children.map((c) => h('li', {}, c))));
  return li;
}

export function renderBrowser(app, container) {
  const scroll = container.scrollTop;
  clear(container);
  const doc = app.model.doc;
  const activeKey = app.activeView?.key();
  const plans = sortedLevels(doc).map((l) => node(l.name, 'plan', { active: activeKey === `plan:${l.id}`, onopen: () => app.openView({ kind: 'plan', levelId: l.id }) }));
  const elevs = ['north', 'south', 'east', 'west'].map((d) => node(d[0].toUpperCase() + d.slice(1), 'elevation', {
    active: activeKey === `elev:${d}`, onopen: () => app.openView({ kind: 'elevation', mode: d }),
  }));
  const schedules = Object.entries(SCHEDULES).map(([cat, label]) => node(label, 'schedule', {
    active: activeKey === `sched:${cat}`, onopen: () => app.openView({ kind: 'schedule', category: cat }),
  }));
  const families = TYPED_CATEGORIES.map((cat) => group(`fam-${cat}`, CATEGORIES[cat].label,
    doc.types[cat].map((t) => node(t.name, 'family', { onopen: () => app.editTypes(cat, t.id), title: `${t.name} — click to edit type` })), 'family'));

  container.append(h('ul', { class: 'tree', role: 'tree' },
    group('views', 'Views (all)', [
      group('plans', 'Floor Plans', plans, 'plan'),
      group('3d', '3D Views', [node('{3D}', 'view3d', { active: activeKey === '3d', onopen: () => app.openView({ kind: '3d' }) })], 'view3d'),
      group('elev', 'Elevations', elevs, 'elevation'),
    ], 'folder'),
    group('sched', 'Schedules/Quantities', schedules, 'schedule'),
    group('fam', 'Families', families, 'family')));
  container.scrollTop = scroll;
}
