# Bol — बोल

A free, offline, symbol-based AAC (talking picture board) web app for autistic
children and non-speaking users in India. Hindi + English. No accounts, no
ads, no backend, no tracking. Everything is stored on the device.

## Run it

Any static web server works. Locally:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

> The microphone, the service worker (offline mode) and "install as app" need
> **https** or `localhost`. GitHub Pages gives you https automatically.

### Host on GitHub Pages

1. Create a GitHub repository and push this folder's contents to it.
2. Repository → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Open `https://<username>.github.io/<repo>/` on the phone, then use
   "Add to Home screen" / "Install app".

When you change any file, bump `CACHE_VERSION` in `sw.js` (e.g. `bol-v2`).
Otherwise phones keep the old cached copy.

## Project layout

| File | What it does |
|---|---|
| `index.html` | Page skeleton: toolbar, sentence bar, strips, tabs, grid |
| `css/style.css` | Themes, sizes, 48px minimum targets, no animations |
| `js/app.js` | Startup, draws the board, tapping, speaking, Now screen |
| `js/state.js` | Shared in-memory state; `commit()` = autosave + redraw |
| `js/store.js` | IndexedDB, snapshots, draft, persistent storage, media |
| `js/speech.js` | Recording → speech synthesis → other language → on-screen text |
| `js/media.js` | Photo resize (camera/gallery) and microphone recording |
| `js/backup.js` | Single-file export/import with embedded photos and audio |
| `js/routines.js` | Time-of-day rules for the "Now" screen |
| `js/caregiver.js` | PIN, button editor, settings, restore, import/export UI |
| `js/vocab.js` | Starter vocabulary (80 core buttons, Hindi + English) |
| `sw.js` | Service worker: caches every file for airplane mode |
| `manifest.webmanifest`, `icons/` | PWA install metadata |

## How it works

- **Data:** one JSON "profile" (buttons, categories, phrases, routines,
  settings) lives in IndexedDB. Photos and recordings sit in a separate store
  and the profile refers to them by id. Every change saves straight away.
- **Stable layout:** each button has a fixed `slot` number in its category.
  The grid draws empty slots as blanks. New buttons go into the first empty
  slot, so existing buttons never shift. Only a caregiver can move buttons,
  and only after turning off "Lock layout".
- **Safety:** the app keeps the last 3 automatic snapshots (taken at startup,
  every 10 min while editing, and before a delete, import, reset or restore).
  "Restore last working version" goes back to the newest snapshot that
  differs from the current board. The current board is snapshotted first, so
  a restore can be undone. The unfinished sentence is mirrored to
  `localStorage` on every tap.
- **Voice:** recordings play first. Speech synthesis has timeouts, because
  some browsers never report "start" or "end". If the chosen language has no
  voice, the app tries the other language. If nothing can make sound, it shows
  a warning and puts the words full-screen for the listener.

Default caregiver PIN: none. You create one the first time you open
Caregiver mode.
