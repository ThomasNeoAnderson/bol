// store.js — everything about keeping data safe on the device.
//
// IndexedDB database "bol" has two object stores:
//   kv    : small JSON values  -> 'profile' (current), 'snapshots' (last 3)
//   media : photos and recordings, stored as {id, type, buf: ArrayBuffer}
//
// Safety rules implemented here:
//   * every change is saved immediately (autosave), writes run one at a time
//   * the last 3 known-good versions are kept as snapshots
//   * the unfinished sentence is mirrored to localStorage (synchronous, so it
//     survives the app being force-closed a moment after a tap)
//   * we ask the browser for "persistent" storage so it is not auto-evicted

const DB_NAME = 'bol';
const DB_VERSION = 1;
const MAX_SNAPSHOTS = 3;
const DRAFT_KEY = 'bol-draft';

let dbPromise = null;

/** Open (or create) the database once and reuse the connection. */
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another open tab'));
  });
  return dbPromise;
}

/** Run one request inside a transaction and resolve with its result. */
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

const kvGet = key => tx('kv', 'readonly', s => s.get(key));
const kvSet = (key, value) => tx('kv', 'readwrite', s => s.put(value, key));

// ---------------------------------------------------------------- profile ---

/** Load the stored profile exactly as saved (it may be an older schema; the
 *  caller upgrades it after taking a snapshot). If it is missing or damaged,
 *  fall back to the newest snapshot. Returns {raw, source}; raw is null for a
 *  brand-new install. */
export async function loadProfile() {
  try {
    const p = await kvGet('profile');
    if (p && Array.isArray(p.buttons)) return { raw: p, source: 'saved' };
  } catch (e) {
    console.error('Profile read failed', e);
  }
  try {
    const snaps = await getSnapshots();
    if (snaps.length) return { raw: snaps[0].profile, source: 'snapshot' };
  } catch (e) {
    console.error('Snapshot read failed', e);
  }
  return { raw: null, source: 'new' };
}

// Writes are chained so two quick changes can never finish out of order.
let writeChain = Promise.resolve();
let saveListener = () => {};
export function onSaveStatus(fn) { saveListener = fn; }

/** Autosave: called after every change. Stores a deep copy of the profile. */
export function saveProfile(profile) {
  const copy = JSON.parse(JSON.stringify(profile));
  writeChain = writeChain
    .then(() => kvSet('profile', copy))
    .then(() => saveListener({ ok: true }))
    .catch(err => { console.error('Save failed', err); saveListener({ ok: false, err }); });
  return writeChain;
}

// -------------------------------------------------------------- snapshots ---

export async function getSnapshots() {
  return (await kvGet('snapshots')) || [];
}

/** Keep a copy of a known-good profile. Skips duplicates of the newest one. */
export async function takeSnapshot(profile, reason = 'auto') {
  const json = JSON.stringify(profile);
  const snaps = await getSnapshots();
  if (snaps.length && JSON.stringify(snaps[0].profile) === json) return snaps;
  snaps.unshift({ at: new Date().toISOString(), reason, profile: JSON.parse(json) });
  const kept = snaps.slice(0, MAX_SNAPSHOTS);
  await kvSet('snapshots', kept);
  return kept;
}

/** Find the newest snapshot that differs from the current profile. */
export async function lastWorkingVersion(current) {
  const json = JSON.stringify(current);
  const snaps = await getSnapshots();
  return snaps.find(s => JSON.stringify(s.profile) !== json) || null;
}

// ------------------------------------------------------------------ media ---

/** Save a Blob (photo or recording); returns its new id. */
export async function putMedia(blob, idPrefix = 'm') {
  const id = `${idPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const buf = await blob.arrayBuffer();
  await tx('media', 'readwrite', s => s.put({ id, type: blob.type || 'application/octet-stream', buf }));
  return id;
}

/** Store media with a known id (used by import). */
export async function putMediaWithId(id, type, buf) {
  await tx('media', 'readwrite', s => s.put({ id, type, buf }));
}

// Object URLs are cached so each image is decoded once per session.
const urlCache = new Map();

/** Return a Blob for a media id, or null if it does not exist. */
export async function getMediaBlob(id) {
  if (!id) return null;
  const rec = await tx('media', 'readonly', s => s.get(id));
  return rec ? new Blob([rec.buf], { type: rec.type }) : null;
}

/** Return an object URL for a media id (cached), or null. */
export async function getMediaURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getMediaBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export async function allMediaIds() {
  return (await tx('media', 'readonly', s => s.getAllKeys())) || [];
}

/** All media ids referenced by a profile (photos + recordings + phrase audio). */
export function referencedMedia(profile) {
  const ids = new Set();
  const add = id => id && ids.add(id);
  // Works on any schema version: only the img/audio fields are read.
  for (const b of profile.buttons || []) {
    add(b.img); add(b.audio);
    (b.alts || []).forEach(a => add(a.audio));
  }
  for (const ph of profile.phrases || []) (ph.items || []).forEach(it => { add(it.img); add(it.audio); });
  for (const it of profile.recent || []) { add(it.img); add(it.audio); }
  return ids;
}

/** Delete media no longer used by the profile OR any snapshot (so restoring
 *  a snapshot never finds its photos missing). */
export async function collectGarbage(profile) {
  const keep = referencedMedia(profile);
  for (const s of await getSnapshots()) referencedMedia(s.profile).forEach(id => keep.add(id));
  // Keep the unfinished sentence's media too.
  for (const it of loadDraft()) { if (it.img) keep.add(it.img); if (it.audio) keep.add(it.audio); }
  const all = await allMediaIds();
  const unused = all.filter(id => !keep.has(id));
  if (unused.length) await tx('media', 'readwrite', s => { unused.forEach(id => s.delete(id)); return null; });
  return unused.length;
}

// ------------------------------------------------------------------ draft ---

/** The sentence bar is mirrored to localStorage on every tap. */
export function saveDraft(items) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(items)); } catch (e) { /* storage full: ignore */ }
}
export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || []; } catch (e) { return []; }
}

// ------------------------------------------------------------ persistence ---

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch (e) {
    return 'unsupported';
  }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate();
    return { usedMB: (e.usage / 1048576).toFixed(1), quotaMB: (e.quota / 1048576).toFixed(0) };
  } catch (e) { return null; }
}
