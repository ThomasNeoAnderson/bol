// i18n.js — languages and interface text, loaded from data files.
//
// data/languages.json : which languages exist, their speech codes, fallback
// data/ui.json        : every interface string, keyed, in every language
// Adding a language is a data-only change: add it to languages.json and add a
// column for it in ui.json and vocab.json (see tools/ and vocab_review.csv).

let LANGS = [];
let STR = {};
let current = 'en';

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

export async function loadI18n() {
  [LANGS, STR] = await Promise.all([fetchJSON('data/languages.json'), fetchJSON('data/ui.json')]);
}

export const languages = () => LANGS;
export const langInfo = code => LANGS.find(l => l.code === code) || LANGS[0];
export const getLang = () => current;
export function setLang(code) { current = langInfo(code).code; }

/** Pick a string from a {en, hi, ...} object, falling back to English and
 *  then to any language that has text. */
export function pick(textObj, lang = current) {
  if (!textObj) return '';
  if (typeof textObj === 'string') return textObj;
  return textObj[lang] || textObj.en || Object.values(textObj).find(Boolean) || '';
}

/** Interface text: t('key', {n: 3}) replaces {n} in the string. */
export function t(key, vars) {
  const entry = STR[key];
  let s = entry ? pick(entry) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}
