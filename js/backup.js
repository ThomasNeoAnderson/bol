// backup.js — export and import the whole profile as ONE file.
//
// File format (JSON, extension .bol.json):
// {
//   "format": "bol-backup", "version": 2,   (1 = Bol v1, still accepted) "exportedAt": "...",
//   "profile": { ...buttons, categories, phrases, routines, settings... },
//   "media":   { "<id>": { "type": "image/jpeg", "data": "<base64>" }, ... }
// }
// Photos and recordings are embedded as base64 text, so the single file holds
// everything and can be sent over WhatsApp, email, Bluetooth, USB, etc.

import { referencedMedia, getMediaBlob, putMediaWithId } from './store.js';
import { normaliseProfile } from './vocab.js';
import { t } from './i18n.js';

const FORMAT = 'bol-backup';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Build the backup file. Missing media is skipped, not fatal. */
export async function buildBackup(profile) {
  const media = {};
  let missing = 0;
  for (const id of referencedMedia(profile)) {
    try {
      const blob = await getMediaBlob(id);
      if (blob) media[id] = { type: blob.type, data: await blobToBase64(blob) };
      else missing++;
    } catch (e) { missing++; }
  }
  const data = { format: FORMAT, version: 2, exportedAt: new Date().toISOString(), profile, media };
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const file = new File([JSON.stringify(data)], `bol-backup-${date}.bol.json`, { type: 'application/json' });
  return { file, missing };
}

/** Share via the phone's share sheet if possible, otherwise download.
 *  Returns 'shared' | 'downloaded' | 'cancelled'. */
export async function shareOrDownload(file, preferShare = true) {
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Bol backup', text: 'Bol AAC backup' });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // Share failed for another reason: fall through to download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

/** Read and check a backup file WITHOUT changing anything yet.
 *  Returns {profile, media, summary}. Throws a readable error if invalid. */
export async function readBackup(file) {
  if (file.size > 300 * 1024 * 1024) throw new Error(t('import.tooLarge'));
  let data;
  try { data = JSON.parse(await file.text()); }
  catch (e) { throw new Error(t('import.notBackup')); }
  if (!data || data.format !== FORMAT || !data.profile) throw new Error(t('import.notBackup'));
  if (data.version > 2) throw new Error(t('import.newer'));
  // Older backups (v1) are upgraded on import, exactly like a stored profile.
  const profile = normaliseProfile(data.profile);
  const media = data.media || {};
  const ids = referencedMedia(profile);
  let photos = 0, recordings = 0;
  for (const id of ids) {
    const m = media[id];
    if (!m) continue;
    if (m.type.startsWith('image')) photos++; else recordings++;
  }
  const summary = {
    exportedAt: data.exportedAt,
    buttons: profile.buttons.length,
    categories: profile.categories.length,
    phrases: profile.phrases.length,
    routines: profile.routines.rules.length,
    photos, recordings,
    missingMedia: [...ids].filter(id => !media[id]).length,
  };
  return { profile, media, summary };
}

/** Write imported media into IndexedDB. Bad entries are skipped. */
export async function storeImportedMedia(media) {
  let failed = 0;
  for (const [id, m] of Object.entries(media)) {
    try { await putMediaWithId(id, m.type, base64ToBuffer(m.data)); } catch (e) { failed++; }
  }
  return failed;
}
