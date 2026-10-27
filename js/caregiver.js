// caregiver.js — everything behind the PIN: adding/editing buttons, settings,
// routines, categories, backup/import and restoring earlier versions.

import { state, commit, render, labelOf, catById, nextEmptySlot, showStatus } from './state.js';
import { putMedia, getMediaURL, saveProfile, takeSnapshot, getSnapshots, lastWorkingVersion,
         requestPersistence, storageEstimate } from './store.js';
import { resizeImage, startRecording } from './media.js';
import { playRecording, testVoices, stopAll } from './speech.js';
import { buildBackup, shareOrDownload, readBackup, storeImportedMedia } from './backup.js';
import { createDefaultProfile, normaliseProfile } from './vocab.js';
import { h, openModal, closeAllModals, confirmDialog, pinPad, fmtDate, daysSince } from './ui.js';

const newId = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

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
    const p1 = await pinPad('Create a 4-digit caregiver PIN');
    if (!p1) return;
    const p2 = await pinPad('Type the same PIN again');
    if (p1 !== p2) { showStatus('The two PINs did not match. Try again.', 'warn'); return; }
    s.pin = p1;
    commit({ redraw: false });
  } else {
    const p = await pinPad('Caregiver PIN');
    if (!p) return;
    if (p !== s.pin) { showStatus('Wrong PIN.', 'warn'); return; }
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
    showStatus(s.lastBackup
      ? `Last backup was ${since} days ago. Make a new one so nothing is lost.`
      : 'This board has never been backed up.', 'warn',
      [{ label: 'Back up now', onClick: () => exportBackup() }]);
  }
}

// -------------------------------------------------------- recorder widget ---

/** Record / play / delete controls for one recording.
 *  result() saves a new recording and returns the media id (or null). */
function recorderWidget(mediaId) {
  let current = mediaId, fresh = null, removed = false, rec = null;
  const msg = h('span', { class: 'hint' });
  const recBtn = h('button', { class: 'btn', type: 'button' });
  const playBtn = h('button', { class: 'btn', type: 'button' }, '▶ Play');
  const delBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Delete recording' }, '🗑');
  const has = () => !!fresh || (!!current && !removed);
  const update = () => {
    recBtn.textContent = rec ? '⏹ Stop' : has() ? '🎙 Re-record' : '🎙 Record';
    recBtn.classList.toggle('recording', !!rec);
    playBtn.hidden = delBtn.hidden = !has() || !!rec;
  };
  recBtn.onclick = async () => {
    if (rec) { rec.stop().catch(() => {}); return; }
    stopAll();
    try {
      rec = await startRecording(10000);
      msg.textContent = 'Recording… say the word (stops after 10 s)';
      rec.finished.then(blob => { fresh = blob; removed = false; msg.textContent = 'Recorded ✓'; })
        .catch(e => { msg.textContent = '⚠️ ' + e.message; })
        .finally(() => { rec = null; update(); });
    } catch (e) {
      rec = null;
      msg.textContent = '⚠️ ' + (e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : e.message);
    }
    update();
  };
  playBtn.onclick = async () => {
    if (fresh) {
      const url = URL.createObjectURL(fresh);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      a.play().catch(() => { msg.textContent = '⚠️ Could not play the recording.'; });
    } else if (current) {
      const r = await playRecording(current);
      if (!r.ok) msg.textContent = '⚠️ Could not play the recording.';
    }
  };
  delBtn.onclick = () => { fresh = null; removed = true; msg.textContent = 'Recording removed'; update(); };
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

// ----------------------------------------------------------- button editor ---

/**
 * Add (existing = null) or edit a button. Designed to be done in < 20 s:
 * photo, label, record, category, Save. A timer shows how long it took.
 */
export function openEditor(existing, opts = {}) {
  const isNew = !existing;
  const locked = state.profile.settings.lockLayout;
  const startCat = existing ? existing.cat : (opts.cat === 'now' || !catById(opts.cat) ? state.profile.categories[0].id : opts.cat);
  const b = existing ? structuredClone(existing)
    : { id: newId('b'), cat: startCat, slot: null, en: '', hi: '', emoji: '', img: null, audio: null, hideText: false, alts: [] };
  const started = Date.now();

  // --- photo
  let newPhoto = null, photoRemoved = false;
  const preview = h('div', { class: 'photo-preview' }, b.emoji || '🖼️');
  if (b.img) getMediaURL(b.img).then(u => { if (u) preview.replaceChildren(h('img', { src: u, alt: '' })); }).catch(() => {});
  const photoMsg = h('span', { class: 'hint' });
  const handlePhoto = async file => {
    if (!file) return;
    photoMsg.textContent = 'Preparing photo…';
    try {
      newPhoto = await resizeImage(file);
      photoRemoved = false;
      preview.replaceChildren(h('img', { src: URL.createObjectURL(newPhoto), alt: '' }));
      photoMsg.textContent = 'Photo ready ✓';
    } catch (e) {
      photoMsg.textContent = '⚠️ ' + e.message + ' You can still save without a photo.';
    }
  };
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
    onchange: e => handlePhoto(e.target.files[0]) });
  const galInput = h('input', { type: 'file', accept: 'image/*', hidden: true,
    onchange: e => handlePhoto(e.target.files[0]) });

  // --- text fields
  const enIn = h('input', { type: 'text', value: b.en, placeholder: 'e.g. water', autocomplete: 'off' });
  const hiIn = h('input', { type: 'text', value: b.hi, placeholder: 'जैसे पानी', autocomplete: 'off' });
  const emojiIn = h('input', { type: 'text', value: b.emoji, placeholder: '💧', class: 'emoji-in', autocomplete: 'off' });
  const catSel = h('select', {}, state.profile.categories.map(c =>
    h('option', { value: c.id, selected: c.id === b.cat }, `${c.emoji} ${c.en}`)));
  const hideText = h('input', { type: 'checkbox', checked: !!b.hideText });
  const mainRec = recorderWidget(b.audio);

  // --- alternatives ("several spoken variants of one intent")
  const altRows = [];
  const altBox = h('div', { class: 'alts' });
  const addAlt = (a = { en: '', hi: '', audio: null }) => {
    const row = { en: h('input', { type: 'text', value: a.en, placeholder: 'I want water' }),
                  hi: h('input', { type: 'text', value: a.hi, placeholder: 'मुझे पानी चाहिए' }),
                  rec: recorderWidget(a.audio) };
    row.el = h('div', { class: 'alt-row' }, row.en, row.hi, row.rec.el,
      h('button', { class: 'btn small danger', type: 'button', onclick: () => {
        altRows.splice(altRows.indexOf(row), 1); row.el.remove(); } }, '✕ Remove'));
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
        h('button', { class: 'btn', type: 'button', onclick: () => camInput.click() }, '📷 Camera'),
        h('button', { class: 'btn', type: 'button', onclick: () => galInput.click() }, '🖼️ Gallery'),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          newPhoto = null; photoRemoved = true; preview.replaceChildren(emojiIn.value || '🖼️'); } }, 'No photo'))),
    photoMsg, camInput, galInput,
    h('label', {}, 'Word (English)', enIn),
    h('label', {}, 'शब्द (Hindi)', hiIn),
    h('div', { class: 'field' }, h('span', {}, 'Record the word (optional, plays instead of the computer voice)'), mainRec.el),
    h('label', {}, 'Category', catSel),
    h('details', {},
      h('summary', {}, 'More options'),
      h('label', {}, 'Emoji (used when there is no photo)', emojiIn),
      h('label', { class: 'check' }, hideText, ' Hide the text on this button'),
      h('div', { class: 'field' },
        h('span', {}, 'Other ways to say it (shown on long-press)'),
        altBox,
        h('button', { class: 'btn', type: 'button', onclick: () => addAlt() }, '＋ Add another way to say it'))),
    err);

  const cleanup = () => { clearInterval(tick); mainRec.stop(); altRows.forEach(r => r.rec.stop()); };

  const save = async () => {
    const en = enIn.value.trim(), hi = hiIn.value.trim();
    if (!en && !hi) { err.textContent = 'Please type the word in English or Hindi.'; enIn.focus(); return false; }
    try {
      let img = b.img;
      if (newPhoto) img = await putMedia(newPhoto, 'i');
      else if (photoRemoved) img = null;
      const audio = await mainRec.result();
      const alts = [];
      for (const r of altRows) {
        const aEn = r.en.value.trim(), aHi = r.hi.value.trim();
        if (aEn || aHi) alts.push({ en: aEn || aHi, hi: aHi || aEn, audio: await r.rec.result() });
      }
      const cat = catSel.value;
      // Placement: new buttons fill the chosen empty slot, or the next free one.
      // Existing buttons keep their slot unless moved to another category.
      let slot = b.slot;
      const taken = s => state.profile.buttons.some(x => x.cat === cat && x.slot === s && x.id !== b.id);
      if (isNew) slot = (opts.slot != null && cat === startCat && !taken(opts.slot)) ? opts.slot : nextEmptySlot(cat);
      else if (cat !== existing.cat) slot = nextEmptySlot(cat);

      const updated = { ...b, cat, slot, en: en || hi, hi: hi || en,
        emoji: emojiIn.value.trim() || (img ? '' : '⬜'), img, audio, hideText: hideText.checked, alts };
      if (isNew) state.profile.buttons.push(updated);
      else state.profile.buttons[state.profile.buttons.findIndex(x => x.id === b.id)] = updated;
      cleanup();
      commit();
      if (isNew) showStatus(`Button "${labelOf(updated)}" added in ${Math.round((Date.now() - started) / 1000)} seconds.`, 'info');
      return true;
    } catch (e) {
      err.textContent = 'Could not save: ' + e.message;
      return false;
    }
  };

  const actions = [{ label: 'Cancel', onClick: cleanup }];
  if (!isNew) {
    actions.push({ label: '↔ Move', disabled: locked, onClick: () => { cleanup(); state.moving = b.id; render(); } });
    actions.push({ label: '🗑 Delete', kind: 'danger', disabled: locked, onClick: async () => {
      if (!(await confirmDialog(`Delete the button "${labelOf(b)}"?`, 'Delete', 'Keep', true))) return false;
      await takeSnapshot(state.profile, 'before-delete');
      state.profile.buttons = state.profile.buttons.filter(x => x.id !== b.id);
      cleanup(); commit();
    } });
  }
  actions.push({ label: '✔ Save', kind: 'primary', onClick: save });

  openModal({ title: isNew ? 'Add a button' : `Edit "${labelOf(b)}"`, body: !isNew && locked
    ? h('div', {}, h('p', { class: 'hint' }, '🔒 Layout is locked: buttons can be edited but not moved or deleted. Unlock in Settings.'), body)
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
  showStatus('Preparing backup…', 'info');
  try {
    const { file, missing } = await buildBackup(state.profile);
    const how = await shareOrDownload(file, preferShare);
    if (how === 'cancelled') { showStatus('Backup cancelled.', 'info'); return; }
    state.profile.settings.lastBackup = new Date().toISOString();
    commit();
    showStatus(`Backup ${how}: ${file.name} (${(file.size / 1048576).toFixed(1)} MB)` +
      (missing ? `. ${missing} media file(s) were missing and skipped.` : '.'), 'info');
  } catch (e) {
    showStatus('Backup failed: ' + e.message, 'error');
  }
}

async function importBackup(file) {
  if (!file) return;
  let data;
  try { data = await readBackup(file); }
  catch (e) { showStatus(e.message, 'error'); return; }
  const s = data.summary;
  const ok = await confirmDialog(
    `Backup from ${fmtDate(s.exportedAt)}: ${s.buttons} buttons, ${s.photos} photos, ${s.recordings} recordings, ` +
    `${s.phrases} phrases, ${s.routines} routines. Replace the board on this device? ` +
    `(The current board is kept as a snapshot you can restore.)`, 'Import', 'Cancel');
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
      title: 'Import complete ✓',
      body: h('ul', {},
        h('li', {}, `${s.buttons} buttons in ${s.categories} categories`),
        h('li', {}, `${s.photos} photos, ${s.recordings} recordings`),
        h('li', {}, `${s.phrases} saved phrases, ${s.routines} routine rules`),
        h('li', {}, 'Settings, colours and PIN restored'),
        (s.missingMedia + failed) ? h('li', {}, `⚠️ ${s.missingMedia + failed} photo/recording file(s) could not be restored`) : null),
      actions: [{ label: 'OK', kind: 'primary' }],
    });
  } catch (e) {
    showStatus('Import failed: ' + e.message + '. Nothing was lost; use Restore last working version if needed.', 'error');
  }
}

/** One tap: go back to the newest automatic snapshot that differs from now.
 *  The current version is snapshotted first, so the restore can be undone. */
export async function restoreLastWorking() {
  try {
    if (!state.profile) return;
    const snap = await lastWorkingVersion(state.profile);
    if (!snap) { showStatus('There is no earlier version to restore.', 'info'); return; }
    await restoreSnapshot(snap);
  } catch (e) {
    showStatus('Restore failed: ' + e.message, 'error');
  }
}

async function restoreSnapshot(snap) {
  await takeSnapshot(state.profile, 'before-restore');
  state.profile = normaliseProfile(snap.profile);
  state.moving = null;
  closeAllModals();
  await saveProfile(state.profile);
  render();
  showStatus(`Restored the version from ${fmtDate(snap.at)}.`, 'info',
    [{ label: 'Undo', onClick: restoreLastWorking }]);
}

// ----------------------------------------------------------------- settings ---

function selectRow(label, value, options, onChange) {
  return h('label', {}, label, h('select', { onchange: e => onChange(e.target.value) },
    options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))));
}
function checkRow(label, checked, onChange) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }), ' ', label);
}
/** Change a setting, save and redraw the board behind the dialog. */
const setSetting = (key, value) => { state.profile.settings[key] = value; commit(); };

export function openSettings(focus) {
  const s = state.profile.settings;
  const sections = h('div', { class: 'settings' },
    voiceSection(s),
    layoutSection(s),
    routinesSection(),
    categoriesSection(),
    backupSection(s),
    safetySection(),
    pinSection());
  openModal({ title: '⚙️ Caregiver settings', body: sections, full: true });
  if (focus) sections.querySelector(`#set-${focus}`)?.scrollIntoView();
}

/** Voice test on its own (safe to open without the PIN). */
export function openVoiceTest() {
  openModal({ title: '🔊 Voice check', body: voiceSection(state.profile.settings) });
}

function voiceSection(s) {
  const out = h('ul', { class: 'report' });
  return h('section', { id: 'set-voice' }, h('h3', {}, '🔊 Voice & language'),
    selectRow('Language', s.lang, [['en', 'English'], ['hi', 'हिंदी (Hindi)']], v => setSetting('lang', v)),
    selectRow('Speaking speed', s.rate, [[0.6, 'Slow'], [0.9, 'Normal'], [1.2, 'Fast']], v => setSetting('rate', Number(v))),
    checkRow('Speak each word when its button is tapped', s.speakOnTap, v => setSetting('speakOnTap', v)),
    h('button', { class: 'btn primary', onclick: async () => {
      out.replaceChildren(h('li', {}, 'Testing… you should hear English, then Hindi.'));
      const report = await testVoices(state.profile.settings.rate);
      out.replaceChildren(...report.map(r => h('li', {}, r)));
      if (report.some(r => r.startsWith('❌')))
        out.append(h('li', {}, 'Tip (Android): Settings → System → Languages → Text-to-speech → Google → install Hindi (India) voice data. Recorded words always work.'));
    } }, '▶ Test voice'),
    out);
}

function layoutSection(s) {
  return h('section', {}, h('h3', {}, '🧩 Layout & look'),
    checkRow('🔒 Lock layout (buttons cannot be moved or deleted)', s.lockLayout, v => setSetting('lockLayout', v)),
    selectRow('Buttons per row (changing this re-flows the grid)', s.cols,
      [3, 4, 5, 6, 7, 8].map(n => [n, String(n)]), v => setSetting('cols', Number(v))),
    selectRow('Button size', s.buttonSize, [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']], v => setSetting('buttonSize', v)),
    selectRow('Text size', s.textSize, [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']], v => setSetting('textSize', v)),
    checkRow('Show text under pictures', s.showText, v => setSetting('showText', v)),
    checkRow('Colour buttons by category', s.colorByCategory, v => setSetting('colorByCategory', v)),
    selectRow('Colour theme', s.theme, [['light', 'Light'], ['dark', 'Dark'], ['contrast', 'High contrast'], ['calm', 'Calm (muted)']], v => setSetting('theme', v)),
    checkRow('Show "My phrases" row', s.showPhrases, v => setSetting('showPhrases', v)),
    checkRow('Show "Recent" row', s.showRecent, v => setSetting('showRecent', v)),
    selectRow('Ignore repeated taps on the same button within', s.tapGuardMs,
      [[0, 'Off'], [300, '0.3 s'], [600, '0.6 s'], [1000, '1 s']], v => setSetting('tapGuardMs', Number(v))));
}

function routinesSection() {
  const box = h('div');
  const r = state.profile.routines;
  const catOptions = sel => state.profile.categories.map(c => h('option', { value: c.id, selected: c.id === sel }, `${c.emoji} ${c.en}`));
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const draw = () => {
    box.replaceChildren(
      checkRow('Use the "Now" screen (suggest a board by time of day)', r.enabled, v => { r.enabled = v; if (!v && state.tab === 'now') state.tab = state.profile.categories[0].id; commit(); }),
      h('p', { class: 'hint' }, 'Rules are checked top to bottom; the first one that matches the day and time is used.'),
      ...r.rules.map((rule, i) => h('div', { class: 'rule' },
        h('input', { type: 'text', value: rule.name, 'aria-label': 'Routine name', onchange: e => { rule.name = e.target.value; commit(); } }),
        h('div', { class: 'row wrap' },
          h('input', { type: 'time', value: rule.from, 'aria-label': 'From', onchange: e => { rule.from = e.target.value; commit(); } }),
          '→',
          h('input', { type: 'time', value: rule.to, 'aria-label': 'To', onchange: e => { rule.to = e.target.value; commit(); } }),
          h('select', { 'aria-label': 'Board', onchange: e => { rule.cat = e.target.value; commit(); } }, catOptions(rule.cat))),
        h('div', { class: 'row wrap days' }, DAYS.map((d, di) => h('label', { class: 'day' },
          h('input', { type: 'checkbox', checked: rule.days.includes(di), onchange: e => {
            rule.days = e.target.checked ? [...rule.days, di] : rule.days.filter(x => x !== di); commit(); } }), d))),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', disabled: i === 0, onclick: () => { [r.rules[i - 1], r.rules[i]] = [r.rules[i], r.rules[i - 1]]; commit(); draw(); } }, '▲'),
          h('button', { class: 'btn small', disabled: i === r.rules.length - 1, onclick: () => { [r.rules[i + 1], r.rules[i]] = [r.rules[i], r.rules[i + 1]]; commit(); draw(); } }, '▼'),
          h('button', { class: 'btn small danger', onclick: () => { r.rules.splice(i, 1); commit(); draw(); } }, '🗑 Remove')))),
      h('button', { class: 'btn', onclick: () => {
        r.rules.push({ id: newId('r'), name: 'New routine', from: '16:00', to: '17:00', days: [0, 1, 2, 3, 4, 5, 6], cat: state.profile.categories[0].id });
        commit(); draw(); } }, '＋ Add routine'),
      h('label', {}, 'When no routine matches, show', h('select', { onchange: e => { r.fallback = e.target.value; commit(); } }, catOptions(r.fallback))));
  };
  draw();
  return h('section', {}, h('h3', {}, '⏰ Routines ("Now" screen)'), box);
}

function categoriesSection() {
  const box = h('div');
  const draw = () => {
    const cats = state.profile.categories;
    const locked = state.profile.settings.lockLayout;
    box.replaceChildren(
      locked ? h('p', { class: 'hint' }, '🔒 Unlock the layout to reorder or delete categories.') : null,
      ...cats.map((c, i) => {
        const count = state.profile.buttons.filter(b => b.cat === c.id).length;
        return h('div', { class: 'cat-row', style: { '--cat': c.color } },
          h('input', { type: 'text', class: 'emoji-in', value: c.emoji, 'aria-label': 'Emoji', onchange: e => { c.emoji = e.target.value; commit(); } }),
          h('input', { type: 'text', value: c.en, 'aria-label': 'English name', onchange: e => { c.en = e.target.value; commit(); } }),
          h('input', { type: 'text', value: c.hi, 'aria-label': 'Hindi name', onchange: e => { c.hi = e.target.value; commit(); } }),
          h('input', { type: 'color', value: c.color, 'aria-label': 'Colour', onchange: e => { c.color = e.target.value; commit(); } }),
          h('span', { class: 'hint' }, `${count} buttons`),
          h('button', { class: 'btn small', disabled: locked || i === 0, onclick: () => { [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; commit(); draw(); } }, '▲'),
          h('button', { class: 'btn small', disabled: locked || i === cats.length - 1, onclick: () => { [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]]; commit(); draw(); } }, '▼'),
          h('button', { class: 'btn small danger', disabled: locked || cats.length < 2, onclick: async () => {
            if (count && !(await confirmDialog(`Delete "${c.en}" and its ${count} buttons?`, 'Delete', 'Keep', true))) return;
            await takeSnapshot(state.profile, 'before-delete');
            state.profile.categories.splice(i, 1);
            state.profile.buttons = state.profile.buttons.filter(b => b.cat !== c.id);
            commit(); draw();
          } }, '🗑'));
      }),
      h('button', { class: 'btn', onclick: () => {
        state.profile.categories.push({ id: newId('c'), en: 'New category', hi: 'नई श्रेणी', emoji: '⭐', color: '#cdb4db', kind: 'personal' });
        commit(); draw();
      } }, '＋ Add personal category (family, pets, favourite things…)'));
  };
  draw();
  return h('section', {}, h('h3', {}, '🗂️ Categories'), box);
}

function backupSection(s) {
  const fileIn = h('input', { type: 'file', accept: '.json,.bol,application/json', hidden: true,
    onchange: e => { importBackup(e.target.files[0]); e.target.value = ''; } });
  const days = daysSince(s.lastBackup);
  return h('section', {}, h('h3', {}, '💾 Backup & move to another device'),
    h('p', {}, `Last backup: ${fmtDate(s.lastBackup)}${s.lastBackup ? ` (${days} days ago)` : ''}`),
    h('p', { class: 'hint' }, 'One file holds everything: buttons, photos, recordings, phrases, routines and settings. No account needed.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => exportBackup(true) }, '📤 Share backup'),
      h('button', { class: 'btn', onclick: () => exportBackup(false) }, '⬇️ Download backup'),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, '📥 Import backup')),
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
      h('li', {}, offline ? '✅ Works offline' : '⚠️ Not ready offline yet — open the app once more while online'),
      h('li', {}, persist === 'granted' ? '✅ Storage is protected from automatic clearing'
        : '⚠️ Browser has not protected storage yet (install the app to the home screen to help). Keep backups.'),
      est ? h('li', {}, `Storage used: ${est.usedMB} MB`) : null);
    const snaps = await getSnapshots();
    snapsBox.replaceChildren(...snaps.map(sn => h('div', { class: 'row' },
      h('span', {}, `${fmtDate(sn.at)} (${sn.reason}) — ${sn.profile.buttons.length} buttons`),
      h('button', { class: 'btn small', onclick: () => restoreSnapshot(sn) }, 'Restore'))));
  })().catch(() => {});
  return h('section', { id: 'set-safety' }, h('h3', {}, '🛟 Safety'),
    info,
    h('button', { class: 'btn primary', onclick: restoreLastWorking }, '↩️ Restore last working version'),
    h('p', { class: 'hint' }, 'Automatic snapshots (newest first, last 3 kept):'),
    snapsBox,
    h('button', { class: 'btn danger', onclick: async () => {
      if (!(await confirmDialog('Reset to the starter board? Your current board is kept as a snapshot.', 'Reset', 'Cancel', true))) return;
      await takeSnapshot(state.profile, 'before-reset');
      const fresh = createDefaultProfile();
      fresh.settings.pin = state.profile.settings.pin;
      fresh.settings.lastBackup = state.profile.settings.lastBackup;
      state.profile = fresh;
      closeAllModals();
      commit();
    } }, 'Reset to starter board'));
}

function pinSection() {
  return h('section', {}, h('h3', {}, '🔑 Caregiver PIN'),
    h('button', { class: 'btn', onclick: async () => {
      const p1 = await pinPad('New PIN'); if (!p1) return;
      const p2 = await pinPad('Type the new PIN again'); if (!p2) return;
      if (p1 !== p2) { showStatus('PINs did not match; PIN unchanged.', 'warn'); return; }
      setSetting('pin', p1);
      showStatus('PIN changed.', 'info');
    } }, 'Change PIN'),
    h('p', { class: 'hint' }, 'Bol v1 · all data stays on this device · no account, no ads, free.'));
}
