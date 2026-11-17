// core.js — Bol's rules for words, sentences, suggestions and speech, with
// no browser or storage code, so the same file is used by:
//   - the app itself (js/typing.js, js/speech.js, js/i18n.js)
//   - the JavaScript API client (api/v1/bol.js, for websites)
//   - the MCP server (mcp/server.mjs, for AI assistants)
// One copy of the rules means the API and the MCP server behave exactly like
// the app. Change behaviour here, and the tests check all three.

/** Text from a {en, hi, ta, kn} object in one language, falling back to
 *  English and then to any language that has text. */
export function pick(textObj, lang) {
  if (!textObj) return '';
  if (typeof textObj === 'string') return textObj;
  return textObj[lang] || textObj.en || Object.values(textObj).find(Boolean) || '';
}

/** Label of a tile, button or sentence item. Also reads the old v1 shape
 *  {en, hi} and the API tile shape {label: {...}}. */
export function labelOf(item, lang) {
  if (!item) return '';
  return pick(item.text || item.label || { en: item.en, hi: item.hi }, lang);
}

/** Lower-case, single-spaced, Unicode-normalised text for comparing. */
export const norm = s => String(s || '').normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** Clean text for storing or speaking: normalised, single spaces. */
export const clean = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ sentences ---

/** The sentence the app shows and speaks for a list of tiles: each tile's
 *  label in the language, joined with spaces, in the order tapped. Bol does
 *  not reorder words (see TESTING.md, known limitations). */
export function sentenceText(items, lang) {
  return items.map(it => labelOf(it, lang).trim()).filter(Boolean).join(' ');
}

/** A ready-made sentence (Phrases board) that says the same as these tiles,
 *  compared in English, or null. Lets callers offer the natural word order,
 *  e.g. I + want + water -> "मुझे पानी चाहिए" instead of "मैं चाहिए पानी". */
export function matchPhrase(items, phrases) {
  if (items.length < 2) return null;
  const key = norm(sentenceText(items, 'en'));
  return phrases.find(p => norm(labelOf(p, 'en')) === key) || null;
}

// ---------------------------------------------------------- suggestions ---

export const MAX_SUGGESTIONS = 8;

/** Candidate sentences in one language: past sentences (history entries
 *  {text, lang, n, last}) plus saved phrases. A phrase never said counts as
 *  said once. `phrases` are sentence item lists or tiles. */
export function candidates({ history = [], phrases = [], lang }) {
  const map = new Map();
  for (const e of history) if (e.lang === lang) map.set(norm(e.text), { ...e });
  for (const ph of phrases) {
    const text = ph.items ? ph.items.map(it => labelOf(it, lang)).join(' ') : labelOf(ph, lang);
    const k = norm(text);
    if (k && !map.has(k)) map.set(k, { text, lang, n: 1, last: 0, saved: true, ...(ph.id ? { id: ph.id } : {}) });
  }
  return [...map.values()];
}

/** How well a text matches what is typed: 3 starts with it, 2 a word starts
 *  with it, 1 contains it (or nothing typed yet), 0 no match. */
export function matchLevel(query, text) {
  const q = norm(query), s = norm(text);
  if (!q) return 1;
  if (s.startsWith(q)) return 3;
  if (s.split(' ').some(w => w.startsWith(q))) return 2;
  if (s.includes(q)) return 1;
  return 0;
}

/** Rank candidates against the typed text: best match first, then said
 *  most often, then said most recently. Exact matches are skipped. */
export function rankSuggestions(query, cands, max = MAX_SUGGESTIONS) {
  const q = norm(query);
  const scored = [];
  for (const c of cands) {
    if (q && norm(c.text) === q) continue;
    const match = matchLevel(q, c.text);
    if (match) scored.push({ ...c, match });
  }
  scored.sort((a, b) => (b.match - a.match) || (b.n - a.n) || (b.last - a.last));
  return scored.slice(0, max);
}

/** Add one spoken sentence to a history list (changes and returns it). */
export function addToHistory(history, text, lang, now = Date.now(), maxHistory = 300) {
  const c = clean(text);
  if (!c) return history;
  const key = norm(c);
  const found = history.find(e => e.lang === lang && norm(e.text) === key);
  if (found) { found.n += 1; found.last = now; found.text = c; }
  else history.push({ text: c, lang, n: 1, last: now });
  if (history.length > maxHistory) {
    history.sort((a, b) => (b.n - a.n) || (b.last - a.last));
    history.length = maxHistory;
  }
  return history;
}

// --------------------------------------------------------------- speech ---

const textObj = item => item.text || item.label || { en: item.en, hi: item.hi };
/** True when the item really has text in this language (not a fallback). */
export const hasText = (item, lang) => !!(textObj(item)[lang] || '').trim();

/** Split a sentence into what is spoken together: a run of words without
 *  recordings is one utterance (sounds natural); a recording plays alone. */
export function segments(items) {
  const out = [];
  for (const it of items) {
    if (it.audio) out.push({ type: 'rec', item: it, items: [it] });
    else {
      const last = out[out.length - 1];
      if (last && last.type === 'tts') last.items.push(it);
      else out.push({ type: 'tts', items: [it] });
    }
  }
  return out;
}

/**
 * What the app would try to say, in order, for a list of items, without
 * playing anything. `languages` is data/languages.json (or the API's
 * languages.json). Each step: {type: 'recording', item} or
 * {type: 'speech', lang, voices: ['ta-IN', 'ta'], text, fallback: {lang,
 * voices, text} | null}. If no voice works, the app shows the words on screen.
 */
export function speechPlan(items, lang, languages) {
  const info = code => languages.find(l => l.code === code) || languages[0];
  return segments(items).map(seg => {
    if (seg.type === 'rec') return { type: 'recording', item: seg.item };
    const text = seg.items.map(i => pick(textObj(i), lang).trim()).join(' ');
    const alt = info(lang).fallback;
    const fallback = alt && alt !== lang && seg.items.every(i => hasText(i, alt))
      ? { lang: alt, voices: info(alt).speech, text: seg.items.map(i => pick(textObj(i), alt).trim()).join(' ') }
      : null;
    return { type: 'speech', lang, voices: info(lang).speech, text, fallback };
  });
}
