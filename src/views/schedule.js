// Schedule (table) view with inline editing of text parameters.

import { buildSchedule, scheduleToCSV, SCHEDULES } from '../core/schedules.js';
import { h, clear } from '../ui/dom.js';

export class ScheduleView {
  constructor(app, category) {
    this.app = app;
    this.category = category;
    this.kind = 'schedule';
    this.el = h('div', { class: 'schedule' });
  }

  title() {
    return `Schedule: ${SCHEDULES[this.category]}`;
  }

  key() {
    return `sched:${this.category}`;
  }

  mount(host) {
    host.append(this.el);
    this.refresh();
  }

  unmount() {
    this.el.remove();
  }

  csv() {
    return scheduleToCSV(buildSchedule(this.app.model.doc, this.category));
  }

  refresh() {
    const model = this.app.model;
    // Selection-only changes just restyle rows, so double-click editing survives.
    if (this.builtRev === model.rev && this.builtDoc === model.doc) {
      for (const tr of this.el.querySelectorAll('tbody tr')) tr.classList.toggle('sel', this.app.selection.has(tr.dataset.id));
      return;
    }
    this.builtRev = model.rev;
    this.builtDoc = model.doc;
    const s = buildSchedule(model.doc, this.category);
    clear(this.el);
    this.el.append(h('h3', {}, s.title,
      h('button', { class: 'btn', onclick: () => this.app.exportScheduleCSV(this) }, 'Export CSV…')));
    if (!s.rows.length) {
      this.el.append(h('div', { class: 'none' }, `No ${this.category}s in the project yet.`));
      return;
    }
    const sel = this.app.selection;
    const rows = s.rows.map((r) => h('tr', {
      class: sel.has(r.id) ? 'sel' : '',
      'data-id': r.id,
      onclick: (e) => (e.shiftKey || e.metaKey ? this.app.toggleSelect(r.id) : this.app.select([r.id])),
    }, s.columns.map((c) => {
      const td = h('td', { class: c.editable ? 'editable' : '' }, r.cells[c.key] ?? '');
      if (c.editable) td.addEventListener('dblclick', () => this.editCell(td, r.id, c.key, r.cells[c.key] ?? ''));
      return td;
    })));
    const foot = h('tr', {}, s.columns.map((c) => h('td', {}, s.totals[c.key] ?? '')));
    this.el.append(h('table', {},
      h('thead', {}, h('tr', {}, s.columns.map((c) => h('th', {}, c.label)))),
      h('tbody', {}, rows),
      h('tfoot', {}, foot)));
    this.el.append(h('p', { style: { color: 'var(--muted)', marginTop: '10px' } }, 'Double-click a dashed cell to edit it. Click a row to select the element.'));
  }

  editCell(td, id, key, value) {
    const input = h('input', { type: 'text', value });
    clear(td).append(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply && input.value !== value) this.app.run(`Edit ${key}`, () => this.app.model.updateElement(id, { [key]: input.value }));
      else {
        this.builtRev = -1;
        this.refresh();
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  toDataURL() {
    return null;
  }
}
