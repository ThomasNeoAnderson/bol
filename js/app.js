// app.js — starts the app and draws the main communication board.
//
// Screen layout (top to bottom):
//   toolbar      : language toggle, caregiver controls
//   sentence bar : tapped words + Delete / Clear / Save / Speak
//   status line  : visible messages (voice problems, restores, errors)
//   My phrases   : saved sentences, one tap to speak
//   Recent       : recently spoken words
//   tabs         : Now + categories
//   grid         : the symbol buttons, each in a fixed slot

import { state, commit, setRenderer, labelOf, catById, showStatus } from './state.js';
import { loadProfile, saveDraft, loadDraft, takeSnapshot, collectGarbage, requestPersistence,
         onSaveStatus, getMediaURL, saveProfile } from './store.js';
import { speakItems, describeProblems, stopAll } from './speech.js';
import { currentRoutine } from './routines.js';
import { h, onPress, openModal } from './ui.js';
import { toggleCaregiver, openEditor, openSettings, openVoiceTest, moveButtonTo, exportBackup,
         restoreLastWorking } from './caregiver.js';

const $ = id => document.getElementById(id);

// --------------------------------------------------------------- startup ---

async function boot() {
  // If this flag is still set from last time, the app crashed while starting.
  const crashedLastTime = localStorage.getItem('bol-booting') === '1';
  localStorage.setItem('bol-booting', '1');

  let source = 'new';
  try {
    ({ profile: state.profile, source } = await loadProfile());
  } catch (e) {
    console.error(e);
    const { createDefaultProfile } = await import('./vocab.js');
    state.profile = createDefaultProfile();
    showStatus('Saved data could not be opened. Showing the starter board.', 'error',
      [{ label: 'Restore last working version', onClick: restoreLastWorking }]);
  }
  if (source === 'new') {
    // First launch: fewer columns on a phone in portrait so buttons stay big.
    state.profile.settings.cols = window.innerWidth < 600 ? 4 : 6;
    saveProfile(state.profile);
  }

  state.sentence = loadDraft();
  state.tab = state.profile.routines.enabled ? 'now' : state.profile.categories[0].id;

  setRenderer(renderAll);
  wireStaticButtons();
  renderAll();

  // We got this far, so this version works: clear the flag and snapshot it.
  localStorage.removeItem('bol-booting');
  takeSnapshot(state.profile, 'startup').then(() => collectGarbage(state.profile)).catch(console.error);

  if (crashedLastTime) {
    showStatus('Bol did not start properly last time.', 'warn',
      [{ label: 'Restore last working version', onClick: restoreLastWorking }]);
  } else if (source === 'snapshot') {
    showStatus('Your board could not be read, so the last automatic snapshot was loaded.', 'warn');
  } else if (state.sentence.length) {
    showStatus('Your unfinished sentence was restored.', 'info');
  }

  requestPersistence();
  registerServiceWorker();
}

onSaveStatus(r => {
  if (!r.ok) showStatus('Changes could NOT be saved (storage may be full). Please export a backup.', 'error',
    [{ label: 'Export backup', onClick: exportBackup }]);
});

// Any unexpected error: tell the user, keep the app usable, offer a restore.
window.addEventListener('error', e => reportError(e.message));
window.addEventListener('unhandledrejection', e => reportError(e.reason && e.reason.message));
function reportError(msg) {
  console.error('Bol error:', msg);
  showStatus(`Something went wrong${msg ? ' (' + msg + ')' : ''}. Your board is saved.`, 'error',
    [{ label: 'Restore last working version', onClick: restoreLastWorking }]);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
}

// Re-check the routine when the app comes back to the foreground. We do NOT
// switch boards on a timer while someone is using the screen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.profile && state.tab === 'now') renderAll();
  if (document.visibilityState === 'hidden') saveDraft(state.sentence);
});

// Some browsers only grant persistent storage after a user gesture.
document.addEventListener('pointerdown', () => requestPersistence(), { once: true });

// ------------------------------------------------------------- rendering ---

function renderAll() {
  applySettings();
  renderToolbar();
  renderSentence();
  renderPhrases();
  renderRecent();
  renderTabs();
  renderNowBar();
  renderGrid();
}

/** Copy display settings onto <html> so CSS can react to them. */
function applySettings() {
  const s = state.profile.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.bsize = s.buttonSize;
  root.dataset.tsize = s.textSize;
  root.dataset.colors = s.colorByCategory ? 'on' : 'off';
  root.dataset.caregiver = state.caregiver ? 'on' : 'off';
  root.lang = s.lang;
  root.style.setProperty('--cols', s.cols);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',
    s.theme === 'dark' || s.theme === 'contrast' ? '#000000' : '#2a6f97');
}

function renderToolbar() {
  const s = state.profile.settings;
  $('lang-toggle').textContent = s.lang === 'en' ? 'EN → हिंदी' : 'हिंदी → EN';
  $('cg-toggle').textContent = state.caregiver ? '✔ Done' : '🔒 Caregiver';
  $('cg-tools').hidden = !state.caregiver;
  $('btn-save').hidden = !s.showPhrases;
}

/** An icon: the photo if there is one (loaded async), otherwise the emoji.
 *  If the photo fails to load, the emoji stays — the UI never waits on it. */
function iconEl(item) {
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' }, item.emoji || '⬜');
  if (item.img) {
    getMediaURL(item.img).then(url => {
      if (!url) return;
      const img = h('img', { alt: '', src: url, draggable: 'false' });
      img.onload = () => span.replaceChildren(img);
      img.onerror = () => {};           // keep the emoji
    }).catch(() => {});
  }
  return span;
}

function renderSentence() {
  const bar = $('sentence');
  if (!state.sentence.length) {
    bar.replaceChildren(h('span', { class: 'sentence-hint' },
      state.profile.settings.lang === 'hi' ? 'चित्र दबाएँ…' : 'Tap pictures to talk…'));
  } else {
    bar.replaceChildren(...state.sentence.map(it =>
      h('span', { class: 'chip', role: 'listitem' }, iconEl(it), h('span', {}, labelOf(it)))));
    bar.scrollLeft = bar.scrollWidth;
  }
  $('btn-speak').disabled = $('btn-delete').disabled = $('btn-clear').disabled = !state.sentence.length;
  $('btn-save').disabled = !state.sentence.length;
}

function renderPhrases() {
  const strip = $('phrases');
  const phrases = state.profile.phrases;
  strip.hidden = !state.profile.settings.showPhrases;
  if (strip.hidden) return;
  const title = h('span', { class: 'strip-title' }, state.profile.settings.lang === 'hi' ? 'मेरे वाक्य' : 'My phrases');
  if (!phrases.length) {
    strip.replaceChildren(title, h('span', { class: 'strip-empty' },
      state.profile.settings.lang === 'hi' ? 'वाक्य बनाएँ, फिर ★ दबाएँ' : 'Make a sentence, then tap ★ Save'));
    return;
  }
  strip.replaceChildren(title, ...phrases.map((ph, i) => {
    const chip = h('button', { class: 'chip phrase', onclick: () => speakPhrase(ph) },
      iconEl(ph.items[0] || {}), h('span', {}, ph.items.map(it => labelOf(it)).join(' ')));
    if (!state.caregiver) return chip;
    // Caregiver mode: reorder (◀ ▶) and delete controls on each phrase.
    const move = dir => {
      const arr = state.profile.phrases, j = i + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      commit();
    };
    return h('span', { class: 'phrase-edit' },
      h('button', { class: 'btn small', 'aria-label': 'Move left', onclick: () => move(-1) }, '◀'),
      chip,
      h('button', { class: 'btn small', 'aria-label': 'Move right', onclick: () => move(1) }, '▶'),
      h('button', { class: 'btn small danger', 'aria-label': 'Delete phrase', onclick: () => {
        state.profile.phrases.splice(i, 1); commit(); } }, '✕'));
  }));
}

function renderRecent() {
  const strip = $('recent');
  strip.hidden = !state.profile.settings.showRecent || !state.profile.recent.length;
  if (strip.hidden) return;
  strip.replaceChildren(
    h('span', { class: 'strip-title' }, state.profile.settings.lang === 'hi' ? 'हाल के' : 'Recent'),
    ...state.profile.recent.map(it =>
      h('button', { class: 'chip', onclick: () => addToSentence({ ...it }) }, iconEl(it), h('span', {}, labelOf(it)))));
}

function renderTabs() {
  const tabs = $('tabs');
  const lang = state.profile.settings.lang;
  const list = [];
  if (state.profile.routines.enabled) list.push({ id: 'now', en: 'Now', hi: 'अभी', emoji: '⏰', color: '#2a6f97' });
  list.push(...state.profile.categories);
  if (!list.some(c => c.id === state.tab)) state.tab = list[0].id;
  tabs.replaceChildren(...list.map(c =>
    h('button', {
      class: `tab ${state.tab === c.id ? 'active' : ''}`,
      style: { '--cat': c.color },
      'aria-pressed': String(state.tab === c.id),
      onclick: () => { state.tab = c.id; state.moving = null; renderTabs(); renderNowBar(); renderGrid(); },
    }, h('span', { 'aria-hidden': 'true' }, c.emoji), ' ', c[lang] || c.en)));
}

/** Which board the Now tab shows right now. */
function nowBoard() {
  const o = state.nowOverride;
  if (o && Date.now() < o.until && catById(o.cat)) return { cat: o.cat, rule: null, override: true };
  state.nowOverride = null;
  const { rule, cat } = currentRoutine(state.profile.routines);
  return { cat: catById(cat) ? cat : state.profile.categories[0].id, rule, override: false };
}

function renderNowBar() {
  const bar = $('now-bar');
  bar.hidden = state.tab !== 'now';
  if (bar.hidden) return;
  const { cat, rule, override } = nowBoard();
  const c = catById(cat);
  const lang = state.profile.settings.lang;
  const what = override ? 'Chosen board' : rule ? rule.name : 'No routine right now';
  bar.replaceChildren(
    h('span', {}, `🕗 ${what} → ${c.emoji} ${c[lang] || c.en}`),
    h('button', { class: 'btn small', onclick: pickOverride }, 'Change board'),
    ...(override ? [h('button', { class: 'btn small', onclick: () => { state.nowOverride = null; renderNowBar(); renderGrid(); } },
      'Back to suggestion')] : []));
}

/** Manual override for the Now screen; lasts 2 hours. */
function pickOverride() {
  const lang = state.profile.settings.lang;
  const close = openModal({
    title: 'Show which board now?',
    body: h('div', { class: 'pick-list' }, state.profile.categories.map(c =>
      h('button', { class: 'btn big', style: { '--cat': c.color }, onclick: () => {
        state.nowOverride = { cat: c.id, until: Date.now() + 2 * 3600 * 1000 };
        close(); renderNowBar(); renderGrid();
      } }, `${c.emoji} ${c[lang] || c.en}`))),
  });
}

function currentCat() {
  return state.tab === 'now' ? nowBoard().cat : state.tab;
}

/** Draw the grid. Every button sits in its own slot number, and empty slots
 *  are drawn as blanks, so adding or hiding nothing ever shifts a button. */
function renderGrid() {
  const grid = $('grid');
  const catId = currentCat();
  const cat = catById(catId);
  const cols = state.profile.settings.cols;
  const buttons = state.profile.buttons.filter(b => b.cat === catId);
  const bySlot = new Map(buttons.map(b => [b.slot, b]));
  const maxSlot = buttons.reduce((m, b) => Math.max(m, b.slot), -1);
  let count = Math.max(cols, Math.ceil((maxSlot + 1) / cols) * cols);
  if (state.caregiver) count += cols;        // an extra empty row to add into

  const cells = [];
  for (let slot = 0; slot < count; slot++) {
    const b = bySlot.get(slot);
    cells.push(b ? buttonEl(b, cat) : emptyEl(catId, slot));
  }
  grid.replaceChildren(...cells);

  const moveBar = $('move-bar');
  moveBar.hidden = !state.moving;
  if (state.moving) {
    const b = state.profile.buttons.find(x => x.id === state.moving);
    moveBar.replaceChildren(h('span', {}, `Tap an empty space or another button to move "${b ? labelOf(b) : ''}".`),
      h('button', { class: 'btn small', onclick: () => { state.moving = null; renderGrid(); } }, 'Cancel'));
  }
}

function buttonEl(b, cat) {
  const showText = state.profile.settings.showText && !b.hideText;
  const el = h('button', {
    class: `sym ${state.moving === b.id ? 'moving' : ''} ${b.alts && b.alts.length ? 'has-alts' : ''}`,
    style: { '--cat': (cat && cat.color) || '#ccc' },
    'aria-label': labelOf(b),
  }, iconEl(b), showText ? h('span', { class: 'label' }, labelOf(b)) : null);
  onPress(el, () => tapButton(b), () => longPressButton(b));
  return el;
}

function emptyEl(catId, slot) {
  if (!state.caregiver) return h('div', { class: 'sym empty', 'aria-hidden': 'true' });
  return h('button', {
    class: 'sym empty add',
    'aria-label': 'Add a button here',
    onclick: () => state.moving ? moveButtonTo(catId, slot) : openEditor(null, { cat: catId, slot }),
  }, h('span', { class: 'icon' }, '＋'));
}

// ------------------------------------------------------------ interaction ---

const lastTap = new Map();

function tapButton(b) {
  if (state.caregiver) {
    if (state.moving) moveButtonTo(b.cat, b.slot);
    else openEditor(b);
    return;
  }
  // Ignore accidental double taps on the same button.
  const now = Date.now();
  if (now - (lastTap.get(b.id) || 0) < state.profile.settings.tapGuardMs) return;
  lastTap.set(b.id, now);
  addToSentence(itemFrom(b, b));
}

/** Long-press: show the other ways to say this button. */
function longPressButton(b) {
  if (state.caregiver) return;
  if (!b.alts || !b.alts.length) { addToSentence(itemFrom(b, b)); return; }
  const variants = [b, ...b.alts];
  const close = openModal({
    title: labelOf(b),
    body: h('div', { class: 'pick-list' }, variants.map(v =>
      h('button', { class: 'btn big', onclick: () => { close(); addToSentence(itemFrom(b, v)); } },
        `${b.emoji || ''} ${labelOf(v)}`))),
  });
}

/** A sentence item is a self-contained copy, so deleting a button later
 *  never breaks a saved phrase or the draft. */
function itemFrom(b, v) {
  return { bid: b.id, en: v.en, hi: v.hi, emoji: b.emoji, img: b.img, audio: v.audio || null };
}

function addToSentence(item) {
  state.sentence.push(item);
  saveDraft(state.sentence);          // synchronous: survives a force-close
  renderSentence();
  // Single words: the sentence bar already shows the word, so a failure
  // only shows a warning (no full-screen card that would block tapping).
  if (state.profile.settings.speakOnTap) say([item], { card: false });
}

/** Speak items and report any problem visibly. */
async function say(items, { card = true } = {}) {
  stopAll();
  const { lang, rate } = state.profile.settings;
  const bar = $('sentence');
  bar.classList.add('speaking');
  try {
    const { problems, unvoiced } = await speakItems(items, lang, rate);
    let msg = describeProblems(problems, lang);
    if (unvoiced.length && !card) msg += ' No sound right now: the words are shown in the sentence bar.';
    if (msg) showStatus(msg.trim(), 'warn', [{ label: 'Test voice', onClick: openVoiceTest }]);
    if (unvoiced.length && card) showCard(items);
  } catch (e) {
    showStatus('Speech failed. Showing the words on screen instead.', 'error');
    if (card) showCard(items);
  } finally {
    bar.classList.remove('speaking');
  }
}

/** Last resort when no sound is possible: big text to show the listener. */
function showCard(items) {
  const card = $('show-card');
  card.replaceChildren(
    h('div', { class: 'show-note' }, '🔇 No sound available — show this screen'),
    h('div', { class: 'show-words' }, items.map(it => h('span', { class: 'chip big' }, iconEl(it), labelOf(it)))),
    h('div', { class: 'show-note' }, 'Tap anywhere to close'));
  card.hidden = false;
}

function rememberRecent(items) {
  const recent = state.profile.recent;
  for (const it of items) {
    const i = recent.findIndex(r => r.bid === it.bid && r.en === it.en);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift({ ...it });
  }
  recent.length = Math.min(recent.length, 10);
  commit({ redraw: false });
  renderRecent();
}

function speakSentence() {
  if (!state.sentence.length) return;
  const items = [...state.sentence];
  say(items);
  rememberRecent(items);
}

function speakPhrase(ph) {
  if (state.caregiver) return;
  say(ph.items);
  rememberRecent(ph.items);
}

function wireStaticButtons() {
  $('btn-speak').onclick = speakSentence;
  $('sentence').onclick = speakSentence;
  $('btn-delete').onclick = () => { state.sentence.pop(); saveDraft(state.sentence); renderSentence(); };
  $('btn-clear').onclick = () => { stopAll(); state.sentence = []; saveDraft([]); renderSentence(); };
  $('btn-save').onclick = () => {
    if (!state.sentence.length) return;
    state.profile.phrases.push({ id: 'p-' + Date.now().toString(36), items: state.sentence.map(it => ({ ...it })) });
    commit();
    showStatus('Saved to My phrases.', 'info');
  };
  $('lang-toggle').onclick = () => {
    state.profile.settings.lang = state.profile.settings.lang === 'en' ? 'hi' : 'en';
    commit();
  };
  $('cg-toggle').onclick = toggleCaregiver;
  $('cg-add').onclick = () => openEditor(null, { cat: currentCat() });
  $('cg-settings').onclick = () => openSettings();
  $('show-card').onclick = () => { $('show-card').hidden = true; };
}

boot();
