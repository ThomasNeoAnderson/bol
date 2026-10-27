// sw.js — service worker: makes Bol load with no internet (airplane mode).
//
// Strategy: "cache first". On install, every file the app needs is downloaded
// into a versioned cache. Afterwards every request is answered from that cache,
// so the network is never needed. To ship an update, change CACHE_VERSION:
// the new worker caches the new files and deletes the old cache.

const CACHE_VERSION = 'bol-v1';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/state.js',
  './js/store.js',
  './js/vocab.js',
  './js/speech.js',
  './js/media.js',
  './js/backup.js',
  './js/routines.js',
  './js/caregiver.js',
  './js/ui.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          // Keep a copy of anything new we fetch from our own site.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline and not cached: for page loads, fall back to the app shell.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
