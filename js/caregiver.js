// caregiver.js — everything behind the PIN: adding/editing buttons, settings,
// routines, categories, backup/import and restoring earlier versions.

import { state, commit, render, labelOf, catById, nextEmptySlot, showStatus } from './state.js';
import { putMedia, getMediaURL, saveProfile, takeSnapshot, getSnapshots, lastWorkingVersion,
         requestPersistence, storageEstimate } from './store.js';
import { resizeImage, startRecording } from './media.js';
import { playRecording, testVoices, stopAll } from './speech.js';
import { buildBackup, shareOrDownload, readBackup, storeImportedMedia } from './backup.js';
import { createDefaultProfile, normaliseProfile, wordTypes } from './vocab.js';
import { h, openModal, closeAllModals, confirmDialog, pinPad, fmtDate, daysSince } from './ui.js';
import { t, languages, langInfo, pick } from './i18n.js';

const newId = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const curLang = () => state.profile.settings.lang;

// ------------------------------------------------------------ PIN / mode ---

export async function toggleCaregiver() {
  if (state.caregiver) {
    state.caregiver = false;
    state.moving = null;
    render();
    return;
  }
  const s = state.profile.settings;
  if (!s.pin) {
    const p1 = await pinPad(t('pin.create'));
    if (!p1) return;
    const p2 = await pinPad(t('pin.again'));
    if (p1 !== p2) { showStatus(t('pin.mismatch'), 'warn'); return; }
    s.pin = p1;
    commit({ redraw: false });
  } else {
    const p = await pinPad(t('pin.enter'));
    if (!p) return;
    if (p !== s.pin) { showStatus(t('pin.wrong'), 'warn'); return; }
  }
  state.caregiver = true;
  render();
  backupReminder();
}

/** Remind the caregiver every 2 weeks to make a backup. */
function backupReminder() {
  const s = state.profile.settings;
  const since = daysSince(s.lastBackup || state.profile.createdAt);
  if (since >= 14) {
    showStatus(s.lastBackup ? t('backup.reminder', { n: since }) : t('backup.never'), 'warn',
      [{ label: t('btn.backupNow'), onClick: () => exportBackup() }]);
  }
}

// -------------------------------------------------------- recorder widget ---

/** Record / play / delete controls for one recording.
 *  result() saves a new recording and returns the media id (or null). */
function recorderWidget(mediaId) {
  let current = mediaId, fresh = null, removed = false, rec = null;
  const msg = h('span', { class: 'hint' });
  const recBtn = h('button', { class: 'btn', type: 'button' });
  const playBtn = h('button', { class: 'btn', type: 'button' }, '▶ ' + t('rec.play'));
  const delBtn = h('button', { class: 'btn', type: 'button', 'aria-label': t('rec.delete') }, '🗑');
  const has = () => !!fresh || (!!current && !removed);
  const update = () => {
    recBtn.textContent = rec ? '⏹ ' + t('rec.stop') : has() ? '🎙 ' + t('rec.again') : '🎙 ' + t('rec.record');
    recBtn.classList.toggle('recording', !!rec);
    playBtn.hidden = delBtn.hidden = !has() || !!rec;
  };
  recBtn.onclick = async () => {
    if (rec) { rec.stop().catch(() => {}); return; }
    stopAll();
    try {
      rec = await startRecording(10000);
      msg.textContent = t('rec.recording');
      rec.finished.then(blob => { fresh = blob; removed = false; msg.textContent = t('rec.done'); })
        .catch(e => { msg.textContent = '⚠️ ' + e.message; })
        .finally(() => { rec = null; update(); });
    } catch (e) {
      rec = null;
      msg.textContent = '⚠️ ' + (e.name === 'NotAllowedError' ? t('rec.denied') : e.message);
    }
    update();
  };
  playBtn.onclick = async () => {
    if (fresh) {
      const url = URL.createObjectURL(fresh);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      a.play().catch(() => { msg.textContent = '⚠️ ' + t('rec.cantPlay'); });
    } else if (current) {
      const r = await playRecording(current);
      if (!r.ok) msg.textContent = '⚠️ ' + t('rec.cantPlay');
    }
  };
  delBtn.onclick = () => { fresh = null; removed = true; msg.textContent = t('rec.removed'); update(); };
  update();
  return {
    el: h('div', { class: 'row wrap' }, recBtn, playBtn, delBtn, msg),
    stop() { if (rec) rec.stop().catch(() => {}); },
    async result() {
      if (fresh) return putMedia(fresh, 'a');
      return removed ? null : current;
    },
  };
}

/** One text box per language for a {en, hi, ta, kn} object. The board
 *  language comes first; the rest are folded away to keep the form short. */
function multiLangInputs(textObj = {}, placeholders = {}) {
  const inputs = {};
  const row = l => {
    inputs[l.code] = h('input', { type: 'text', value: textObj[l.code] || '', lang: l.code,
      placeholder: placeholders[l.code] || '', autocomplete: 'off', 'aria-label': l.name });
    return h('label', {}, `${t('editor.word')} — ${l.name}`, inputs[l.code]);
  };
  const first = langInfo(curLang());
  const others = languages().filter(l => l.code !== first.code);
  const el = h('div', {}, row(first),
    h('details', {}, h('summary', {}, t('editor.otherLangs')), ...others.map(row)));
  return {
    el,
    focus: () => inputs[first.code].focus(),
    value() {
      const out = {};
      for (const [code, inp] of Object.entries(inputs)) if (inp.value.trim()) out[code] = inp.value.trim();
      return out;
    },
  };
}

// ----------------------------------------------------------- button editor ---

/**
 * Add (existing = null) or edit a button. Designed to be done in < 20 s:
 * photo, word, record, category, Save. A timer shows how long it took.
 */
export function openEditor(existing, opts = {}) {
  const isNew = !existing;
  const locked = state.profile.settings.lockLayout;
  const startCat = existing ? existing.cat : (!catById(opts.cat) ? state.profile.categories[0].id : opts.cat);
  const b = existing ? structuredClone(existing)
    : { id: newId('b'), cat: startCat, slot: null, pos: null, text: {}, emoji: '', sym: null, img: null, audio: null, hideText: false, alts: [] };
  const started = Date.now();

  // --- photo
  let newPhoto = null, photoRemoved = false;
  const preview = h('div', { class: 'photo-preview' }, b.emoji || '🖼️');
  if (b.img) getMediaURL(b.img).then(u => { if (u) preview.replaceChildren(h('img', { src: u, alt: '' })); }).catch(() => {});
  else if (b.sym) preview.replaceChildren(h('img', { src: b.sym, alt: '' }));
  const photoMsg = h('span', { class: 'hint' });
  const handlePhoto = async file => {
    if (!file) return;
    photoMsg.textContent = t('photo.preparing');
    try {
      newPhoto = await resizeImage(file);
      photoRemoved = false;
      preview.replaceChildren(h('img', { src: URL.createObjectURL(newPhoto), alt: '' }));
      photoMsg.textContent = t('photo.ready');
    } catch (e) {
      photoMsg.textContent = '⚠️ ' + e.message + ' ' + t('photo.saveAnyway');
    }
  };
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
    onchange: e => handlePhoto(e.target.files[0]) });
  const galInput = h('input', { type: 'file', accept: 'image/*', hidden: true,
    onchange: e => handlePhoto(e.target.files[0]) });

  // --- text fields
  const words = multiLangInputs(b.text, { en: 'e.g. water', hi: 'जैसे पानी', ta: 'எ.கா. தண்ணி', kn: 'ಉದಾ. ನೀರು' });
  const emojiIn = h('input', { type: 'text', value: b.emoji, placeholder: '💧', class: 'emoji-in', autocomplete: 'off' });
  const catSel = h('select', {}, state.profile.categories.map(c =>
    h('option', { value: c.id, selected: c.id === b.cat }, `${c.emoji} ${labelOf(c)}`)));
  const posSel = h('select', {},
    h('option', { value: '', selected: !b.pos }, t('editor.noType')),
    Object.entries(wordTypes()).map(([k, w]) => h('option', { value: k, selected: b.pos === k }, pick(w.text))));
  const hideText = h('input', { type: 'checkbox', checked: !!b.hideText });
  const mainRec = recorderWidget(b.audio);

  // --- alternatives ("several spoken variants of one intent")
  const altRows = [];
  const altBox = h('div', { class: 'alts' });
  const addAlt = (a = { text: {}, audio: null }) => {
    const row = { words: multiLangInputs(a.text, { en: 'I want water', hi: 'मुझे पानी चाहिए' }), rec: recorderWidget(a.audio) };
    row.el = h('div', { class: 'alt-row' }, row.words.el, row.rec.el,
      h('button', { class: 'btn small danger', type: 'button', onclick: () => {
        altRows.splice(altRows.indexOf(row), 1); row.el.remove(); } }, '✕ ' + t('btn.remove')));
    altRows.push(row);
    altBox.append(row.el);
  };
  (b.alts || []).forEach(addAlt);

  const err = h('p', { class: 'error-text', role: 'alert' });
  const timer = h('span', { class: 'timer' }, '⏱ 0 s');
  const tick = setInterval(() => { timer.textContent = `⏱ ${Math.round((Date.now() - started) / 1000)} s`; }, 1000);

  const body = h('div', { class: 'editor' },
    isNew ? timer : null,
    h('div', { class: 'row' }, preview,
      h('div', { class: 'col' },
        h('button', { class: 'btn', type: 'button', onclick: () => camInput.click() }, '📷 ' + t('photo.camera')),
        h('button', { class: 'btn', type: 'button', onclick: () => galInput.click() }, '🖼️ ' + t('photo.gallery')),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          newPhoto = null; photoRemoved = true; preview.replaceChildren(emojiIn.value || '🖼️'); } }, t('photo.none')))),
    photoMsg, camInput, galInput,
    words.el,
    h('div', { class: 'field' }, h('span', {}, t('editor.record')), mainRec.el),
    h('label', {}, t('editor.category'), catSel),
    h('details', {},
      h('summary', {}, t('editor.more')),
      h('label', {}, t('editor.wordType'), posSel),
      h('label', {}, t('editor.emoji'), emojiIn),
      h('label', { class: 'check' }, hideText, ' ' + t('editor.hideText')),
      h('div', { class: 'field' },
        h('span', {}, t('editor.alts')),
        altBox,
        h('button', { class: 'btn', type: 'button', onclick: () => addAlt() }, '＋ ' + t('editor.addAlt')))),
    err);

  const cleanup = () => { clearInterval(tick); mainRec.stop(); altRows.forEach(r => r.rec.stop()); };

  const save = async () => {
    const text = words.value();
    if (!Object.keys(text).length) { err.textContent = t('editor.needWord'); words.focus(); return false; }
    try {
      let img = b.img;
      if (newPhoto) img = await putMedia(newPhoto, 'i');
      else if (photoRemoved) img = null;
      const audio = await mainRec.result();
      const alts = [];
      for (const r of altRows) {
        const at = r.words.value();
        if (Object.keys(at).length) alts.push({ text: at, audio: await r.rec.result() });
      }
      const cat = catSel.value;
      // Placement: new buttons fill the chosen empty slot, or the next free one.
      // Existing buttons keep their slot unless moved to another category.
      let slot = b.slot;
      const taken = s => state.profile.buttons.some(x => x.cat === cat && x.slot === s && x.id !== b.id);
      if (isNew) slot = (opts.slot != null && cat === startCat && !taken(opts.slot)) ? opts.slot : nextEmptySlot(cat);
      else if (cat !== existing.cat) slot = nextEmptySlot(cat);

      const updated = { ...b, cat, slot, text, pos: posSel.value || null,
        emoji: emojiIn.value.trim() || (img || b.sym ? b.emoji || '' : '⬜'),
        sym: photoRemoved ? null : b.sym, img, audio, hideText: hideText.checked, alts,
        edited: true };    // never overwritten by starter-vocabulary updates
      if (isNew) state.profile.buttons.push(updated);
      else state.profile.buttons[state.profile.buttons.findIndex(x => x.id === b.id)] = updated;
      cleanup();
      commit();
      if (isNew) showStatus(t('editor.added', { word: labelOf(updated), n: Math.round((Date.now() - started) / 1000) }), 'info');
      return true;
    } catch (e) {
      err.textContent = t('editor.saveFailed', { msg: e.message });
      return false;
    }
  };

  const actions = [{ label: t('btn.cancel'), onClick: cleanup }];
  if (!isNew) {
    actions.push({ label: '↔ ' + t('btn.move'), disabled: locked, onClick: () => { cleanup(); state.moving = b.id; render(); } });
    actions.push({ label: '🗑 ' + t('btn.delete'), kind: 'danger', disabled: locked, onClick: async () => {
      if (!(await confirmDialog(t('editor.confirmDelete', { word: labelOf(b) }), t('btn.delete'), t('btn.keep'), true))) return false;
      await takeSnapshot(state.profile, 'before-delete');
      state.profile.buttons = state.profile.buttons.filter(x => x.id !== b.id);
      cleanup(); commit();
    } });
  }
  actions.push({ label: '✔ ' + t('btn.save'), kind: 'primary', onClick: save });

  openModal({ title: isNew ? t('editor.addTitle') : t('editor.editTitle', { word: labelOf(b) }), body: !isNew && locked
    ? h('div', {}, h('p', { class: 'hint' }, '🔒 ' + t('editor.lockedHint')), body)
    : body, actions, onClose: cleanup });
}

/** Move the button being moved into a slot (swapping if it is taken). */
export function moveButtonTo(catId, slot) {
  const b = state.profile.buttons.find(x => x.id === state.moving);
  state.moving = null;
  if (!b) { render(); return; }
  const other = state.profile.buttons.find(x => x.cat === catId && x.slot === slot && x.id !== b.id);
  if (other) { other.cat = b.cat; other.slot = b.slot; }
  b.cat = catId; b.slot = slot;
  commit();
}

// ------------------------------------------------------- backup / restore ---

export async function exportBackup(preferShare = true) {
  showStatus(t('backup.preparing'), 'info');
  try {
    const { file, missing } = await buildBackup(state.profile);
    const how = await shareOrDownload(file, preferShare);
    if (how === 'cancelled') { showStatus(t('backup.cancelled'), 'info'); return; }
    state.profile.settings.lastBackup = new Date().toISOString();
    commit();
    showStatus(t(how === 'shared' ? 'backup.shared' : 'backup.downloaded',
      { file: file.name, mb: (file.size / 1048576).toFixed(1) }) +
      (missing ? ' ' + t('backup.missing', { n: missing }) : ''), 'info');
  } catch (e) {
    showStatus(t('backup.failed', { msg: e.message }), 'error');
  }
}

async function importBackup(file) {
  if (!file) return;
  let data;
  try { data = await readBackup(file); }
  catch (e) { showStatus(e.message, 'error'); return; }
  const s = data.summary;
  const ok = await confirmDialog(t('import.confirm', { date: fmtDate(s.exportedAt), buttons: s.buttons,
    photos: s.photos, recordings: s.recordings, phrases: s.phrases, routines: s.routines }), t('btn.import'), t('btn.cancel'));
  if (!ok) return;
  try {
    await takeSnapshot(state.profile, 'before-import');
    const failed = await storeImportedMedia(data.media);
    state.profile = data.profile;
    state.moving = null;
    closeAllModals();
    await saveProfile(state.profile);
    render();
    openModal({
      title: t('import.done'),
      body: h('ul', {},
        h('li', {}, t('import.sumButtons', { n: s.buttons, c: s.categories })),
        h('li', {}, t('import.sumMedia', { p: s.photos, r: s.recordings })),
        h('li', {}, t('import.sumPhrases', { p: s.phrases, r: s.routines })),
        h('li', {}, t('import.sumSettings')),
        (s.missingMedia + failed) ? h('li', {}, '⚠️ ' + t('import.sumMissing', { n: s.missingMedia + failed })) : null),
      actions: [{ label: t('btn.ok'), kind: 'primary' }],
    });
  } catch (e) {
    showStatus(t('import.failed', { msg: e.message }), 'error');
  }
}

/** One tap: go back to the newest automatic snapshot that differs from now.
 *  The current version is snapshotted first, so the restore can be undone. */
export async function restoreLastWorking() {
  try {
    if (!state.profile) return;
    const snap = await lastWorkingVersion(state.profile);
    if (!snap) { showStatus(t('restore.none'), 'info'); return; }
    await restoreSnapshot(snap);
  } catch (e) {
    showStatus(t('restore.failed', { msg: e.message }), 'error');
  }
}

async function restoreSnapshot(snap) {
  await takeSnapshot(state.profile, 'before-restore');
  state.profile = normaliseProfile(snap.profile);
  state.moving = null;
  closeAllModals();
  await saveProfile(state.profile);
  render();
  showStatus(t('restore.done', { date: fmtDate(snap.at) }), 'info', [{ label: t('btn.undo'), onClick: restoreLastWorking }]);
}

// ----------------------------------------------------------------- settings ---

function selectRow(label, value, options, onChange) {
  return h('label', {}, label, h('select', { onchange: e => onChange(e.target.value) },
    options.map(([v, txt]) => h('option', { value: v, selected: String(v) === String(value) }, txt))));
}
function checkRow(label, checked, onChange) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }), ' ', label);
}
/** Change a setting, save and redraw the board behind the dialog. */
const setSetting = (key, value) => { state.profile.settings[key] = value; commit(); };
const sizes = () => [['s', t('size.s')], ['m', t('size.m')], ['l', t('size.l')], ['xl', t('size.xl')]];

export function openSettings(focus) {
  const s = state.profile.settings;
  const sections = h('div', { class: 'settings' },
    voiceSection(s),
    layoutSection(s),
    routinesSection(),
    categoriesSection(),
    backupSection(s),
    safetySection(),
    pinSection(),
    aboutSection());
  openModal({ title: '⚙️ ' + t('settings.title'), body: sections, full: true });
  if (focus) sections.querySelector(`#set-${focus}`)?.scrollIntoView();
}

/** Voice test on its own (safe to open without the PIN). */
export function openVoiceTest() {
  openModal({ title: '🔊 ' + t('voice.checkTitle'), body: voiceSection(state.profile.settings, true), full: true });
}

function voiceSection(s, testOnly = false) {
  const out = h('div', { class: 'report' });
  const run = async () => {
    out.replaceChildren(h('p', {}, t('voice.testing')));
    const r = await testVoices(state.profile.settings.rate);
    const rows = r.langs.map(l => h('li', { lang: l.code },
      l.status === 'ok' ? `✅ ${l.name}: ${t('voice.found')} — ${l.voice || t('voice.default')}`
        : l.status === 'missing' ? `❌ ${l.name}: ${t('voice.notFound')}`
          : `❌ ${l.name}: ${t('voice.failedReason', { reason: l.reason })}`));
    out.replaceChildren(
      h('p', {}, r.available ? t('voice.synthOk', { n: r.count }) : t('voice.synthMissing')),
      h('ul', {}, rows));
    if (r.langs.some(l => l.status !== 'ok')) {
      out.append(
        h('h4', {}, t('voice.howTitle')),
        h('ol', {}, ['voice.android1', 'voice.android2', 'voice.android3', 'voice.android4', 'voice.android5', 'voice.android6']
          .map(k => h('li', {}, t(k)))),
        h('p', { class: 'hint' }, t('voice.iosHint')),
        h('p', { class: 'hint' }, t('voice.recordHint')));
    }
  };
  return h('section', { id: 'set-voice' }, h('h3', {}, '🔊 ' + t('settings.voice')),
    testOnly ? null : selectRow(t('settings.language'), s.lang, languages().map(l => [l.code, l.name]), v => setSetting('lang', v)),
    testOnly ? null : selectRow(t('settings.speed'), s.rate, [[0.6, t('speed.slow')], [0.9, t('speed.normal')], [1.2, t('speed.fast')]], v => setSetting('rate', Number(v))),
    testOnly ? null : checkRow(t('settings.speakOnTap'), s.speakOnTap, v => setSetting('speakOnTap', v)),
    h('button', { class: 'btn primary', onclick: run }, '▶ ' + t('btn.testVoice')),
    out);
}

function layoutSection(s) {
  return h('section', {}, h('h3', {}, '🧩 ' + t('settings.layout')),
    checkRow('🔒 ' + t('settings.lock'), s.lockLayout, v => setSetting('lockLayout', v)),
    selectRow(t('settings.cols'), s.cols, [3, 4, 5, 6, 7, 8].map(n => [n, String(n)]), v => setSetting('cols', Number(v))),
    selectRow(t('settings.buttonSize'), s.buttonSize, sizes(), v => setSetting('buttonSize', v)),
    selectRow(t('settings.textSize'), s.textSize, sizes(), v => setSetting('textSize', v)),
    checkRow(t('settings.showText'), s.showText, v => setSetting('showText', v)),
    selectRow(t('settings.secondLang'), s.secondLang || '',
      [['', t('settings.secondNone')], ...languages().map(l => [l.code, l.name])], v => setSetting('secondLang', v || null)),
    selectRow(t('settings.colours'), s.colorMode,
      [['wordtype', t('colours.wordtype')], ['category', t('colours.category')], ['none', t('colours.none')]], v => setSetting('colorMode', v)),
    h('div', { class: 'legend' }, Object.values(wordTypes()).map(w =>
      h('span', { class: 'legend-item', style: { '--cat': w.color } }, pick(w.text)))),
    selectRow(t('settings.theme'), s.theme, [['light', t('theme.light')], ['dark', t('theme.dark')],
      ['contrast', t('theme.contrast')], ['calm', t('theme.calm')]], v => setSetting('theme', v)),
    checkRow(t('settings.showPhrases'), s.showPhrases, v => setSetting('showPhrases', v)),
    checkRow(t('settings.showRecent'), s.showRecent, v => setSetting('showRecent', v)),
    selectRow(t('settings.tapGuard'), s.tapGuardMs,
      [[0, t('tap.off')], [300, '0.3 s'], [600, '0.6 s'], [1000, '1 s']], v => setSetting('tapGuardMs', Number(v))));
}

function routinesSection() {
  const box = h('div');
  const r = state.profile.routines;
  const catOptions = sel => state.profile.categories.map(c => h('option', { value: c.id, selected: c.id === sel }, `${c.emoji} ${labelOf(c)}`));
  const DAYS = t('days.short').split(',');
  // Rule names may be plain text or {en, hi, …}; edit the board language.
  const setName = (rule, v) => {
    if (typeof rule.name === 'object' && rule.name) rule.name = { ...rule.name, [curLang()]: v };
    else rule.name = v;
  };
  const draw = () => {
    box.replaceChildren(
      checkRow(t('routines.enable'), r.enabled, v => { r.enabled = v; if (!v && state.tab === 'now') state.tab = 'core'; commit(); }),
      h('p', { class: 'hint' }, t('routines.hint')),
      ...r.rules.map((rule, i) => h('div', { class: 'rule' },
        h('input', { type: 'text', value: pick(rule.name), 'aria-label': t('routines.name'), onchange: e => { setName(rule, e.target.value); commit(); } }),
        h('div', { class: 'row wrap' },
          h('input', { type: 'time', value: rule.from, 'aria-label': t('routines.from'), onchange: e => { rule.from = e.target.value; commit(); } }),
          '→',
          h('input', { type: 'time', value: rule.to, 'aria-label': t('routines.to'), onchange: e => { rule.to = e.target.value; commit(); } }),
          h('select', { 'aria-label': t('routines.board'), onchange: e => { rule.cat = e.target.value; commit(); } }, catOptions(rule.cat))),
        h('div', { class: 'row wrap days' }, DAYS.map((d, di) => h('label', { class: 'day' },
          h('input', { type: 'checkbox', checked: rule.days.includes(di), onchange: e => {
            rule.days = e.target.checked ? [...rule.days, di] : rule.days.filter(x => x !== di); commit(); } }), d))),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', disabled: i === 0, onclick: () => { [r.rules[i - 1], r.rules[i]] = [r.rules[i], r.rules[i - 1]]; commit(); draw(); } }, '▲'),
          h('button', { class: 'btn small', disabled: i === r.rules.length - 1, onclick: () => { [r.rules[i + 1], r.rules[i]] = [r.rules[i], r.rules[i + 1]]; commit(); draw(); } }, '▼'),
          h('button', { class: 'btn small danger', onclick: () => { r.rules.splice(i, 1); commit(); draw(); } }, '🗑 ' + t('btn.remove'))))),
      h('button', { class: 'btn', onclick: () => {
        r.rules.push({ id: newId('r'), name: t('routines.new'), from: '16:00', to: '17:00', days: [0, 1, 2, 3, 4, 5, 6], cat: 'core' });
        commit(); draw(); } }, '＋ ' + t('routines.add')),
      h('label', {}, t('routines.fallback'), h('select', { onchange: e => { r.fallback = e.target.value; commit(); } }, catOptions(r.fallback))));
  };
  draw();
  return h('section', {}, h('h3', {}, '⏰ ' + t('settings.routines')), box);
}

function categoriesSection() {
  const box = h('div');
  const draw = () => {
    const cats = state.profile.categories;
    const locked = state.profile.settings.lockLayout;
    box.replaceChildren(
      locked ? h('p', { class: 'hint' }, '🔒 ' + t('cats.lockedHint')) : null,
      ...cats.map((c, i) => {
        const count = state.profile.buttons.filter(b => b.cat === c.id).length;
        const nameInputs = languages().map(l => h('input', { type: 'text', value: (c.text || {})[l.code] || '', lang: l.code,
          'aria-label': l.name, placeholder: l.name,
          onchange: e => { c.text = { ...(c.text || {}), [l.code]: e.target.value }; c.edited = true; commit(); } }));
        return h('div', { class: 'cat-row', style: { '--cat': c.color } },
          h('input', { type: 'text', class: 'emoji-in', value: c.emoji, 'aria-label': 'Emoji', onchange: e => { c.emoji = e.target.value; commit(); } }),
          ...nameInputs,
          h('input', { type: 'color', value: c.color, 'aria-label': t('cats.colour'), onchange: e => { c.color = e.target.value; commit(); } }),
          h('span', { class: 'hint' }, t('cats.count', { n: count })),
          h('button', { class: 'btn small', disabled: locked || i === 0, onclick: () => { [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; commit(); draw(); } }, '▲'),
          h('button', { class: 'btn small', disabled: locked || i === cats.length - 1, onclick: () => { [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]]; commit(); draw(); } }, '▼'),
          h('button', { class: 'btn small danger', disabled: locked || cats.length < 2 || c.kind === 'core', onclick: async () => {
            if (count && !(await confirmDialog(t('cats.confirmDelete', { name: labelOf(c), n: count }), t('btn.delete'), t('btn.keep'), true))) return;
            await takeSnapshot(state.profile, 'before-delete');
            state.profile.categories.splice(i, 1);
            state.profile.buttons = state.profile.buttons.filter(b => b.cat !== c.id);
            commit(); draw();
          } }, '🗑'));
      }),
      h('button', { class: 'btn', onclick: () => {
        state.profile.categories.push({ id: newId('c'), text: { [curLang()]: t('cats.newName') }, emoji: '⭐', color: '#cdb4db', kind: 'personal', edited: true });
        commit(); draw();
      } }, '＋ ' + t('cats.add')));
  };
  draw();
  return h('section', {}, h('h3', {}, '🗂️ ' + t('settings.categories')), box);
}

function backupSection(s) {
  const fileIn = h('input', { type: 'file', accept: '.json,.bol,application/json', hidden: true,
    onchange: e => { importBackup(e.target.files[0]); e.target.value = ''; } });
  return h('section', {}, h('h3', {}, '💾 ' + t('settings.backup')),
    h('p', {}, t('backup.last', { date: fmtDate(s.lastBackup) }) + (s.lastBackup ? ' ' + t('backup.daysAgo', { n: daysSince(s.lastBackup) }) : '')),
    h('p', { class: 'hint' }, t('backup.hint')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => exportBackup(true) }, '📤 ' + t('btn.shareBackup')),
      h('button', { class: 'btn', onclick: () => exportBackup(false) }, '⬇️ ' + t('btn.downloadBackup')),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, '📥 ' + t('btn.importBackup'))),
    fileIn);
}

function safetySection() {
  const info = h('ul', { class: 'report' });
  const snapsBox = h('div');
  (async () => {
    const persist = await requestPersistence();
    const est = await storageEstimate();
    const offline = navigator.serviceWorker && navigator.serviceWorker.controller;
    info.replaceChildren(
      h('li', {}, offline ? '✅ ' + t('safety.offline') : '⚠️ ' + t('safety.notOffline')),
      h('li', {}, persist === 'granted' ? '✅ ' + t('safety.persisted') : '⚠️ ' + t('safety.notPersisted')),
      est ? h('li', {}, t('safety.storage', { mb: est.usedMB })) : null);
    const snaps = await getSnapshots();
    snapsBox.replaceChildren(...snaps.map(sn => h('div', { class: 'row' },
      h('span', {}, `${fmtDate(sn.at)} (${sn.reason}) — ${t('cats.count', { n: (sn.profile.buttons || []).length })}`),
      h('button', { class: 'btn small', onclick: () => restoreSnapshot(sn) }, t('btn.restoreThis')))));
  })().catch(() => {});
  return h('section', { id: 'set-safety' }, h('h3', {}, '🛟 ' + t('settings.safety')),
    info,
    h('button', { class: 'btn primary', onclick: restoreLastWorking }, '↩️ ' + t('btn.restore')),
    h('p', { class: 'hint' }, t('safety.snapshots')),
    snapsBox,
    h('button', { class: 'btn danger', onclick: async () => {
      if (!(await confirmDialog(t('safety.confirmReset'), t('btn.reset'), t('btn.cancel'), true))) return;
      await takeSnapshot(state.profile, 'before-reset');
      const fresh = createDefaultProfile();
      for (const k of ['pin', 'lastBackup', 'lang', 'langChosen', 'cols']) fresh.settings[k] = state.profile.settings[k];
      state.profile = fresh;
      closeAllModals();
      commit();
    } }, t('btn.reset')));
}

function pinSection() {
  return h('section', {}, h('h3', {}, '🔑 ' + t('settings.pin')),
    h('button', { class: 'btn', onclick: async () => {
      const p1 = await pinPad(t('pin.new')); if (!p1) return;
      const p2 = await pinPad(t('pin.again')); if (!p2) return;
      if (p1 !== p2) { showStatus(t('pin.mismatchKept'), 'warn'); return; }
      setSetting('pin', p1);
      showStatus(t('pin.changed'), 'info');
    } }, t('btn.changePin')));
}

/** About & credits: licences that must be shown. */
function aboutSection() {
  return h('section', { id: 'set-about' }, h('h3', {}, 'ℹ️ ' + t('settings.about')),
    h('p', {}, t('about.free')),
    h('p', { class: 'hint' }, t('about.translations')),
    h('p', { class: 'hint' }, 'Fonts: Noto Sans Devanagari, Noto Sans Tamil, Noto Sans Kannada © The Noto Project Authors, SIL Open Font License 1.1.'),
    h('p', { class: 'hint' }, 'Bol · https://github.com/ThomasNeoAnderson/bol'));
}
