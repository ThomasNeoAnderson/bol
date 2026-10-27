// ui.js — tiny DOM helpers shared by the rest of the app (no framework).

import { t } from './i18n.js';

/** Create an element: h('button', {class: 'x', onclick: fn}, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      // setProperty is needed for CSS variables such as --cat
      for (const [p, val] of Object.entries(v)) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), val);
    }
    else if (k in el && typeof v !== 'string') el[k] = v;   // e.g. checked, value, disabled
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const overlay = () => document.getElementById('overlay');

/**
 * Show a modal dialog. `body` is a Node. `actions` is a list of
 * {label, kind, onClick} — onClick may return false to keep the dialog open.
 * Returns a function that closes the dialog.
 */
export function openModal({ title, body, actions = [], full = false, onClose, closable = true }) {
  const root = overlay();
  const close = () => {
    box.remove();
    if (!root.children.length) root.hidden = true;
    if (onClose) onClose();
  };
  const footer = h('div', { class: 'modal-actions' },
    actions.map(a => h('button', {
      class: `btn ${a.kind || ''}`,
      disabled: a.disabled,
      onclick: async () => { if ((await a.onClick?.()) !== false) close(); },
    }, a.label)));
  const box = h('div', { class: `modal ${full ? 'full' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('h2', {}, title),
      closable ? h('button', { class: 'btn icon-btn', 'aria-label': t('btn.close'), onclick: close }, '✕') : null),
    h('div', { class: 'modal-body' }, body),
    actions.length ? footer : null);
  root.append(box);
  root.hidden = false;
  return close;
}

/** Close every open dialog (used after the whole profile is replaced, so no
 *  dialog keeps editing the old copy). */
export function closeAllModals() {
  const root = overlay();
  root.replaceChildren();
  root.hidden = true;
}

/** Yes/No question. Resolves true or false. */
export function confirmDialog(message, yes = t('btn.yes'), no = t('btn.cancel'), danger = false) {
  return new Promise(resolve => {
    let answered = false;
    openModal({
      title: t('confirm.title'),
      body: h('p', {}, message),
      actions: [
        { label: no, onClick: () => { answered = true; resolve(false); } },
        { label: yes, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/** Simple 4-digit PIN pad. Resolves the typed PIN, or null if cancelled. */
export function pinPad(title) {
  return new Promise(resolve => {
    let pin = '';
    let done = false;
    const display = h('div', { class: 'pin-display', 'aria-live': 'polite' }, '○○○○');
    const update = () => { display.textContent = '●'.repeat(pin.length) + '○'.repeat(4 - pin.length); };
    let close;
    const press = d => {
      if (d === '⌫') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += d;
      update();
      if (pin.length === 4) { done = true; close(); resolve(pin); }
    };
    const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
    const pad = h('div', { class: 'pin-pad' },
      keys.map(k => k ? h('button', { class: 'btn pin-key', onclick: () => press(k) }, k) : h('span')));
    close = openModal({ title, body: h('div', {}, display, pad), onClose: () => { if (!done) resolve(null); } });
  });
}

/** Format an ISO date as e.g. "3 Oct 2026, 14:05". */
export function fmtDate(iso) {
  if (!iso) return t('date.never');
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** Make an element respond to tap and long-press separately. */
export function onPress(el, onTap, onLong, longMs = 600) {
  let timer = null, longFired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', () => {
    longFired = false;
    if (!onLong) return;
    cancel();
    timer = setTimeout(() => { longFired = true; timer = null; onLong(); }, longMs);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, cancel));
  el.addEventListener('click', e => {
    if (longFired) { e.preventDefault(); longFired = false; return; }
    onTap(e);
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
