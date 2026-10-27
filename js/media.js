// media.js — photos and voice recordings for new buttons.
//
// Both functions are wrapped in timeouts and try/catch so a broken or huge
// file can never freeze the app: the worst case is a visible error message.

import { t } from './i18n.js';

const MAX_INPUT_BYTES = 25 * 1024 * 1024;   // refuse files larger than 25 MB
const IMAGE_SIZE = 320;                     // stored photos are max 320x320 px

/** Reject a promise if it takes longer than `ms`. */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** Decode an image file. Prefers createImageBitmap (fast, off the main
 *  thread, respects phone photo rotation) and falls back to <img>. */
async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* try <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('media.notPicture')));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Resize a photo to a square-ish thumbnail (JPEG). Returns a Blob. */
export async function resizeImage(file) {
  if (!file) throw new Error(t('media.noFile'));
  if (file.size > MAX_INPUT_BYTES) throw new Error(t('media.tooLarge'));
  const img = await withTimeout(decodeImage(file), 15000, t('media.slow'));
  const w = img.width, h = img.height;
  if (!w || !h) throw new Error(t('media.empty'));
  // Centre-crop to a square so photos fill the button evenly.
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(IMAGE_SIZE, side);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();
  const blob = await withTimeout(
    new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82)),
    10000, t('media.cantSave'));
  if (!blob) throw new Error(t('media.cantSave'));
  return blob;
}

/** Pick an audio format this browser can record (Chrome: webm, Safari: mp4). */
function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac']) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * Start recording from the microphone. Returns a controller:
 *   { stop(): Promise<Blob> }
 * Recording stops automatically after `maxMs` (default 10 s).
 */
export async function startRecording(maxMs = 10000) {
  const mime = pickMime();
  if (mime === null) throw new Error(t('media.noRecorder'));
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    throw new Error(t('media.noMic'));
  const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }), 20000,
    t('rec.denied'));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

  const finished = new Promise((resolve, reject) => {
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());           // release the mic
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      blob.size ? resolve(blob) : reject(new Error(t('media.nothing')));
    };
    rec.onerror = e => { stream.getTracks().forEach(t => t.stop()); reject(e.error || new Error(t('media.recFailed'))); };
  });
  finished.catch(() => {});   // avoid "unhandled rejection" noise; stop() still reports errors
  rec.start();
  const auto = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, maxMs);
  return {
    stop() {
      clearTimeout(auto);
      if (rec.state === 'recording') rec.stop();
      return withTimeout(finished, 5000, t('media.recFailed'));
    },
    finished,
  };
}
