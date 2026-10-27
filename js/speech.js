// speech.js — reliable voice output.
//
// Order of preference for each word:
//   1. a caregiver recording attached to the button
//   2. the browser's speech synthesis in the chosen language
//   3. speech synthesis in the language's fallback (from languages.json),
//      only when the words also have text in that language
//   4. no sound possible -> the sentence is shown in large text on screen
// Every fallback is reported back to the caller so the app can show a visible
// message. Nothing here fails silently: every path either plays sound or
// returns a problem description.

import { getMediaBlob } from './store.js';
import { langInfo, languages, pick, t } from './i18n.js';

let voicesCache = null;
// After synthesis fails to start, skip it for 30 s so each tap does not wait
// another 3 s before falling back. Cleared when the voice list changes.
const brokenUntil = {};

/** Voices load asynchronously in most browsers; wait up to 2 s for them. */
export function getVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) { voicesCache = now; return Promise.resolve(now); }
  if (voicesCache) return Promise.resolve(voicesCache);
  return new Promise(resolve => {
    const done = () => { voicesCache = speechSynthesis.getVoices(); resolve(voicesCache); };
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 2000);
  });
}

if ('speechSynthesis' in window) {
  // Refresh when the user installs a new voice while the app is open.
  speechSynthesis.addEventListener('voiceschanged', () => {
    voicesCache = speechSynthesis.getVoices();
    for (const k of Object.keys(brokenUntil)) brokenUntil[k] = 0;
  });
}

/** Pick the best voice for a language code. Returns {voice, status} where status
 *  is 'ok', 'no-voice' (voices exist but none for this language), or
 *  'unknown' (browser reports no voices at all — we will still try). */
export async function pickVoice(lang) {
  const voices = await getVoices();
  if (!voices.length) return { voice: null, status: 'unknown' };
  // Try each code in languages.json order (e.g. ta-IN, then ta), preferring
  // voices that work offline (localService).
  const norm = v => v.lang.replace('_', '-').toLowerCase();
  for (const code of langInfo(lang).speech) {
    const c = code.toLowerCase();
    const match = v => (c.includes('-') ? norm(v) === c : norm(v).split('-')[0] === c);
    const voice = voices.find(v => match(v) && v.localService) || voices.find(match);
    if (voice) return { voice, status: 'ok' };
  }
  return { voice: null, status: 'no-voice' };
}

/** Speak one piece of text. Resolves {ok:true} or {ok:false, reason}.
 *  Uses timeouts because some browsers never fire 'start' or 'end'. */
export async function speakText(text, lang, rate = 0.9, force = false) {
  if (!('speechSynthesis' in window)) return { ok: false, reason: 'unsupported' };
  const { voice, status } = await pickVoice(lang);
  if (status === 'no-voice') return { ok: false, reason: 'no-voice' };
  if (!force && Date.now() < (brokenUntil[lang] || 0)) return { ok: false, reason: 'no-start' };

  return new Promise(resolve => {
    let started = false, finished = false;
    let startTimer, endTimer, keepAlive;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(startTimer); clearTimeout(endTimer); clearInterval(keepAlive);
      resolve(result);
    };
    try {
      speechSynthesis.cancel();              // clears a stuck queue (Chrome bug)
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : langInfo(lang).speech[0];
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onstart = () => { started = true; };
      u.onend = () => finish({ ok: true });
      u.onerror = e => {
        // 'interrupted'/'canceled' mean WE stopped it (new tap): not a failure.
        if (e.error === 'interrupted' || e.error === 'canceled') finish({ ok: true, interrupted: true });
        else finish({ ok: false, reason: e.error || 'error' });
      };
      speechSynthesis.speak(u);
    } catch (e) {
      finish({ ok: false, reason: 'error' });
      return;
    }
    if (finished) return;
    // If speech has not started after 3 s, treat it as a failure.
    startTimer = setTimeout(() => {
      if (!started && !speechSynthesis.speaking) {
        speechSynthesis.cancel();
        brokenUntil[lang] = Date.now() + 30000;
        finish({ ok: false, reason: 'no-start' });
      }
    }, 3000);
    // Safety net: never wait forever for 'end'.
    endTimer = setTimeout(() => finish({ ok: true }), 4000 + text.length * 250);
    // Chrome pauses long utterances after ~15 s; nudging it keeps it going.
    keepAlive = setInterval(() => { if (speechSynthesis.speaking) speechSynthesis.resume(); }, 5000);
  });
}

let currentAudio = null;
// Increases every time speech is stopped; a running sentence checks it so an
// old sentence never keeps talking over a new one.
let generation = 0;

/** Play a recorded clip by media id. Resolves {ok} — never rejects. */
export async function playRecording(mediaId) {
  let blob;
  try { blob = await getMediaBlob(mediaId); } catch (e) { return { ok: false, reason: 'missing-recording' }; }
  if (!blob) return { ok: false, reason: 'missing-recording' };
  const url = URL.createObjectURL(blob);
  return new Promise(resolve => {
    const audio = new Audio(url);
    currentAudio = audio;
    let done = false, t;
    const finish = r => { if (done) return; done = true; clearTimeout(t); URL.revokeObjectURL(url); resolve(r); };
    audio.onended = () => finish({ ok: true });
    audio.onpause = () => finish({ ok: true });     // stopped by stopAll()
    audio.onerror = () => finish({ ok: false, reason: 'bad-recording' });
    // Recordings are capped at 10 s, so 15 s means something is stuck.
    t = setTimeout(() => { audio.pause(); finish({ ok: true }); }, 15000);
    audio.play().catch(() => finish({ ok: false, reason: 'play-blocked' }));
  });
}

export function stopAll() {
  generation++;
  try { speechSynthesis.cancel(); } catch (e) {}
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

const textObj = item => item.text || { en: item.en, hi: item.hi };
const textOf = (item, lang) => pick(textObj(item), lang).trim();
// Only fall back to another language's voice when every word really has text
// in that language (typed Tamil must never be read by an English voice).
const hasText = (item, lang) => !!(textObj(item)[lang] || '').trim();

/**
 * Speak a list of sentence items: [{text: {en, hi, …}, audio}].
 * Consecutive items without recordings are joined into one utterance so the
 * sentence sounds natural. Returns {problems: [...], shown: bool} where
 * 'shown' means some words could not be voiced and must be shown on screen.
 */
export async function speakItems(items, lang, rate) {
  const problems = [];
  const unvoiced = [];
  const myGen = generation;
  const cancelled = () => generation !== myGen;

  // Split into segments: recording | run of text
  const segments = [];
  for (const it of items) {
    if (it.audio) segments.push({ type: 'rec', item: it });
    else {
      const last = segments[segments.length - 1];
      if (last && last.type === 'tts') last.items.push(it);
      else segments.push({ type: 'tts', items: [it] });
    }
  }

  for (const seg of segments) {
    if (cancelled()) break;
    if (seg.type === 'rec') {
      const r = await playRecording(seg.item.audio);
      if (r.ok || cancelled()) continue;
      problems.push({ reason: r.reason });
      seg.items = [seg.item]; // recording broken: fall through to synthesis
    }
    // 1) chosen language
    let r = await speakText(seg.items.map(i => textOf(i, lang)).join(' '), lang, rate);
    if (r.ok || cancelled()) continue;
    problems.push({ reason: r.reason, lang });
    // 2) fallback language, if the words exist in it
    const alt = langInfo(lang).fallback;
    if (alt && alt !== lang && seg.items.every(i => hasText(i, alt))) {
      r = await speakText(seg.items.map(i => textOf(i, alt)).join(' '), alt, rate);
      if (r.ok) { problems.push({ reason: 'used-other-language', lang: alt }); continue; }
    }
    // 3) nothing worked for these words
    unvoiced.push(...seg.items);
  }
  return { problems, unvoiced };
}

/** Turn problems into one short, plain message for the user/caregiver. */
export function describeProblems(problems) {
  if (!problems.length) return '';
  const reasons = new Set(problems.map(p => p.reason));
  const name = code => langInfo(code).name;
  const parts = [];
  if (reasons.has('unsupported')) parts.push(t('voice.unsupported'));
  if (reasons.has('no-voice')) {
    const langs = [...new Set(problems.filter(p => p.reason === 'no-voice').map(p => name(p.lang)))];
    parts.push(t('voice.noVoice', { lang: langs.join(' / ') }));
  }
  if (reasons.has('no-start') || reasons.has('error') || reasons.has('synthesis-failed'))
    parts.push(t('voice.noStart'));
  if (reasons.has('missing-recording') || reasons.has('bad-recording')) parts.push(t('voice.badRecording'));
  if (reasons.has('play-blocked')) parts.push(t('voice.blocked'));
  if (reasons.has('used-other-language')) {
    const used = problems.find(p => p.reason === 'used-other-language').lang;
    parts.push(t('voice.usedOther', { lang: name(used) }));
  }
  if (!parts.length) return '';
  return parts.join(' ') + ' ' + t('voice.recordingsUsed');
}

/** For Settings -> Test voice: per-language status, speaking a sample in
 *  every language that has a voice. Returns
 *  {available, count, langs: [{code, name, status: 'ok'|'missing'|'failed', voice, reason}]} */
export async function testVoices(rate) {
  const voices = await getVoices();
  const result = { available: 'speechSynthesis' in window, count: voices.length, langs: [] };
  for (const l of languages()) {
    const { voice, status } = await pickVoice(l.code);
    if (status === 'no-voice') { result.langs.push({ code: l.code, name: l.name, status: 'missing' }); continue; }
    const r = await speakText(l.sample, l.code, rate, true);
    result.langs.push({ code: l.code, name: l.name, status: r.ok ? 'ok' : 'failed',
      voice: voice ? `${voice.name} (${voice.lang})` : '', reason: r.reason });
  }
  return result;
}
