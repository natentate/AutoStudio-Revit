// Modal dialogs and toasts.

import { h, clear, select } from './dom.js';
import { parseLength, formatLength } from '../core/units.js';

const root = () => document.getElementById('modal-root');
let openCount = 0;

export const modalOpen = () => openCount > 0;

/**
 * Show a modal. `buttons` = [{ label, value, primary, danger }]. Resolves with
 * the clicked button's value (or the result of `validate`), or null on Escape.
 */
export function openModal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], validate, width }) {
  return new Promise((resolve) => {
    openCount += 1;
    const close = (v) => {
      openCount -= 1;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const choose = (b) => {
      // Commit a field that is still being edited (fires its change handler).
      if (modal.contains(document.activeElement)) document.activeElement.blur();
      if (b.primary && validate) {
        const v = validate();
        if (v === undefined) return;
        close(v);
      } else close(b.value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        const primary = buttons.find((b) => b.primary);
        if (primary) {
          e.stopPropagation();
          e.preventDefault();
          choose(primary);
        }
      }
    };
    const footer = h('footer', {}, buttons.map((b) => h('button', {
      class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`,
      onclick: () => choose(b),
    }, b.label)));
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: width ? { width } : undefined },
      title ? h('header', {}, title) : null,
      h('div', { class: 'body' }, body),
      footer);
    const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(null); } }, modal);
    root().append(backdrop);
    document.addEventListener('keydown', onKey, true);
    const focusable = modal.querySelector('input, select, textarea') || footer.querySelector('.primary');
    setTimeout(() => {
      focusable?.focus();
      if (focusable instanceof HTMLInputElement) focusable.select();
    }, 0);
  });
}

export function alertDialog(title, message) {
  return openModal({ title, body: h('div', { class: 'msg' }, message) });
}

export async function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  const v = await openModal({
    title,
    body: h('div', { class: 'msg' }, message),
    buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
  return v === true;
}

/**
 * A form dialog. fields: [{ key, label, kind: 'text'|'length'|'number'|'select'|'color'|'checkbox'|'textarea', value, options }].
 * Returns { key: value } (lengths parsed to mm) or null.
 */
export function formDialog(title, fields, { okLabel = 'OK', units = 'metric' } = {}) {
  const inputs = {};
  const err = h('div', { style: { color: 'var(--danger)', minHeight: '14px' } });
  const rows = fields.map((f) => {
    let input;
    if (f.kind === 'select') input = select(f.options, f.value);
    else if (f.kind === 'checkbox') input = h('input', { type: 'checkbox', checked: f.value });
    else if (f.kind === 'color') input = h('input', { type: 'color', value: f.value });
    else if (f.kind === 'textarea') input = h('textarea', { rows: 3 }, f.value ?? '');
    else input = h('input', { type: 'text', value: f.kind === 'length' ? formatLength(f.value, units) : f.value ?? '' });
    inputs[f.key] = input;
    return h('label', { class: 'field' }, h('span', {}, f.label), input);
  });
  return openModal({
    title,
    body: [...rows, err],
    buttons: [{ label: 'Cancel', value: null }, { label: okLabel, primary: true }],
    validate: () => {
      const out = {};
      for (const f of fields) {
        const input = inputs[f.key];
        if (f.kind === 'checkbox') out[f.key] = input.checked;
        else if (f.kind === 'length') {
          const v = parseLength(input.value, units);
          if (!Number.isFinite(v) || (f.min !== undefined && v < f.min)) {
            err.textContent = `${f.label}: enter a valid length.`;
            input.focus();
            return undefined;
          }
          out[f.key] = v;
        } else if (f.kind === 'number') {
          const v = parseFloat(input.value);
          if (!Number.isFinite(v)) {
            err.textContent = `${f.label}: enter a number.`;
            input.focus();
            return undefined;
          }
          out[f.key] = v;
        } else {
          out[f.key] = input.value;
          if (f.required && !String(input.value).trim()) {
            err.textContent = `${f.label} is required.`;
            input.focus();
            return undefined;
          }
        }
      }
      return out;
    },
  });
}

let toastTimer = null;
export function toast(message, { error = false, ms = 2600 } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  clearTimeout(toastTimer);
  const t = h('div', { class: `toast${error ? ' error' : ''}`, role: 'status' }, message);
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export { clear };
