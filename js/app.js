// app.js — starts the app and draws the main communication board.
//
// Screen layout (top to bottom):
//   toolbar      : language picker, caregiver controls
//   sentence bar : tapped words + Delete / Clear / Save / Speak
//   My phrases   : saved sentences, one tap to speak
//   Recent       : recently spoken words
//   tabs         : Core (home) · Phrases · Now · Type · topic boards
//   grid         : the symbol buttons, each in a fixed slot
//   status line  : visible messages (voice problems, restores, updates)

import { state, commit, setRenderer, labelOf, catById, showStatus } from './state.js';
import { loadProfile, saveDraft, loadDraft, takeSnapshot, collectGarbage, requestPersistence,
         onSaveStatus, getMediaURL, saveProfile } from './store.js';
import { speakItems, describeProblems, stopAll } from './speech.js';
import { currentRoutine } from './routines.js';
import { h, onPress, openModal } from './ui.js';
import { loadI18n, setLang, t, languages, langInfo, pick } from './i18n.js';
import { loadVocab, createDefaultProfile, normaliseProfile, needsMigration, wordTypes } from './vocab.js';
import { toggleCaregiver, openEditor, openSettings, openVoiceTest, moveButtonTo, exportBackup,
         restoreLastWorking } from './caregiver.js';
import { renderTypePanel, rememberSentence } from './typing.js';

const $ = id => document.getElementById(id);

// --------------------------------------------------------------- startup ---

async function boot() {
  // If this flag is still set from last time, the app crashed while starting.
  const crashedLastTime = localStorage.getItem('bol-booting') === '1';
  localStorage.setItem('bol-booting', '1');

  try {
    await Promise.all([loadI18n(), loadVocab()]);
  } catch (e) {
    // Without the data files nothing can be shown; say so plainly.
    document.body.replaceChildren(h('p', { class: 'fatal' },
      'Bol could not load its word list. Connect to the internet once and reopen the app. / ' +
      'शब्द सूची लोड नहीं हुई। एक बार इंटरनेट से जोड़कर ऐप फिर खोलें।'));
    return;
  }

  let source = 'new', upgraded = false;
  try {
    const loaded = await loadProfile();
    source = loaded.source;
    if (needsMigration(loaded.raw)) {
      // Keep the old version as a snapshot BEFORE changing anything.
      await takeSnapshot(loaded.raw, 'before-upgrade');
      upgraded = true;
    }
    state.profile = loaded.raw ? normaliseProfile(loaded.raw) : createDefaultProfile();
  } catch (e) {
    console.error(e);
    state.profile = createDefaultProfile();
    source = 'error';
  }
  if (source === 'new') {
    // First launch: fewer columns on a phone in portrait so buttons stay big.
    state.profile.settings.cols = window.innerWidth < 600 ? 4 : 6;
  }
  if (source === 'new' || upgraded) saveProfile(state.profile);

  setLang(state.profile.settings.lang);
  state.sentence = loadDraft();
  state.tab = 'core';

  setRenderer(renderAll);
  wireStaticButtons();
  renderAll();

  // We got this far, so this version works: clear the flag and snapshot it.
  localStorage.removeItem('bol-booting');
  takeSnapshot(state.profile, 'startup').then(() => collectGarbage(state.profile)).catch(console.error);

  if (crashedLastTime) {
    showStatus(t('status.crashed'), 'warn', [{ label: t('btn.restore'), onClick: restoreLastWorking }]);
  } else if (source === 'error') {
    showStatus(t('status.loadError'), 'error', [{ label: t('btn.restore'), onClick: restoreLastWorking }]);
  } else if (source === 'snapshot') {
    showStatus(t('status.fromSnapshot'), 'warn');
  } else if (upgraded) {
    showStatus(t('status.upgraded'), 'info');
  } else if (state.sentence.length) {
    showStatus(t('status.draftRestored'), 'info');
  }

  if (!state.profile.settings.langChosen) showLanguagePicker(true);

  requestPersistence();
  registerServiceWorker();
}

onSaveStatus(r => {
  if (!r.ok) showStatus(t('status.saveFailed'), 'error', [{ label: t('btn.exportBackup'), onClick: exportBackup }]);
});

// Any unexpected error: tell the user, keep the app usable, offer a restore.
window.addEventListener('error', e => reportError(e.message));
window.addEventListener('unhandledrejection', e => reportError(e.reason && e.reason.message));
function reportError(msg) {
  console.error('Bol error:', msg);
  if (!state.profile) return;
  showStatus(t('status.error', { msg: msg || '' }), 'error', [{ label: t('btn.restore'), onClick: restoreLastWorking }]);
}

/** Register the service worker and show "Update available" when a new version
 *  has been downloaded. The new version only takes over when the user taps,
 *  so the app never changes under someone's fingers. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Only reload when the user asked for the update. (On a first install the
  // worker also takes control, and that must NOT reload the page.)
  let updateRequested = false;
  const offerUpdate = worker => showStatus(t('status.update'), 'update', [{
    label: t('btn.reload'),
    onClick: () => { updateRequested = true; worker.postMessage({ type: 'SKIP_WAITING' }); },
  }]);
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
    // Check for updates whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(err => console.warn('SW registration failed', err));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !updateRequested) return;
    reloading = true;
    saveDraft(state.sentence);
    location.reload();
  });
}

// Re-check the routine when the app comes back to the foreground. We do NOT
// switch boards on a timer while someone is using the screen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.profile && state.tab === 'now') renderAll();
  if (document.visibilityState === 'hidden' && state.profile) saveDraft(state.sentence);
});

// Some browsers only grant persistent storage after a user gesture.
document.addEventListener('pointerdown', () => requestPersistence(), { once: true });

// ------------------------------------------------------------- rendering ---

function renderAll() {
  setLang(state.profile.settings.lang);
  applySettings();
  renderStaticText();
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
  root.dataset.colors = s.colorMode === 'none' ? 'off' : 'on';
  root.dataset.caregiver = state.caregiver ? 'on' : 'off';
  root.lang = s.lang;
  root.style.setProperty('--cols', s.cols);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',
    s.theme === 'dark' || s.theme === 'contrast' ? '#000000' : '#2a6f97');
}

/** Text that lives in index.html (button captions, aria labels). */
function renderStaticText() {
  const set = (id, key, attr) => { const el = $(id); if (el) attr ? el.setAttribute(attr, t(key)) : (el.textContent = t(key)); };
  set('btn-speak', 'btn.speak');
  set('cg-add', 'btn.addButton');
  set('cg-settings', 'btn.settings');
  $('btn-delete').querySelector('.btn-text').textContent = ' ' + t('btn.delete');
  $('btn-clear').querySelector('.btn-text').textContent = ' ' + t('btn.clear');
  $('btn-save').querySelector('.btn-text').textContent = ' ' + t('btn.save');
  set('btn-delete', 'btn.delete', 'aria-label');
  set('btn-clear', 'btn.clear', 'aria-label');
  set('btn-save', 'aria.savePhrase', 'aria-label');
  set('sentence', 'aria.sentence', 'aria-label');
  set('lang-toggle', 'aria.language', 'aria-label');
}

function renderToolbar() {
  const s = state.profile.settings;
  $('lang-toggle').textContent = '🌐 ' + langInfo(s.lang).name;
  $('cg-toggle').textContent = state.caregiver ? '✔ ' + t('btn.done') : '🔒 ' + t('btn.caregiver');
  $('cg-tools').hidden = !state.caregiver;
  $('btn-save').hidden = !s.showPhrases;
}

/** The picture for a button or item, in order of preference:
 *  caregiver photo > ARASAAC symbol (bundled file) > emoji.
 *  Pictures load asynchronously; if one fails, the emoji simply stays, so the
 *  UI never waits on, or breaks because of, an image. */
function iconEl(item) {
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' }, item.emoji || '⬜');
  const show = url => {
    const img = h('img', { alt: '', src: url, draggable: 'false' });
    img.onload = () => span.replaceChildren(img);
    img.onerror = () => {};             // keep the emoji
  };
  if (item.img) {
    getMediaURL(item.img).then(url => { if (url) show(url); }).catch(() => {});
  } else if (item.sym && state.profile.settings.useSymbols) {
    show(item.sym);
  }
  return span;
}

/** Label (+ optional smaller second-language label), with lang attributes so
 *  each script is rendered and read correctly. */
function labelEls(item, cls = 'label') {
  const s = state.profile.settings;
  const text = labelOf(item);
  // Long single words get a slightly smaller font rather than being broken.
  const n = cls === 'label' && !text.includes(' ') ? [...text].length : 0;
  const size = n > 7 ? ' longer' : n > 5 ? ' long' : '';
  const main = h('span', { class: cls + size, lang: s.lang }, text);
  if (!s.secondLang || s.secondLang === s.lang) return [main];
  const second = labelOf(item, s.secondLang);
  if (!second || second === labelOf(item)) return [main];
  return [main, h('span', { class: 'label2', lang: s.secondLang }, second)];
}

function renderSentence() {
  const bar = $('sentence');
  if (!state.sentence.length) {
    bar.replaceChildren(h('span', { class: 'sentence-hint' }, t('hint.tapPictures')));
  } else {
    bar.replaceChildren(...state.sentence.map(it =>
      h('span', { class: 'chip', role: 'listitem' }, iconEl(it), h('span', { lang: state.profile.settings.lang }, labelOf(it)))));
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
  const title = h('span', { class: 'strip-title' }, t('strip.myPhrases'));
  if (!phrases.length) {
    strip.replaceChildren(title, h('span', { class: 'strip-empty' }, t('hint.savePhrase')));
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
      h('button', { class: 'btn small', 'aria-label': t('aria.moveLeft'), onclick: () => move(-1) }, '◀'),
      chip,
      h('button', { class: 'btn small', 'aria-label': t('aria.moveRight'), onclick: () => move(1) }, '▶'),
      h('button', { class: 'btn small danger', 'aria-label': t('aria.deletePhrase'), onclick: () => {
        state.profile.phrases.splice(i, 1); commit(); } }, '✕'));
  }));
}

function renderRecent() {
  const strip = $('recent');
  strip.hidden = !state.profile.settings.showRecent || !state.profile.recent.length;
  if (strip.hidden) return;
  strip.replaceChildren(
    h('span', { class: 'strip-title' }, t('strip.recent')),
    ...state.profile.recent.map(it =>
      h('button', { class: 'chip', onclick: () => addToSentence({ ...it }) }, iconEl(it), h('span', {}, labelOf(it)))));
}

/** Tab order is fixed: Core first (home), then Phrases, Now, Type, and the
 *  topic boards in the caregiver's order. Core is always one tap away. */
function tabList() {
  const cats = state.profile.categories;
  const list = [
    ...cats.filter(c => c.kind === 'core'),
    ...cats.filter(c => c.kind === 'phrases'),
  ];
  if (state.profile.routines.enabled) list.push({ id: 'now', text: { en: t('tab.now') }, emoji: '⏰', color: '#2a6f97' });
  list.push({ id: 'type', text: { en: t('tab.type') }, emoji: '⌨️', color: '#495057' });
  list.push(...cats.filter(c => c.kind !== 'core' && c.kind !== 'phrases'));
  return list;
}

function renderTabs() {
  const tabs = $('tabs');
  const list = tabList();
  if (!list.some(c => c.id === state.tab)) state.tab = list[0].id;
  tabs.replaceChildren(...list.map(c =>
    h('button', {
      class: `tab ${state.tab === c.id ? 'active' : ''} ${c.kind === 'core' ? 'home' : ''}`,
      style: { '--cat': c.color },
      'aria-pressed': String(state.tab === c.id),
      onclick: () => selectTab(c.id),
    }, h('span', { 'aria-hidden': 'true' }, c.emoji), ' ', h('span', { lang: state.profile.settings.lang }, labelOf(c)))));
}

function selectTab(id) {
  state.tab = id;
  state.moving = null;
  renderTabs(); renderNowBar(); renderGrid();
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
  const what = override ? t('now.chosen') : rule ? pick(rule.name) : t('now.none');
  bar.replaceChildren(
    h('span', {}, `🕗 ${what} → ${c.emoji} ${labelOf(c)}`),
    h('button', { class: 'btn small', onclick: pickOverride }, t('now.change')),
    ...(override ? [h('button', { class: 'btn small', onclick: () => { state.nowOverride = null; renderNowBar(); renderGrid(); } },
      t('now.back'))] : []));
}

/** Manual override for the Now screen; lasts 2 hours. */
function pickOverride() {
  const close = openModal({
    title: t('now.pickTitle'),
    body: h('div', { class: 'pick-list' }, state.profile.categories.map(c =>
      h('button', { class: 'btn big', style: { '--cat': c.color }, onclick: () => {
        state.nowOverride = { cat: c.id, until: Date.now() + 2 * 3600 * 1000 };
        close(); renderNowBar(); renderGrid();
      } }, `${c.emoji} ${labelOf(c)}`))),
  });
}

function currentCat() {
  if (state.tab === 'now') return nowBoard().cat;
  if (state.tab === 'type') return null;
  return state.tab;
}

/** Background colour for a button: by word type (Modified Fitzgerald Key),
 *  by category, or none — chosen in Caregiver settings. */
function colourFor(b, cat) {
  const mode = state.profile.settings.colorMode;
  if (mode === 'wordtype' && b.pos && wordTypes()[b.pos]) return wordTypes()[b.pos].color;
  if (mode === 'wordtype' || mode === 'category') return (cat && cat.color) || '#ccc';
  return 'transparent';
}

/** Draw the grid. Every button sits in its own slot number, and empty slots
 *  are drawn as blanks, so adding or hiding nothing ever shifts a button. */
function renderGrid() {
  const grid = $('grid');
  const moveBar = $('move-bar');
  if (state.tab === 'type') {
    grid.className = 'type-mode';
    moveBar.hidden = true;
    grid.replaceChildren(renderTypePanel({ say }));
    return;
  }
  const catId = currentCat();
  const cat = catById(catId);
  // Whole-sentence phrases get double-width buttons so the text fits.
  const isPhrases = cat && cat.kind === 'phrases';
  grid.className = isPhrases ? 'phrases-mode' : '';
  const cols = isPhrases ? Math.max(1, Math.floor(state.profile.settings.cols / 2)) : state.profile.settings.cols;
  grid.style.setProperty('--grid-cols', cols);
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

  moveBar.hidden = !state.moving;
  if (state.moving) {
    const b = state.profile.buttons.find(x => x.id === state.moving);
    moveBar.replaceChildren(h('span', {}, t('move.hint', { word: b ? labelOf(b) : '' })),
      h('button', { class: 'btn small', onclick: () => { state.moving = null; renderGrid(); } }, t('btn.cancel')));
  }
}

function buttonEl(b, cat) {
  const showText = state.profile.settings.showText && !b.hideText;
  const el = h('button', {
    class: `sym ${state.moving === b.id ? 'moving' : ''} ${b.alts && b.alts.length ? 'has-alts' : ''}`,
    style: { '--cat': colourFor(b, cat) },
    'aria-label': labelOf(b),
  }, iconEl(b), showText ? labelEls(b) : null);
  onPress(el, () => tapButton(b), () => longPressButton(b));
  return el;
}

function emptyEl(catId, slot) {
  if (!state.caregiver) return h('div', { class: 'sym empty', 'aria-hidden': 'true' });
  return h('button', {
    class: 'sym empty add',
    'aria-label': t('aria.addHere'),
    onclick: () => state.moving ? moveButtonTo(catId, slot) : openEditor(null, { cat: catId, slot }),
  }, h('span', { class: 'icon' }, '＋'));
}

// ------------------------------------------------------- language picker ---

/** Language chooser. On first run it is full-screen and cannot be skipped
 *  (one tap). Each language is shown in its own script. */
function showLanguagePicker(firstRun = false) {
  const choose = code => {
    state.profile.settings.lang = code;
    state.profile.settings.langChosen = true;
    setLang(code);
    close();
    commit();
  };
  const body = h('div', { class: 'pick-list lang-list' },
    languages().map(l => h('button', {
      class: `btn big lang-btn ${l.code === state.profile.settings.lang ? 'current' : ''}`,
      lang: l.code, onclick: () => choose(l.code),
    }, l.name, l.name !== l.englishName ? h('span', { class: 'hint', lang: 'en' }, ' · ' + l.englishName) : null)));
  const close = openModal({
    title: firstRun ? '🌐' : t('lang.choose'),
    body: firstRun ? h('div', {}, h('p', { class: 'lang-intro' }, chooseInEveryLanguage()), body) : body,
    full: firstRun,
    closable: !firstRun,      // first run: a language must be chosen
  });
}

/** "Choose language" written in every available language, because on first
 *  run we don't yet know which one the reader understands. */
function chooseInEveryLanguage() {
  const prev = state.profile.settings.lang;
  const lines = languages().map(l => { setLang(l.code); return t('lang.choose'); });
  setLang(prev);
  return [...new Set(lines)].join(' · ');
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
      h('button', { class: 'btn big', lang: state.profile.settings.lang, onclick: () => { close(); addToSentence(itemFrom(b, v)); } },
        `${b.emoji || ''} ${labelOf(v)}`))),
  });
}

/** A sentence item is a self-contained copy, so deleting a button later
 *  never breaks a saved phrase or the draft. */
function itemFrom(b, v) {
  return { bid: b.id, text: { ...(v.text || {}) }, emoji: b.emoji, sym: b.sym || null, img: b.img, audio: v.audio || null };
}

function addToSentence(item) {
  state.sentence.push(item);
  saveDraft(state.sentence);          // synchronous: survives a force-close
  renderSentence();
  // Single words: the sentence bar already shows the word, so a failure
  // only shows a warning (no full-screen card that would block tapping).
  if (state.profile.settings.speakOnTap) say([item], { card: false });
}

/** Speak items and report any problem visibly. Never silent. */
async function say(items, { card = true } = {}) {
  stopAll();
  const { lang, rate } = state.profile.settings;
  const bar = $('sentence');
  bar.classList.add('speaking');
  try {
    const { problems, unvoiced } = await speakItems(items, lang, rate);
    let msg = describeProblems(problems);
    if (unvoiced.length && !card) msg += ' ' + t('voice.shownInBar');
    if (msg) showStatus(msg.trim(), 'warn', [{ label: t('btn.testVoice'), onClick: openVoiceTest }]);
    if (unvoiced.length && card) showCard(items);
  } catch (e) {
    showStatus(t('voice.failed'), 'error');
    if (card) showCard(items);
  } finally {
    bar.classList.remove('speaking');
  }
}

/** Last resort when no sound is possible: big text to show the listener. */
function showCard(items) {
  const card = $('show-card');
  card.replaceChildren(
    h('div', { class: 'show-note' }, '🔇 ' + t('card.noSound')),
    h('div', { class: 'show-words', lang: state.profile.settings.lang },
      items.map(it => h('span', { class: 'chip big' }, iconEl(it), labelOf(it)))),
    h('div', { class: 'show-note' }, t('card.close')));
  card.hidden = false;
}

function rememberRecent(items) {
  const recent = state.profile.recent;
  for (const it of items) {
    if (!it.bid) continue;                // typed text is not a button
    const i = recent.findIndex(r => r.bid === it.bid && labelOf(r, 'en') === labelOf(it, 'en'));
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
  rememberSentence(items.map(it => labelOf(it)).join(' '));   // for typing suggestions
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
    showStatus(t('status.phraseSaved'), 'info');
  };
  $('lang-toggle').onclick = () => showLanguagePicker(false);
  $('cg-toggle').onclick = toggleCaregiver;
  $('cg-add').onclick = () => openEditor(null, { cat: currentCat() || 'core' });
  $('cg-settings').onclick = () => openSettings();
  $('show-card').onclick = () => { $('show-card').hidden = true; };
}

boot();
