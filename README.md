# Bol — बोल · போல் · ಬೋಲ್

A free, offline, symbol-based AAC (talking picture board) web app for autistic
children and non-speaking users in India, in **English, Hindi, Tamil and Kannada**.
No accounts, no ads, no backend, no tracking. Everything is stored on the device.

**Live:** https://thomasneoanderson.github.io/bol/ · Testing notes: [TESTING.md](TESTING.md) · Changes: [CHANGELOG.md](CHANGELOG.md)

## What it does

- **Core board (home):** 36 core words (I, want, go, more, stop, help…) in fixed
  positions, coloured by word type (verbs green, people yellow, describing words blue…).
- **Topic boards:** needs, food, feelings, people, places, home, play, school, routines,
  personal boards, each one tap away.
- **Phrases:** 32 ready-made sentences per language, in natural word order.
- **Type:** the phone's own keyboard, with suggestions taken only from this user's own
  saved phrases and past sentences.
- **Reliable voice:** the caregiver's recording, then the phone's voice, then a fallback
  language, then the words full screen. It never fails silently.
- **Data safety:** autosave, 3 automatic snapshots, one-tap restore, a draft that
  survives force-close, a one-file backup and import, and safe upgrades from older versions.
- **Caregiver mode** (PIN): add a button with a photo and recording in under 20 s, layout
  lock, sizes, themes, second-language labels, routines, voice test.

## Run it

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

The microphone, offline mode and "install as app" need **https** or `localhost`.
GitHub Pages provides https. Pages is set to deploy from `main` / root.

**After changing any file, run `python3 tools/build_sw.py`** before committing. It
updates the offline file list and the cache version, and installed apps then show
"Update available – tap to reload".

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `css/style.css` | Page skeleton and styles (no animations, ≥48 px targets) |
| `js/app.js` | Startup, board drawing, tapping, speaking, Now screen, language picker |
| `js/state.js` | Shared state; `commit()` = autosave + redraw |
| `js/store.js` | IndexedDB, snapshots, draft, persistent storage, media |
| `js/vocab.js` | Default profile, schema v2 migration, starter-word refresh |
| `js/i18n.js` | Loads languages and interface text; `t()` and `pick()` |
| `js/speech.js` | Recording → voice → fallback language → on-screen words |
| `js/typing.js` | Type tab and suggestion ranking |
| `js/caregiver.js` | PIN, button editor, settings, backup/import, restore |
| `js/media.js`, `js/backup.js`, `js/routines.js`, `js/ui.js` | Photos and recording, backup file, time rules, DOM helpers |
| `data/languages.json` | Languages: name in own script, speech codes, fallback |
| `data/vocab.json` | Starter boards, buttons, phrases, word types (all languages) |
| `data/ui.json` | Every interface string in every language |
| `symbols/` | ARASAAC pictograms (bundled, offline) |
| `fonts/` | Subsetted Noto Sans Devanagari/Tamil/Kannada |
| `sw.js` | Service worker (offline cache, update flow) |
| `tools/` | Build, translation review and symbol scripts |
| `tests/` | Headless browser tests (`cd tests && npm install && node e2e.mjs`) |

## Adding or correcting a language

- **Correct translations:** run `python3 tools/export_review.py` and give
  `vocab_review.csv` to a native speaker. They fix cells and set `reviewed` to `yes`.
  Then run `python3 tools/import_review.py vocab_review.csv` and `python3 tools/build_sw.py`.
  Existing users receive the corrections on their next start; buttons a caregiver
  edited are never overwritten.
- **Add a language:** add an entry to `data/languages.json` (code, name in its own
  script, speech codes such as `ml-IN`, fallback language, a voice-test sentence). Then
  add that language's text to `vocab.json` and `ui.json`, for example by adding a column
  to the CSV tools. No app code changes are needed. For a new script, also add a Noto
  font to `fonts/` and an `@font-face` rule.

## Symbols

Run `pip install pillow && python3 tools/fetch_symbols.py` to fetch pictograms for
buttons that lack one. To correct a bad match, pin a pictogram id in
`tools/symbol_keywords.json`, then re-run with `--all`. `symbol_review.md` lists every choice.

## Credits and licences

- **Pictograms:** Sergio Palao. Property of the Government of Aragón (Spain).
  Source: ARASAAC (https://arasaac.org). Licence: CC BY-NC-SA 4.0. Images were resized.
  Because of this licence, Bol must not be sold or used commercially.
- **Fonts:** Noto Sans Devanagari, Noto Sans Tamil and Noto Sans Kannada © The Noto
  Project Authors, SIL Open Font License 1.1 (`fonts/OFL.txt`).
- **Translations:** Tamil and Kannada are unreviewed first drafts (see `vocab_review.csv`).
