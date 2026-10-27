// speech.js — reliable voice output.
//
// Order of preference for each word:
//   1. a caregiver recording attached to the button
//   2. the browser's speech synthesis in the chosen language
//   3. speech synthesis in the other language (Hindi <-> English)
//   4. no sound possible -> the sentence is shown in large text on screen
// Every fallback is reported back to the caller so the app can show a visible
// message. Nothing here fails silently: every path either plays sound or
// returns a problem description.

import { getMediaBlob } from './store.js';

const LANG_CODES = { en: ['en-IN', 'en'], hi: ['hi-IN', 'hi'] };
const LANG_NAMES = { en: 'English', hi: 'Hindi' };

let voicesCache = null;
// After synthesis fails to start, skip it for 30 s so each tap does not wait
// another 3 s before falling back. Cleared when the voice list changes.
const brokenUntil = { en: 0, hi: 0 };

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
    brokenUntil.en = brokenUntil.hi = 0;
  });
}

/** Pick the best voice for 'en' or 'hi'. Returns {voice, status} where status
 *  is 'ok', 'no-voice' (voices exist but none for this language), or
 *  'unknown' (browser reports no voices at all — we will still try). */
export async function pickVoice(lang) {
  const voices = await getVoices();
  if (!voices.length) return { voice: null, status: 'unknown' };
  const [exact, base] = LANG_CODES[lang];
  const norm = v => v.lang.replace('_', '-').toLowerCase();
  const voice =
    voices.find(v => norm(v) === exact.toLowerCase() && v.localService) ||
    voices.find(v => norm(v) === exact.toLowerCase()) ||
    voices.find(v => norm(v).startsWith(base));
  return voice ? { voice, status: 'ok' } : { voice: null, status: 'no-voice' };
}

/** Speak one piece of text. Resolves {ok:true} or {ok:false, reason}.
 *  Uses timeouts because some browsers never fire 'start' or 'end'. */
export async function speakText(text, lang, rate = 0.9, force = false) {
  if (!('speechSynthesis' in window)) return { ok: false, reason: 'unsupported' };
  const { voice, status } = await pickVoice(lang);
  if (status === 'no-voice') return { ok: false, reason: 'no-voice' };
  if (!force && Date.now() < brokenUntil[lang]) return { ok: false, reason: 'no-start' };

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
      u.lang = voice ? voice.lang : LANG_CODES[lang][0];
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

const other = lang => (lang === 'hi' ? 'en' : 'hi');
const textOf = (item, lang) => (item[lang] || item.en || item.hi || '').trim();

/**
 * Speak a list of sentence items: [{en, hi, audio}].
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
    // 2) other language
    const alt = other(lang);
    r = await speakText(seg.items.map(i => textOf(i, alt)).join(' '), alt, rate);
    if (r.ok) { problems.push({ reason: 'used-other-language', lang: alt }); continue; }
    // 3) nothing worked for these words
    unvoiced.push(...seg.items);
  }
  return { problems, unvoiced };
}

/** Turn problems into one short, plain message for the user/caregiver. */
export function describeProblems(problems, lang) {
  if (!problems.length) return '';
  const reasons = new Set(problems.map(p => p.reason));
  const parts = [];
  if (reasons.has('unsupported')) parts.push('This browser cannot speak.');
  if (reasons.has('no-voice')) {
    const langs = [...new Set(problems.filter(p => p.reason === 'no-voice').map(p => LANG_NAMES[p.lang]))];
    parts.push(`No ${langs.join('/')} voice is installed on this device.`);
  }
  if (reasons.has('no-start') || reasons.has('error') || reasons.has('synthesis-failed'))
    parts.push('The voice did not start.');
  if (reasons.has('missing-recording') || reasons.has('bad-recording'))
    parts.push('A recording could not be played.');
  if (reasons.has('play-blocked')) parts.push('Sound was blocked — tap Speak again.');
  if (reasons.has('used-other-language')) {
    const used = problems.find(p => p.reason === 'used-other-language').lang;
    parts.push(`Spoke in ${LANG_NAMES[used]} instead.`);
  }
  if (!parts.length) return '';
  return parts.join(' ') + ' Recordings are used where available.';
}

/** For the Settings "Test voice" button: a full report on what works. */
export async function testVoices(rate) {
  const report = [];
  const voices = await getVoices();
  report.push(`Speech synthesis: ${'speechSynthesis' in window ? 'available' : 'NOT available'}`);
  report.push(`Voices on this device: ${voices.length}`);
  for (const lang of ['en', 'hi']) {
    const { voice, status } = await pickVoice(lang);
    const sample = lang === 'hi' ? 'नमस्ते, यह आवाज़ की जाँच है' : 'Hello, this is a voice test';
    const label = LANG_NAMES[lang];
    if (status === 'no-voice') { report.push(`❌ ${label}: no voice installed`); continue; }
    const r = await speakText(sample, lang, rate, true);
    report.push(r.ok
      ? `✅ ${label}: ${voice ? voice.name + ' (' + voice.lang + ')' : 'default voice'}`
      : `❌ ${label}: failed (${r.reason})`);
  }
  return report;
}
