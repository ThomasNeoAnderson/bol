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

import { state, commit } from './state.js';
import { addToHistory, candidates, clean, rankSuggestions } from './core.js';
import { h } from './ui.js';
import { t } from './i18n.js';

const TYPED_KEY = 'bol-typed';            // unfinished typed text, survives a force-close

/** Remember a spoken sentence (typed, or built on the board) for suggestions. */
export function rememberSentence(text, lang = state.profile.settings.lang) {
  if (!clean(text)) return;
  addToHistory(state.profile.history, text, lang);
  commit({ redraw: false });
}

export function clearHistory() {
  state.profile.history = [];
  commit({ redraw: false });
}

/** Rank this user's past sentences and saved phrases against what has been
 *  typed (rules in core.js, shared with the API and MCP server). */
export function suggest(query, lang = state.profile.settings.lang) {
  return rankSuggestions(query, candidates({ history: state.profile.history, phrases: state.profile.phrases, lang }));
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
