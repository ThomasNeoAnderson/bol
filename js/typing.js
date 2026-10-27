// typing.js — the "Type" tab: type with the phone's own keyboard (so Tamil,
// Kannada, Hindi and English keyboards all work) and speak it.
//
// Suggestions come ONLY from this user's own words: their saved "My phrases"
// and sentences they have spoken before (profile.history). No machine
// learning and nothing leaves the device. Ranking is simple and explainable:
//   1. how well it matches what is typed: starts with it > a word starts
//      with it > contains it
//   2. then how often it was said, 3. then how recently.
// The caregiver can clear the history in Settings.

import { state, commit, labelOf } from './state.js';
import { h } from './ui.js';
import { t } from './i18n.js';

const MAX_HISTORY = 300;
const MAX_SUGGESTIONS = 8;
const TYPED_KEY = 'bol-typed';            // unfinished typed text, survives a force-close

const norm = s => String(s || '').normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** Remember a spoken sentence (typed, or built on the board) for suggestions. */
export function rememberSentence(text, lang = state.profile.settings.lang) {
  const clean = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const hist = state.profile.history;
  const key = norm(clean);
  const found = hist.find(e => e.lang === lang && norm(e.text) === key);
  if (found) { found.n += 1; found.last = Date.now(); found.text = clean; }
  else hist.push({ text: clean, lang, n: 1, last: Date.now() });
  if (hist.length > MAX_HISTORY) {
    // Drop the least useful entries: rarely said and long ago.
    hist.sort((a, b) => (b.n - a.n) || (b.last - a.last));
    hist.length = MAX_HISTORY;
  }
  commit({ redraw: false });
}

export function clearHistory() {
  state.profile.history = [];
  commit({ redraw: false });
}

/** All candidate sentences in the current language: past sentences plus
 *  saved phrases (a saved phrase counts as said once if never spoken). */
function candidates(lang) {
  const map = new Map();
  for (const e of state.profile.history) if (e.lang === lang) map.set(norm(e.text), { ...e });
  for (const ph of state.profile.phrases) {
    const text = ph.items.map(it => labelOf(it, lang)).join(' ');
    const k = norm(text);
    if (k && !map.has(k)) map.set(k, { text, lang, n: 1, last: 0, saved: true });
  }
  return [...map.values()];
}

/** Rank candidates against what has been typed (exported for testing). */
export function suggest(query, lang = state.profile.settings.lang) {
  const q = norm(query);
  const scored = [];
  for (const c of candidates(lang)) {
    const s = norm(c.text);
    if (q && s === q) continue;                 // already typed exactly
    let match = 0;
    if (!q) match = 1;
    else if (s.startsWith(q)) match = 3;
    else if (s.split(' ').some(w => w.startsWith(q))) match = 2;
    else if (s.includes(q)) match = 1;
    if (match) scored.push({ ...c, match });
  }
  scored.sort((a, b) => (b.match - a.match) || (b.n - a.n) || (b.last - a.last));
  return scored.slice(0, MAX_SUGGESTIONS);
}

/** Build the Type panel. `say(items)` speaks with all the usual fallbacks. */
export function renderTypePanel({ say }) {
  const lang = state.profile.settings.lang;
  let saved = '';
  try { saved = localStorage.getItem(TYPED_KEY) || ''; } catch (e) { /* ignore */ }

  const box = h('textarea', {
    id: 'type-box', lang, dir: 'auto', rows: 3, autocomplete: 'off', autocapitalize: 'sentences',
    spellcheck: 'false', placeholder: t('type.placeholder'), 'aria-label': t('type.placeholder'),
  });
  box.value = saved;
  const list = h('div', { class: 'suggestions', role: 'list', 'aria-label': t('type.suggestions') });

  const store = () => { try { localStorage.setItem(TYPED_KEY, box.value); } catch (e) { /* ignore */ } };
  const refresh = () => {
    const items = suggest(box.value, lang);
    list.replaceChildren(...(items.length ? items.map(c =>
      h('button', { class: 'chip suggestion', role: 'listitem', lang, onclick: () => {
        box.value = c.text; store(); refresh(); box.focus();
      } }, (c.saved ? '★ ' : '') + c.text))
      : [h('span', { class: 'hint' }, state.profile.history.length || state.profile.phrases.length ? t('type.noMatch') : t('type.empty'))]));
  };
  const speak = () => {
    const text = box.value.trim();
    if (!text) { box.focus(); return; }
    // Typed text exists only in this language: speech never reads it with a
    // voice for another language (see speech.js); if no voice, it is shown.
    say([{ text: { [lang]: text }, emoji: '⌨️' }]);
    rememberSentence(text, lang);
    refresh();
  };
  box.addEventListener('input', () => { store(); refresh(); });

  refresh();
  return h('div', { class: 'type-panel' },
    box,
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn speak', onclick: speak }, t('btn.speak')),
      h('button', { class: 'btn', onclick: () => { box.value = ''; store(); refresh(); box.focus(); } }, '✕ ' + t('btn.clear'))),
    h('p', { class: 'hint' }, t('type.hint')),
    list);
}
