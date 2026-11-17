// ops.js — the Bol API operations: build a sentence from tiles, autocomplete,
// search tiles and plan speech. Pure functions over the published API data
// (tiles.json, languages.json), with the app's own rules from js/core.js.
//
// Used by api/v1/bol.js (websites) and mcp/server.mjs (AI assistants), so
// both give the same answers. GitHub Pages cannot run code, which is why
// these run on the caller's side instead of on a server.

import {
  labelOf, matchLevel, matchPhrase, norm, candidates, rankSuggestions, sentenceText, speechPlan, MAX_SUGGESTIONS,
} from '../../js/core.js';

/** Index the API data once: {tiles, languages} -> lookups. */
export function prepare({ tiles, languages }) {
  const byId = new Map(tiles.map(t => [t.id, t]));
  return {
    tiles, languages, byId,
    langCodes: languages.map(l => l.code),
    phrases: tiles.filter(t => t.category === 'phrases').sort((a, b) => a.slot - b.slot),
    words: tiles.filter(t => t.category !== 'phrases'),
  };
}

function checkLang(lang, data) {
  if (!data.langCodes.includes(lang))
    throw new Error(`Unknown language "${lang}". Use one of: ${data.langCodes.join(', ')}`);
}

/**
 * Turn tile references into sentence items. A reference is
 *   "needs-2"            a tile
 *   "needs-2.alt0"       a tile's first long-press alternative
 *   {id: "needs-2", alt: 0}
 *   {text: "Ravi"} or {text: {en: "Ravi", hi: "रवि"}}   a typed word
 * Unknown tile ids throw an error that lists them.
 */
export function resolve(refs, data) {
  if (!Array.isArray(refs)) throw new Error('tiles must be a list of tile ids');
  const unknown = [];
  const items = refs.map(ref => {
    if (ref && typeof ref === 'object' && 'text' in ref) {
      // Typed text with no language key ({text: "Ravi"}) is read in the
      // sentence's language only, never with another language's voice.
      if (typeof ref.text === 'string') return { typed: true, text: { typed: ref.text } };
      if (ref.text && typeof ref.text === 'object') return { typed: true, text: ref.text };
      unknown.push(JSON.stringify(ref)); return null;
    }
    let id = typeof ref === 'string' ? ref : ref && ref.id;
    let alt = ref && typeof ref === 'object' ? ref.alt ?? null : null;
    const m = typeof id === 'string' && id.match(/^(.*)\.alt(\d+)$/);
    if (m) { id = m[1]; alt = Number(m[2]); }
    const tile = data.byId.get(id);
    if (!tile || (alt !== null && !tile.alternatives[alt])) { unknown.push(typeof ref === 'string' ? ref : JSON.stringify(ref)); return null; }
    return {
      id, alt, tile,
      text: alt === null ? tile.label : tile.alternatives[alt],
      // Not called `audio`: in the app that field means a caregiver recording.
      clips: alt === null ? tile.audio : (tile.alternativeAudio || [])[alt],
    };
  });
  if (unknown.length) throw new Error(`Unknown tile id(s): ${unknown.join(', ')}. Use search_tiles or tiles.json to find ids.`);
  return items;
}

/** Plain description of one item in a language (for answers). */
function describe(it, lang) {
  if (it.typed) return { typed: true, label: labelOf(it, lang) };
  return {
    id: it.alt === null ? it.id : `${it.id}.alt${it.alt}`,
    label: labelOf(it, lang),
    wordType: it.tile.wordType,
    emoji: it.tile.emoji,
    symbol: it.tile.symbol ? it.tile.symbol.url : null,
    audio: it.clips ? it.clips[lang] : null,
  };
}

/**
 * Build the sentence the app would show and speak for these tiles.
 * `text` is exactly the app's sentence (labels joined in the order tapped).
 * `phrase` is a ready-made sentence with natural word order that says the
 * same thing, when there is one (e.g. I + want + water in Hindi).
 */
export function buildSentence(refs, lang, data) {
  checkLang(lang, data);
  const items = resolve(refs, data);
  const phrase = items.some(it => it.typed) ? null : matchPhrase(items, data.phrases);
  return {
    lang,
    text: sentenceText(items, lang),
    words: items.map(it => describe(it, lang)),
    phrase: phrase ? { id: phrase.id, text: labelOf(phrase, lang), audio: phrase.audio[lang] } : null,
    speech: speechPlan(items, lang, data.languages),
    audio: items.map(it => (it.clips ? it.clips[lang] : null)),
  };
}

/**
 * Suggestions for what is being typed, ranked like the app's Type tab:
 * starts with it > a word starts with it > contains it, then said most
 * often, then most recently.
 *   sentences: from `history` (the caller's own past sentences,
 *              [{text, lang, n, last}]), `saved` phrases (lists of tile
 *              refs) and, unless starterPhrases is false, the 32 ready-made
 *              sentences. With starterPhrases false and the user's own data,
 *              the result is exactly what the app shows.
 *   tiles:     tiles whose label completes the last word typed.
 */
export function autocomplete(text, lang, data, { history = [], saved = [], starterPhrases = true, limit = MAX_SUGGESTIONS } = {}) {
  checkLang(lang, data);
  const savedPhrases = saved.map((refs, i) => ({ id: `saved-${i}`, items: resolve(refs, data) }));
  const pool = candidates({ history, phrases: [...savedPhrases, ...(starterPhrases ? data.phrases : [])], lang });
  const sentences = rankSuggestions(text, pool, limit).map(c => ({
    text: c.text,
    source: !c.saved ? 'history' : String(c.id || '').startsWith('saved-') ? 'saved' : 'starter',
    id: c.id && !String(c.id).startsWith('saved-') ? c.id : undefined,
    audio: c.id && data.byId.get(c.id) ? data.byId.get(c.id).audio[lang] : undefined,
    match: c.match, n: c.n,
  }));
  const lastWord = String(text || '').trim().split(/\s+/).pop() || '';
  const tiles = lastWord ? rankTiles(lastWord, data.words, lang, limit) : [];
  return { lang, text, sentences, tiles };
}

function rankTiles(query, tiles, lang, limit) {
  const scored = [];
  tiles.forEach((t, order) => {
    const match = matchLevel(query, labelOf(t, lang));
    if (match) scored.push({ t, match, order });
  });
  // Best match first; ties keep core words first (board order).
  scored.sort((a, b) => (b.match - a.match) || (a.order - b.order));
  return scored.slice(0, limit).map(({ t, match }) => ({
    id: t.id, label: labelOf(t, lang), category: t.category, wordType: t.wordType, emoji: t.emoji,
    audio: t.audio[lang], match,
  }));
}

/** Find tiles by label (any language, including alternatives), category or word type. */
export function searchTiles(data, { query = '', lang = null, category = null, wordType = null, limit = 20 } = {}) {
  if (lang) checkLang(lang, data);
  const langs = lang ? [lang] : data.langCodes;
  const out = [];
  for (const t of data.tiles) {
    if (category && t.category !== category) continue;
    if (wordType && t.wordType !== wordType) continue;
    let best = query ? 0 : 1;
    if (query) for (const l of langs) for (const txt of [t.label, ...t.alternatives])
      best = Math.max(best, matchLevel(query, txt[l] || ''));
    if (best) out.push({ t, best });
  }
  out.sort((a, b) => b.best - a.best);
  return out.slice(0, limit).map(({ t, best }) => ({
    id: t.id, category: t.category, slot: t.slot, label: t.label, wordType: t.wordType, emoji: t.emoji,
    alternatives: t.alternatives.length, match: best,
  }));
}

export { norm, labelOf };
