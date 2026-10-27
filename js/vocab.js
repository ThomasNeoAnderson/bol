// vocab.js — the starter board, the default profile, and upgrades of old
// profiles.
//
// A "profile" is everything that belongs to one user: buttons, categories,
// saved phrases, routines and settings. It is a plain JSON object, which makes
// it easy to save, snapshot and export. Photos and recordings are NOT stored
// inside it: the profile only holds their ids (see store.js).
//
// The starter vocabulary itself is DATA (data/vocab.json), not code. Each
// button has text in every language: text: {en, hi, ta, kn}.

export const SCHEMA_VERSION = 2;

let VOCAB = null;        // contents of data/vocab.json
let LEGACY = null;       // original v1 starter text, used to detect caregiver edits

export async function loadVocab() {
  const [v, l] = await Promise.all([
    fetch('data/vocab.json').then(r => { if (!r.ok) throw new Error('vocab.json missing'); return r.json(); }),
    fetch('data/legacy-v1.json').then(r => (r.ok ? r.json() : { buttons: {}, categories: {} })).catch(() => ({ buttons: {}, categories: {} })),
  ]);
  VOCAB = v; LEGACY = l;
}

export const wordTypes = () => VOCAB.wordTypes;
const starterButton = id => VOCAB.buttons.find(b => b.id === id);
const starterCategory = id => VOCAB.categories.find(c => c.id === id);

export const DEFAULT_SETTINGS = {
  lang: 'en',            // language of the board, the voice and the interface
  langChosen: false,     // false until the first-run language screen is answered
  secondLang: null,      // optional smaller second label under each button
  rate: 0.9,             // speech speed
  speakOnTap: true,      // speak each word as it is tapped
  cols: 5,               // grid columns
  buttonSize: 'm',       // s | m | l | xl
  textSize: 'm',         // s | m | l | xl
  showText: true,        // show labels under pictures
  colorMode: 'wordtype', // wordtype | category | none
  useSymbols: true,      // show ARASAAC symbols (false = emoji)
  theme: 'light',        // light | dark | contrast | calm
  lockLayout: true,      // when locked, buttons cannot be moved or deleted
  showPhrases: true,
  showRecent: true,
  tapGuardMs: 300,       // ignore a second tap on the same button within this time
  pin: null,             // set on first entry to caregiver mode
  lastBackup: null,      // ISO date of the last export
};

// Default routine rules. First matching rule wins. days: 0 = Sunday … 6 = Saturday
const DEFAULT_ROUTINES = {
  enabled: true,
  fallback: 'core',
  rules: [
    { id: 'r-breakfast', name: 'Breakfast', from: '07:30', to: '08:30', days: [0,1,2,3,4,5,6], cat: 'food' },
    { id: 'r-morning',   name: 'Morning routine', from: '06:00', to: '09:00', days: [0,1,2,3,4,5,6], cat: 'morning' },
    { id: 'r-lunch',     name: 'Lunch', from: '13:00', to: '14:00', days: [0,1,2,3,4,5,6], cat: 'food' },
    { id: 'r-school',    name: 'School', from: '09:00', to: '14:30', days: [1,2,3,4,5,6], cat: 'school' },
    { id: 'r-dinner',    name: 'Dinner', from: '19:30', to: '20:30', days: [0,1,2,3,4,5,6], cat: 'food' },
    { id: 'r-bedtime',   name: 'Bedtime', from: '20:30', to: '23:59', days: [0,1,2,3,4,5,6], cat: 'bedtime' },
  ],
};

const clone = o => JSON.parse(JSON.stringify(o));

/** A profile button made from a starter entry. */
function fromStarter(s) {
  return {
    id: s.id, cat: s.cat, slot: s.slot, pos: s.pos || null,
    text: clone(s.text), emoji: s.emoji, sym: s.sym || null,
    img: null, audio: null, hideText: false, edited: false,
    alts: (s.alts || []).map(a => ({ text: clone(a.text), audio: null })),
  };
}

/** A brand-new profile, as used on first launch or after "Reset". */
export function createDefaultProfile() {
  return {
    schema: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    categories: VOCAB.categories.map(c => ({ ...clone(c), edited: false })),
    buttons: VOCAB.buttons.map(fromStarter),
    phrases: [],       // "My phrases": saved sentences
    recent: [],
    history: [],       // typed/spoken sentences for typing suggestions
    routines: clone(DEFAULT_ROUTINES),
  };
}

// ------------------------------------------------------------ migration ---

const v1Text = o => {
  const t = {};
  if (o && o.en) t.en = o.en;
  if (o && o.hi) t.hi = o.hi;
  return t;
};
const v1Item = it => ({ bid: it.bid, text: it.text || v1Text(it), emoji: it.emoji, img: it.img || null, audio: it.audio || null });

/**
 * Upgrade a schema-1 profile (Bol v1: separate en/hi fields) to schema 2.
 * Nothing the caregiver made is dropped: custom buttons, photos, recordings,
 * phrases, routines and settings are all carried over. Starter buttons whose
 * text the caregiver changed are marked `edited` so they are never overwritten.
 */
function migrateV1(p) {
  const legacyB = (LEGACY && LEGACY.buttons) || {};
  const legacyC = (LEGACY && LEGACY.categories) || {};
  const sameAsV1 = (id, fields, table) => table[id] && JSON.stringify(table[id]) === JSON.stringify(fields);

  const categories = (p.categories || []).map(c => ({
    id: c.id, kind: c.kind === 'core' ? 'topic' : (c.kind || 'personal'), emoji: c.emoji, color: c.color,
    text: v1Text(c), edited: !sameAsV1(c.id, [c.en, c.hi], legacyC),
  }));
  const buttons = (p.buttons || []).map(b => {
    const s = starterButton(b.id);
    const fields = [b.en, b.hi, ...(b.alts || []).flatMap(a => [a.en, a.hi])];
    return {
      id: b.id, cat: b.cat, slot: b.slot, pos: s ? s.pos : null,
      text: v1Text(b), emoji: b.emoji, sym: null, img: b.img || null, audio: b.audio || null,
      hideText: !!b.hideText, edited: !(s && sameAsV1(b.id, fields, legacyB)),
      alts: (b.alts || []).map(a => ({ text: v1Text(a), audio: a.audio || null })),
    };
  });

  // New in v2: the Core and Phrases boards go first. Existing boards keep
  // their buttons in exactly the same slots.
  for (const id of ['phrases', 'core']) {
    if (!categories.some(c => c.id === id)) categories.unshift({ ...clone(starterCategory(id)), edited: false });
  }
  // New starter buttons (core words, phrases, idli/dosa…) are added only
  // into empty slots, so nothing the user knows moves.
  for (const s of VOCAB.buttons) {
    if (buttons.some(b => b.id === s.id) || !categories.some(c => c.id === s.cat)) continue;
    const used = new Set(buttons.filter(b => b.cat === s.cat).map(b => b.slot));
    let slot = s.slot;
    if (used.has(slot)) { slot = 0; while (used.has(slot)) slot++; }
    buttons.push({ ...fromStarter(s), slot });
  }

  const settings = { ...(p.settings || {}) };
  delete settings.colorByCategory;
  settings.colorMode = 'wordtype';
  settings.langChosen = true;     // v1 users already picked English or Hindi

  return {
    schema: 2,
    createdAt: p.createdAt,
    settings,
    categories,
    buttons,
    phrases: (p.phrases || []).map(ph => ({ id: ph.id, items: (ph.items || []).map(v1Item) })),
    recent: (p.recent || []).map(v1Item),
    history: [],
    routines: p.routines,
  };
}

/** Refresh starter buttons the caregiver has not edited, so corrected
 *  translations and new symbols reach existing users. Recordings, photos,
 *  slots and categories are never touched. */
function syncStarter(p) {
  for (const b of p.buttons) {
    const s = starterButton(b.id);
    if (!s || b.edited) continue;
    b.text = clone(s.text);
    b.pos = s.pos || null;
    b.sym = s.sym || null;
    if (!b.img) b.emoji = s.emoji;
    b.alts = (s.alts || []).map((a, i) => ({ text: clone(a.text), audio: (b.alts[i] && b.alts[i].audio) || null }));
  }
  for (const c of p.categories) {
    const s = starterCategory(c.id);
    if (s && !c.edited) { c.text = clone(s.text); c.kind = s.kind; }
  }
}

/** Accept any saved/imported/snapshot profile and return a complete schema-2
 *  profile. Old versions are upgraded; missing fields get defaults. */
export function normaliseProfile(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.buttons)) return createDefaultProfile();
  let p = clone(input);
  if ((p.schema || 1) < 2) p = migrateV1(p);
  const d = createDefaultProfile();
  const out = {
    schema: SCHEMA_VERSION,
    createdAt: p.createdAt || d.createdAt,
    settings: { ...d.settings, ...(p.settings || {}) },
    categories: Array.isArray(p.categories) && p.categories.length ? p.categories : d.categories,
    buttons: p.buttons.map(b => ({ alts: [], hideText: false, img: null, audio: null, sym: null, pos: null, edited: true, text: {}, ...b })),
    phrases: Array.isArray(p.phrases) ? p.phrases : [],
    recent: Array.isArray(p.recent) ? p.recent : [],
    history: Array.isArray(p.history) ? p.history : [],
    routines: p.routines && Array.isArray(p.routines.rules) ? { ...d.routines, ...p.routines } : d.routines,
  };
  syncStarter(out);
  return out;
}

/** True if a stored profile is from an older version and will be upgraded. */
export const needsMigration = p => !!p && (p.schema || 1) < SCHEMA_VERSION;
