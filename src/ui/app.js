// Application controller: owns the model, selection, open views, the active
// tool, and wires the ribbon, palettes, keyboard and native menus together.

import { Model, createEmptyProject, getElement, sortedLevels, getLevel, CATEGORIES } from '../core/model.js';
import { createSampleProject } from '../core/sample.js';
import { exportIFC } from '../core/ifc.js';
import { rotateElements } from '../core/edit.js';
import { bbox } from '../core/geometry.js';
import { formatLength } from '../core/units.js';
import { PlanView } from '../views/plan.js';
import { View3D } from '../views/view3d.js';
import { ScheduleView } from '../views/schedule.js';
import { createTool } from '../views/tools.js';
import { h, clear } from './dom.js';
import { ICONS } from './icons.js';
import { renderProperties } from './properties.js';
import { renderBrowser } from './browser.js';
import { openModal, formDialog, toast, modalOpen } from './dialogs.js';
import { typesDialog, levelsDialog, addLevel, projectInfoDialog, visibilityDialog, aboutDialog, shortcutsDialog } from './managers.js';
import { platform, isElectron, isMac } from './platform.js';

export const VERSION = '0.1.0';

const PLAN_TOOLS = new Set(['wall', 'door', 'window', 'floor', 'roof', 'room', 'grid', 'dimension', 'text', 'move', 'copy', 'mirror', 'trim', 'split']);

export class App {
  constructor() {
    this.model = null;
    this.filePath = null;
    this.fileName = 'Project 1';
    this.selection = new Set();
    this.views = new Map();
    this.activeView = null;
    this.lastPlanKey = null;
    this.tool = null;
    this.toolName = 'select';
    this.toolCache = new Map();
    this.currentTypes = {};
    this.ribbonTab = 'architecture';
    this.keyBuffer = '';
    this.keyTimer = null;
    this.spaceDown = false;
    this.$ = (id) => document.getElementById(id);
  }

  // ---- startup -----------------------------------------------------------------

  start() {
    if (isElectron && isMac) document.body.classList.add('mac-electron');
    this.buildQAT();
    this.bindKeyboard();
    platform.onMenu((cmd) => this.command(cmd));
    platform.onOpenFile((file) => this.loadFile(file));
    window.addEventListener('beforeunload', (e) => {
      if (!isElectron && this.model?.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    this.setModel(new Model(createEmptyProject()), null, 'Project 1');
    platform.rendererReady();
  }

  setModel(model, path, name) {
    for (const v of this.views.values()) {
      if (v.dispose) v.dispose();
      else v.unmount();
    }
    this.views.clear();
    this.activeView = null;
    this.lastPlanKey = null;
    this.unsubscribe?.();
    this.model = model;
    this.filePath = path;
    this.fileName = name;
    this.selection = new Set();
    this.unsubscribe = model.on(() => this.onModelChange());
    const first = sortedLevels(model.doc)[0];
    this.setTool('select');
    if (first) this.openView({ kind: 'plan', levelId: first.id });
    this.renderAll();
  }

  onModelChange() {
    // Drop selected ids that no longer exist (e.g. after undo).
    for (const id of [...this.selection]) if (!getElement(this.model.doc, id)) this.selection.delete(id);
    this.closeViewsForMissingLevels();
    this.activeView?.refresh?.();
    this.activeView?.invalidate?.();
    this.renderAll();
  }

  renderAll() {
    this.renderRibbon();
    this.renderTabs();
    renderBrowser(this, this.$('browser'));
    renderProperties(this, this.$('properties'));
    this.renderOptions();
    this.updateViewBar();
    this.updateTitle();
    this.updateStatus();
  }

  updateTitle() {
    const dirty = this.model.dirty;
    const title = `${this.fileName}${dirty ? ' — Edited' : ''}`;
    this.$('doc-title').textContent = title;
    document.title = `${this.fileName}${dirty ? ' *' : ''} — AutoStudio`;
    platform.setDocumentState({ title: this.fileName, dirty, path: this.filePath });
    for (const b of this.$('qat').querySelectorAll('button[data-cmd]')) {
      if (b.dataset.cmd === 'undo') {
        b.disabled = !this.model.canUndo();
        b.title = this.model.canUndo() ? `Undo ${this.model.undoStack[this.model.undoStack.length - 1].name} (⌘Z)` : 'Undo';
      }
      if (b.dataset.cmd === 'redo') b.disabled = !this.model.canRedo();
    }
  }

  // ---- quick access toolbar & ribbon ---------------------------------------------

  buildQAT() {
    const mk = (cmd, icon, title) => h('button', { 'data-cmd': cmd, title, 'aria-label': title, html: ICONS[icon], onclick: () => this.command(cmd) });
    this.$('qat').append(
      mk('new', 'new', 'New Project (⌘N)'),
      mk('open', 'open', 'Open… (⌘O)'),
      mk('save', 'save', 'Save (⌘S)'),
      mk('undo', 'undo', 'Undo (⌘Z)'),
      mk('redo', 'redo', 'Redo (⇧⌘Z)'),
      mk('view3d', 'view3d', 'Default 3D View'),
    );
  }

  ribbonSpec() {
    const t = (tool, label, icon, key) => ({ tool, label, icon, key });
    const c = (cmd, label, icon, key) => ({ cmd, label, icon, key });
    return [
      { id: 'architecture', label: 'Architecture', panels: [
        { label: 'Select', items: [t('select', 'Modify', 'select', 'MD')] },
        { label: 'Build', items: [t('wall', 'Wall', 'wall', 'WA'), t('door', 'Door', 'door', 'DR'), t('window', 'Window', 'window', 'WN'), t('floor', 'Floor', 'floor', 'FL'), t('roof', 'Roof', 'roof', 'RF')] },
        { label: 'Room & Area', items: [t('room', 'Room', 'room', 'RM')] },
        { label: 'Datum', items: [c('addLevel', 'Level', 'level', 'LL'), t('grid', 'Grid', 'grid', 'GR')] },
      ] },
      { id: 'annotate', label: 'Annotate', panels: [
        { label: 'Dimension', items: [t('dimension', 'Aligned', 'dimension', 'DI')] },
        { label: 'Text', items: [t('text', 'Text', 'text', 'TX')] },
        { label: 'Tag', items: [t('room', 'Room', 'room', 'RM')] },
      ] },
      { id: 'modify', label: 'Modify', panels: [
        { label: 'Select', items: [t('select', 'Modify', 'select', 'MD')] },
        { label: 'Modify', items: [t('move', 'Move', 'move', 'MV'), t('copy', 'Copy', 'copy', 'CO'), c('rotate', 'Rotate', 'rotate', 'RO'), t('mirror', 'Mirror', 'mirror', 'MM'), t('trim', 'Trim/Extend Corner', 'trim', 'TR'), t('split', 'Split', 'split', 'SL'), c('delete', 'Delete', 'delete', 'DE')] },
      ] },
      { id: 'view', label: 'View', panels: [
        { label: 'Create', items: [c('view3d', '3D View', 'view3d', '3D'), c('elevation', 'Elevation', 'elevation'), c('schedules', 'Schedules', 'schedule')] },
        { label: 'Graphics', items: [c('visibility', 'Visibility/ Graphics', 'visibility', 'VV')] },
        { label: 'Navigate', items: [c('zoomFit', 'Zoom to Fit', 'zoomfit', 'ZF')] },
      ] },
      { id: 'manage', label: 'Manage', panels: [
        { label: 'Settings', items: [c('projectInfo', 'Project Information', 'info'), c('levels', 'Levels', 'level'), c('types', 'Types', 'types'), c('units', 'Project Units', 'units', 'UN')] },
        { label: 'Export', items: [c('exportIFC', 'IFC', 'ifc'), c('exportPNG', 'Image', 'image'), c('exportCSV', 'Schedule CSV', 'csv')] },
        { label: 'Project', items: [c('openSample', 'Sample Project', 'sample')] },
      ] },
    ];
  }

  shortcuts() {
    const out = [];
    for (const tab of this.ribbonSpec()) for (const p of tab.panels) for (const i of p.items) if (i.key && !out.some((o) => o[0] === i.key)) out.push([i.key, i.label.replace(/\s+/g, ' ')]);
    return [
      ...out,
      ['Esc', 'Cancel the current tool / clear selection'],
      ['Delete', 'Delete selected elements'],
      ['⌘Z / ⇧⌘Z', 'Undo / Redo'],
      ['⌘S', 'Save'],
      ['Shift (drawing)', 'Force horizontal/vertical'],
      ['Alt (dragging)', 'Move without stretching joined walls'],
      ['Space + drag', 'Pan (also middle mouse / two-finger scroll)'],
      ['Pinch / ⌘ + scroll', 'Zoom'],
      ['Typing digits', 'While drawing a wall: exact length, then Enter'],
    ];
  }

  renderRibbon() {
    const spec = this.ribbonSpec();
    const tabs = this.$('ribbon-tabs');
    clear(tabs);
    for (const tab of spec) {
      tabs.append(h('button', {
        class: 'ribbon-tab', role: 'tab', 'aria-selected': String(tab.id === this.ribbonTab),
        onclick: () => { this.ribbonTab = tab.id; this.renderRibbon(); },
      }, tab.label));
    }
    const panels = this.$('ribbon-panels');
    clear(panels);
    const tab = spec.find((s) => s.id === this.ribbonTab) || spec[0];
    for (const p of tab.panels) {
      panels.append(h('div', { class: 'ribbon-panel' },
        h('div', { class: 'buttons' }, p.items.map((i) => h('button', {
          class: `rbtn${i.tool && i.tool === this.toolName ? ' active' : ''}`,
          title: `${i.label}${i.key ? ` (${i.key})` : ''}`,
          onclick: () => (i.tool ? this.setTool(i.tool) : this.command(i.cmd)),
        }, h('span', { html: ICONS[i.icon] }), h('span', {}, i.label)))),
        h('div', { class: 'label' }, p.label)));
    }
  }

  // ---- views ----------------------------------------------------------------------

  viewKey(desc) {
    if (desc.kind === 'plan') return `plan:${desc.levelId}`;
    if (desc.kind === '3d') return '3d';
    if (desc.kind === 'elevation') return `elev:${desc.mode}`;
    return `sched:${desc.category}`;
  }

  openView(desc) {
    const key = this.viewKey(desc);
    let view = this.views.get(key);
    if (!view) {
      if (desc.kind === 'plan') view = new PlanView(this, desc.levelId);
      else if (desc.kind === '3d') view = new View3D(this, '3d');
      else if (desc.kind === 'elevation') view = new View3D(this, desc.mode);
      else view = new ScheduleView(this, desc.category);
      this.views.set(key, view);
    }
    this.activate(view);
    return view;
  }

  activate(view) {
    if (this.activeView === view) return;
    this.activeView?.unmount();
    this.activeView = view;
    const host = this.$('viewhost');
    clear(host);
    if (view.kind === 'plan') this.lastPlanKey = view.key();
    try {
      view.mount(host);
    } catch (e) {
      host.append(h('div', { class: 'empty-view' }, `This view could not be displayed: ${e.message}`));
    }
    if (view.kind === 'plan' && !this.model.doc.elements.length) host.append(this.welcome());
    if (view.kind !== 'plan' && this.toolName !== 'select') this.setTool('select');
    else this.tool?.activate?.();
    this.renderAll();
    view.canvas?.focus();
  }

  welcome() {
    const box = h('div', {
      class: 'welcome',
      style: {
        position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%, -50%)', background: 'rgba(255,255,255,0.96)',
        border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.08)',
      },
    },
    h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '6px' } }, 'Start modeling'),
    h('div', { style: { color: 'var(--muted)', marginBottom: '14px', lineHeight: 1.5 } }, 'Draw walls in plan, then add doors, windows, floors, rooms and a roof.', h('br'), 'Or explore a finished model first.'),
    h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center' } },
      h('button', { class: 'btn primary', onclick: () => this.setTool('wall') }, 'Draw Walls (WA)'),
      h('button', { class: 'btn', onclick: () => this.command('openSample') }, 'Open Sample Project')));
    const dismiss = () => {
      box.remove();
      off();
      this.dismissWelcome = null;
    };
    const off = this.model.on(dismiss);
    this.dismissWelcome = dismiss;
    this.activeView?.canvas?.addEventListener('pointerdown', dismiss, { once: true });
    return box;
  }

  closeView(view) {
    const key = view.key();
    if (view.dispose) view.dispose();
    else view.unmount();
    this.views.delete(key);
    if (this.activeView === view) {
      this.activeView = null;
      const next = [...this.views.values()].pop();
      if (next) this.activate(next);
      else {
        clear(this.$('viewhost')).append(h('div', { class: 'empty-view' }, 'No open views. Open one from the Project Browser.'));
        this.renderAll();
      }
    } else this.renderTabs();
  }

  closeViewsForMissingLevels() {
    for (const v of [...this.views.values()]) {
      if (v.kind === 'plan' && !getLevel(this.model.doc, v.levelId)) this.closeView(v);
    }
  }

  renderTabs() {
    const tabs = this.$('viewtabs');
    clear(tabs);
    for (const v of this.views.values()) {
      tabs.append(h('div', {
        class: `vtab${v === this.activeView ? ' active' : ''}`, role: 'tab',
        onclick: () => this.activate(v),
      }, v.title(), h('button', { class: 'x', title: 'Close view', 'aria-label': 'Close view', onclick: (e) => { e.stopPropagation(); this.closeView(v); } }, '×')));
    }
  }

  updateViewBar() {
    const bar = this.$('viewbar');
    clear(bar);
    const v = this.activeView;
    if (!v) return;
    if (v.kind === 'plan') {
      bar.append(h('span', { class: 'vb-label' }, `1 : ${v.scaleRatio()}`), h('span', { class: 'vb-label' }, getLevel(this.model.doc, v.levelId)?.name ?? ''));
    } else if (v.kind === '3d') {
      bar.append(h('span', { class: 'vb-label' }, 'Perspective · drag to orbit, right-drag to pan, scroll to zoom'));
    } else if (v.kind === 'elevation') {
      bar.append(h('span', { class: 'vb-label' }, 'Orthographic · drag to pan, scroll to zoom'));
    }
    bar.append(h('span', { class: 'spacer' }));
    if (v.kind !== 'schedule') {
      bar.append(h('button', { class: 'btn', onclick: () => this.command('visibility') }, 'Visibility/Graphics'));
      bar.append(h('button', { class: 'btn', onclick: () => this.command('zoomFit') }, 'Zoom to Fit'));
    } else {
      bar.append(h('button', { class: 'btn', onclick: () => this.command('exportCSV') }, 'Export CSV…'));
    }
  }

  // ---- tools & selection ------------------------------------------------------------

  setTool(name) {
    if (PLAN_TOOLS.has(name) && this.activeView?.kind !== 'plan') {
      const plan = (this.lastPlanKey && this.views.get(this.lastPlanKey)) || null;
      if (plan) this.activate(plan);
      else {
        const first = sortedLevels(this.model.doc)[0];
        if (!first) return;
        this.openView({ kind: 'plan', levelId: first.id });
      }
    }
    this.tool?.deactivate?.();
    if (name !== 'select') this.dismissWelcome?.();
    if (this.activeView?.kind === 'plan') this.activeView.hoverId = null;
    if (!this.toolCache.has(name)) this.toolCache.set(name, createTool(this, name));
    this.tool = this.toolCache.get(name);
    this.toolName = this.tool.name;
    const keepSelection = ['select', 'move', 'copy', 'mirror'].includes(name);
    if (!keepSelection) this.selection = new Set();
    this.tool.activate?.();
    if (this.activeView?.canvas) this.activeView.canvas.style.cursor = this.toolName === 'select' ? '' : 'crosshair';
    this.renderAll();
    this.activeView?.invalidate?.();
  }

  renderOptions() {
    const bar = this.$('optionsbar');
    clear(bar);
    const tool = this.tool;
    if (!tool || tool.name === 'select') {
      const n = this.selection.size;
      bar.append(h('span', { class: 'ob-title' }, 'Modify'));
      if (n) {
        bar.append(
          h('button', { class: 'btn', onclick: () => this.setTool('move') }, 'Move'),
          h('button', { class: 'btn', onclick: () => this.setTool('copy') }, 'Copy'),
          h('button', { class: 'btn', onclick: () => this.command('rotate') }, 'Rotate'),
          h('button', { class: 'btn', onclick: () => this.setTool('mirror') }, 'Mirror'),
          h('button', { class: 'btn danger', onclick: () => this.command('delete') }, 'Delete'),
        );
      } else bar.append(h('span', { style: { color: 'var(--muted)' } }, 'Select elements in the view, or pick a tool from the ribbon.'));
      return;
    }
    const label = { move: 'Move', copy: 'Copy', mirror: 'Mirror', trim: 'Trim/Extend', split: 'Split Element' }[tool.name] || `Place ${CATEGORIES[tool.name]?.singular ?? tool.name}`;
    bar.append(h('span', { class: 'ob-title' }, label), ...tool.options());
    bar.append(h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: () => this.setTool('select') }, 'Finish (Esc)'));
  }

  refreshOptions() {
    this.renderOptions();
    this.activeView?.invalidate?.();
  }

  currentType(category) {
    const types = this.model.doc.types[category];
    const id = this.currentTypes[category];
    return types.some((t) => t.id === id) ? id : types[0].id;
  }

  setCurrentType(category, typeId) {
    this.currentTypes[category] = typeId;
    renderProperties(this, this.$('properties'));
    this.activeView?.invalidate?.();
  }

  select(ids) {
    this.selection = new Set(ids.filter((id) => getElement(this.model.doc, id)));
    this.afterSelectionChange();
  }

  toggleSelect(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.afterSelectionChange();
  }

  afterSelectionChange() {
    renderProperties(this, this.$('properties'));
    this.renderOptions();
    this.updateStatus();
    this.activeView?.refresh?.();
    this.activeView?.invalidate?.();
  }

  // ---- status ----------------------------------------------------------------------

  setPrompt(text) {
    this.$('status-prompt').textContent = text;
  }

  updateStatus() {
    this.setPrompt(this.tool?.prompt ?? 'Ready');
    const n = this.selection.size;
    this.$('status-sel').textContent = n ? `${n} selected` : '';
  }

  setCoords(p, text) {
    const units = this.model.doc.info.units;
    this.$('status-coords').textContent = text ?? `X ${formatLength(p.x, units)}   Y ${formatLength(p.y, units)}`;
  }

  toast(message, error = false) {
    toast(message, { error });
  }

  /** Run a transaction, reporting failures as a toast. Returns the result or null. */
  run(name, fn) {
    try {
      return this.model.transact(name, fn);
    } catch (e) {
      this.toast(e.message || String(e), true);
      return null;
    }
  }

  // ---- keyboard ---------------------------------------------------------------------

  bindKeyboard() {
    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.spaceDown = false;
    });
    document.addEventListener('keydown', (e) => {
      if (modalOpen()) return;
      const t = e.target;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
      const mod = e.metaKey || e.ctrlKey;
      if (typing) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (mod) {
        // Under Electron the native menu owns these accelerators.
        if (isElectron) return;
        const k = e.key.toLowerCase();
        const map = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', s: e.shiftKey ? 'saveAs' : 'save', o: 'open', a: 'selectAll' };
        if (map[k]) {
          e.preventDefault();
          this.command(map[k]);
        }
        return;
      }
      if (e.key === ' ') {
        this.spaceDown = true;
        e.preventDefault();
        return;
      }
      if (this.tool?.onKey?.(e)) {
        e.preventDefault();
        this.activeView?.invalidate?.();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.tool?.cancel?.()) {
          this.updateStatus();
          this.activeView?.invalidate?.();
        } else if (this.toolName !== 'select') this.setTool('select');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.command('delete');
        return;
      }
      if (/^[a-z0-9]$/i.test(e.key)) {
        this.keyBuffer = (this.keyBuffer + e.key.toUpperCase()).slice(-2);
        clearTimeout(this.keyTimer);
        this.keyTimer = setTimeout(() => { this.keyBuffer = ''; }, 1200);
        if (this.keyBuffer.length === 2) {
          const item = this.ribbonSpec().flatMap((tab) => tab.panels.flatMap((p) => p.items)).find((i) => i.key === this.keyBuffer);
          if (item) {
            this.keyBuffer = '';
            if (item.tool) this.setTool(item.tool);
            else this.command(item.cmd);
          }
        }
      }
    });
  }

  // ---- commands -------------------------------------------------------------------------

  async command(cmd) {
    const focused = document.activeElement;
    const typing = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement;
    switch (cmd) {
      case 'new': return this.newProject();
      case 'open': return this.open();
      case 'openSample': return this.openSample();
      case 'save': return this.save(false);
      case 'saveAs': return this.save(true);
      case 'saveAndClose': {
        const ok = await this.save(false);
        if (ok) platform.closeWindow();
        return ok;
      }
      case 'undo':
        if (typing) return document.execCommand('undo');
        if (modalOpen()) return null;
        return this.model.undo() ?? this.toast('Nothing to undo.');
      case 'redo':
        if (typing) return document.execCommand('redo');
        if (modalOpen()) return null;
        return this.model.redo() ?? this.toast('Nothing to redo.');
      case 'selectAll':
        if (typing) return document.execCommand('selectAll');
        if (this.activeView?.kind === 'plan') this.select(this.activeView.viewElements().map((e) => e.id));
        return null;
      case 'delete':
        if (!this.selection.size) return null;
        this.run('Delete', () => this.model.deleteElements([...this.selection]));
        this.select([]);
        return null;
      case 'rotate': return this.rotateSelection();
      case 'zoomFit': return this.activeView?.zoomToFit?.();
      case 'view3d': return this.openView({ kind: '3d' });
      case 'elevation': return this.openView({ kind: 'elevation', mode: 'south' });
      case 'schedules': return this.openView({ kind: 'schedule', category: 'door' });
      case 'visibility': return visibilityDialog(this);
      case 'projectInfo': return projectInfoDialog(this);
      case 'units': {
        const r = await formDialog('Project Units', [{ key: 'units', label: 'Length units', kind: 'select', value: this.model.doc.info.units, options: [['metric', 'Metric (mm, m²)'], ['imperial', 'Imperial (ft-in, SF)']] }]);
        if (r) this.run('Project Units', (doc) => { doc.info.units = r.units; });
        return null;
      }
      case 'levels': return levelsDialog(this);
      case 'addLevel': {
        const level = await addLevel(this);
        if (level) this.openView({ kind: 'plan', levelId: level.id });
        return null;
      }
      case 'types': return this.editTypes('wall');
      case 'exportIFC': return this.exportIFC();
      case 'exportPNG': return this.exportPNG();
      case 'exportCSV': return this.exportScheduleCSV();
      case 'about': return aboutDialog(VERSION);
      case 'shortcuts': return shortcutsDialog(this.shortcuts());
      default:
        return null;
    }
  }

  async rotateSelection() {
    const ids = [...this.selection].filter((id) => !getElement(this.model.doc, id)?.hostId);
    if (!ids.length) {
      this.toast('Select elements to rotate first.', true);
      return;
    }
    const pts = [];
    for (const id of ids) {
      const el = getElement(this.model.doc, id);
      if (el.a) pts.push(el.a, el.b);
      if (el.points) pts.push(...el.points);
      if (el.at) pts.push(el.at);
    }
    const b = bbox(pts);
    const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const r = await formDialog('Rotate', [{ key: 'angle', label: 'Angle (degrees, CCW)', kind: 'number', value: 90 }], { okLabel: 'Rotate' });
    if (!r) return;
    this.run('Rotate', (doc) => rotateElements(doc, ids, center, (r.angle * Math.PI) / 180));
  }

  editTypes(category, typeId) {
    return typesDialog(this, category, typeId);
  }

  visibilityDialog() {
    return visibilityDialog(this);
  }

  async editRoom(id) {
    const room = getElement(this.model.doc, id);
    const r = await formDialog('Room', [
      { key: 'name', label: 'Name', kind: 'text', value: room.name, required: true },
      { key: 'number', label: 'Number', kind: 'text', value: room.number },
    ]);
    if (r) this.run('Edit Room', () => this.model.updateElement(id, r));
  }

  async editText(id) {
    const t = getElement(this.model.doc, id);
    const r = await formDialog('Text Note', [{ key: 'text', label: 'Text', kind: 'textarea', value: t.text, required: true }]);
    if (r) this.run('Edit Text', () => this.model.updateElement(id, { text: r.text }));
  }

  // ---- files -----------------------------------------------------------------------------

  /** Ask to save unsaved changes. Returns false if the user cancelled. */
  async confirmDiscard() {
    if (!this.model.dirty) return true;
    const choice = await openModal({
      title: 'Unsaved Changes',
      body: h('div', { class: 'msg' }, `Do you want to save the changes you made to “${this.fileName}”?`),
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: "Don't Save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
    });
    if (choice === 'save') return this.save(false);
    return choice === 'discard';
  }

  async newProject() {
    if (!(await this.confirmDiscard())) return;
    this.setModel(new Model(createEmptyProject()), null, 'Project 1');
  }

  async openSample() {
    if (!(await this.confirmDiscard())) return;
    this.setModel(createSampleProject(), null, 'Sample House');
    this.toast('Sample project loaded. Open {3D} from the Project Browser to see it in 3D.');
  }

  async open() {
    if (!(await this.confirmDiscard())) return;
    try {
      const file = await platform.openProject();
      if (file) this.loadFile(file, true);
    } catch (e) {
      this.toast(`Could not open the file: ${e.message}`, true);
    }
  }

  async loadFile(file, confirmed = false) {
    if (!confirmed && !(await this.confirmDiscard())) return;
    try {
      const model = Model.fromJSON(file.content);
      const name = (file.name || file.path || 'Project').split(/[\\/]/).pop().replace(/\.asbim$/i, '');
      this.setModel(model, file.path || null, name);
    } catch (e) {
      openModal({ title: 'Cannot Open Project', body: h('div', { class: 'msg' }, e.message) });
    }
  }

  async save(saveAs) {
    try {
      const saved = await platform.saveProject({
        path: saveAs ? null : this.filePath, content: this.model.toJSON(), saveAs: saveAs || !this.filePath, suggestedName: this.fileName,
      });
      if (!saved) return false;
      if (isElectron) {
        this.filePath = saved;
        this.fileName = saved.split(/[\\/]/).pop().replace(/\.asbim$/i, '');
      }
      this.model.markSaved();
      this.updateTitle();
      this.toast(`Saved ${this.fileName}.`);
      return true;
    } catch (e) {
      this.toast(`Save failed: ${e.message}`, true);
      return false;
    }
  }

  async exportIFC() {
    try {
      const content = exportIFC(this.model.doc);
      const path = await platform.exportFile({ suggestedName: this.fileName, extension: 'ifc', filterName: 'IFC', content });
      if (path) this.toast('Exported IFC4 file.');
    } catch (e) {
      this.toast(`IFC export failed: ${e.message}`, true);
    }
  }

  async exportPNG() {
    const v = this.activeView;
    const dataUrl = v?.toDataURL?.();
    if (!dataUrl) {
      this.toast('Open a plan, 3D or elevation view to export an image.', true);
      return;
    }
    const path = await platform.exportFile({ suggestedName: `${this.fileName} - ${v.title().replace(/[:{}]/g, '')}`, extension: 'png', filterName: 'PNG Image', dataUrl });
    if (path) this.toast('Exported image.');
  }

  async exportScheduleCSV(view = this.activeView) {
    if (view?.kind !== 'schedule') {
      this.toast('Open a schedule (Project Browser › Schedules) to export it.', true);
      return;
    }
    const path = await platform.exportFile({ suggestedName: `${this.fileName} - ${view.title().replace('Schedule: ', '')}`, extension: 'csv', filterName: 'CSV', content: view.csv() });
    if (path) this.toast('Exported schedule.');
  }
}
