// state.js — the single in-memory app state and the "commit" function.
//
// Pattern: code changes `state.profile`, then calls commit(). commit() saves
// to IndexedDB immediately (autosave) and redraws the screen. This keeps the
// on-screen board and the saved board always in sync.

import { saveProfile, takeSnapshot } from './store.js';
import { h } from './ui.js';
import { pick, t } from './i18n.js';

export const state = {
  profile: null,        // the saved profile (see vocab.js)
  sentence: [],         // items in the sentence bar (saved as a draft)
  caregiver: false,     // true while caregiver mode is unlocked
  tab: 'core',          // current board: a category id, 'now' or 'type'
  nowOverride: null,    // {cat, until} manual override on the Now screen
  moving: null,         // id of a button being moved (caregiver mode)
};

let renderFn = () => {};
export function setRenderer(fn) { renderFn = fn; }
export function render() { renderFn(); }

let lastSnapshotAt = 0;

/** Save + redraw. Also keeps an automatic snapshot at most every 10 minutes
 *  while the caregiver is editing, so recent work can be recovered. */
export function commit({ redraw = true } = {}) {
  saveProfile(state.profile);
  if (state.caregiver && Date.now() - lastSnapshotAt > 10 * 60 * 1000) {
    lastSnapshotAt = Date.now();
    takeSnapshot(state.profile, 'editing').catch(() => {});
  }
  if (redraw) render();
}

/** Label of a button, category or sentence item in a language (default:
 *  the board language). Falls back to English, then any language. Also reads
 *  the old v1 shape {en, hi} so an old unfinished sentence still shows. */
export function labelOf(item, lang = state.profile.settings.lang) {
  if (!item) return '';
  return pick(item.text || { en: item.en, hi: item.hi }, lang);
}

export const catById = id => state.profile.categories.find(c => c.id === id);
export const buttonById = id => state.profile.buttons.find(b => b.id === id);

/** Lowest free slot in a category. New buttons go here so that existing
 *  buttons are never pushed around. */
export function nextEmptySlot(catId) {
  const used = new Set(state.profile.buttons.filter(b => b.cat === catId).map(b => b.slot));
  let s = 0;
  while (used.has(s)) s++;
  return s;
}

// ---------------------------------------------------------- status line ---

/**
 * Show a visible message under the sentence bar.
 * kind: 'info' | 'warn' | 'error'. actions: [{label, onClick}].
 * Info messages hide themselves after a few seconds; warnings stay until
 * dismissed so they can't be missed.
 */
let statusTimer = null;
export function showStatus(message, kind = 'info', actions = []) {
  const el = document.getElementById('status');
  if (!el) return;
  clearTimeout(statusTimer);
  el.className = `status ${kind}`;
  el.replaceChildren(
    h('span', { class: 'status-text' }, ({ info: 'ℹ️ ', update: '🔄 ' }[kind] || '⚠️ ') + message),
    ...actions.map(a => h('button', { class: 'btn small', onclick: () => { hideStatus(); a.onClick(); } }, a.label)),
    h('button', { class: 'btn small icon-btn', 'aria-label': t('btn.close'), onclick: hideStatus }, '✕'));
  el.hidden = false;
  if (kind === 'info') statusTimer = setTimeout(hideStatus, 5000);
}
export function hideStatus() {
  const el = document.getElementById('status');
  if (el) el.hidden = true;
}
