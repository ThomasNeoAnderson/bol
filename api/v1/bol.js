// bol.js — JavaScript client for the Bol API, for websites (and Node 18+
// when run from a clone of the repository).
//
//   import * as bol from 'https://thomasneoanderson.github.io/bol/api/v1/bol.js';
//   const s = await bol.buildSentence(['core-0', 'core-2', 'needs-7'], 'hi');
//   s.text            // "मैं चाहिए पानी"  (what the app would say)
//   s.phrase.text     // "मुझे पानी चाहिए" (ready-made sentence, natural order)
//   await bol.speak(['core-0', 'core-2', 'needs-7'], 'hi');   // plays audio
//
// GitHub Pages only serves files, so the operations run here, on the
// caller's side, using the same rules as the app (js/core.js via ops.js).
// See API.md for every function.

import * as ops from './ops.js';

const BASE = new URL('./', import.meta.url).href;
let cache = null;

async function getJSON(path) {
  const url = new URL(path, BASE);
  if (url.protocol === 'file:') {                        // Node, from a clone
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(url, 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bol API: could not load ${url} (${res.status})`);
  return res.json();
}

/** Load (once) and return the indexed API data. */
export async function load() {
  if (!cache) {
    cache = Promise.all([getJSON('tiles.json'), getJSON('languages.json'), getJSON('categories.json')])
      .then(([tiles, languages, categories]) => ({ ...ops.prepare({ tiles, languages }), categories }))
      .catch(e => { cache = null; throw e; });
  }
  return cache;
}

export const languages = async () => (await load()).languages;
export const categories = async () => (await load()).categories;
export const getCategory = id => getJSON(`categories/${encodeURIComponent(id)}.json`);
export async function getTile(id) {
  const t = (await load()).byId.get(id);
  if (!t) throw new Error(`Unknown tile id: ${id}`);
  return t;
}

/** Find tiles: {query, lang, category, wordType, limit}. */
export const searchTiles = async (options = {}) => ops.searchTiles(await load(), options);

/** Sentence from tile ids (or {text} typed words), as the app builds it. */
export const buildSentence = async (tiles, lang) => ops.buildSentence(tiles, lang, await load());

/** Suggestions for typed text: {history, saved, starterPhrases, limit}. */
export const autocomplete = async (text, lang, options = {}) => ops.autocomplete(text, lang, await load(), options);

/**
 * Speak tiles in a browser. Plays the pre-made audio clips (robotic
 * open-source voice), one per tile, or the ready-made phrase's clip when the
 * tiles match one and {usePhrase: true}. With {voice: 'device'} it instead
 * uses the browser's own speech voice like the app does. Words without a clip
 * (typed words) are spoken with the browser's voice if it has one, otherwise
 * listed in `unvoiced`. Returns {played: [urls], device: [texts], unvoiced}.
 */
export async function speak(tiles, lang, { usePhrase = false, voice = 'clips' } = {}) {
  const s = await buildSentence(tiles, lang);
  const result = { sentence: s, played: [], device: [], unvoiced: [] };
  if (voice === 'device') {
    if (await deviceSay(s.text, s.speech[0] ? s.speech[0].voices : [lang])) result.device.push(s.text);
    else result.unvoiced.push(s.text);
    return result;
  }
  const steps = usePhrase && s.phrase ? [{ url: s.phrase.audio, text: s.phrase.text }]
    : s.words.map(w => ({ url: w.audio, text: w.label }));
  for (const step of steps) {
    if (step.url) { await playUrl(step.url); result.played.push(step.url); }
    else if (await deviceSay(step.text, s.speech[0] ? s.speech[0].voices : [lang])) result.device.push(step.text);
    else result.unvoiced.push(step.text);
  }
  return result;
}

function playUrl(url) {
  if (typeof Audio === 'undefined') throw new Error('speak() plays audio in a browser; in Node use the audio URLs');
  return new Promise((resolve, reject) => {
    const a = new Audio(url);
    a.onended = resolve;
    a.onerror = () => reject(new Error('Could not play ' + url));
    a.play().catch(reject);
  });
}

function deviceSay(text, voices) {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve(false);
  const all = speechSynthesis.getVoices();
  const voice = voices.map(c => all.find(v => v.lang.replace('_', '-').toLowerCase().startsWith(c.toLowerCase()))).find(Boolean);
  if (!voice) return Promise.resolve(false);
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice; u.lang = voice.lang; u.rate = 0.9;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}
