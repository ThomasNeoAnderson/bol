# Changelog

## 2.0 — 28 October 2026

Upgrade aimed at the biggest gaps found when comparing Bol with Avaz: missing core
words, only two languages, emoji placeholders, and no typing. Existing v1 data is
upgraded automatically (a snapshot of the old version is taken first).

### Phase 1: core vocabulary and layout
- Fixed **Core** home board with 36 core words in permanent positions.
- Topic boards (needs, food, feelings, people, places, home, play, school…) one tap away;
  Core is always the first tab.
- **Phrases** tab: 32 ready-made whole sentences per language.
- Buttons coloured by **word type** (Modified Fitzgerald Key: verbs green, people yellow,
  describing words blue, nouns orange, social pink, questions purple, little words grey),
  switchable to category colours or none.
- Vocabulary, interface text and languages moved to `data/*.json`.
- Profile schema v2 with a migration from v1 that keeps custom buttons, photos,
  recordings, phrases, routines, settings and caregiver edits.
- "Update available – tap to reload" banner; the service-worker cache version is now
  generated from file hashes (`tools/build_sw.py`).
- Fixed: button colours never applied in v1 (CSS variables were set incorrectly).
- Fixed: a first install no longer reloads the page by itself.

### Phase 2: Tamil and Kannada
- Tamil and Kannada added (Hindi and English kept): all vocabulary, phrases and
  interface text, in everyday spoken forms, marked unreviewed.
- `vocab_review.csv` plus `tools/export_review.py` / `tools/import_review.py` for native-speaker review.
- First-run language screen; language names shown in their own scripts.
- Optional smaller second-language label under each button.
- Test voice reports each language separately, with Android install steps.
- Bundled, subsetted Noto Sans Devanagari, Tamil and Kannada fonts (SIL OFL), cached offline.

### Phase 3: real symbols
- 134 ARASAAC pictograms bundled in `symbols/` (no internet needed at run time);
  emoji kept as a fallback and where no good match exists.
- Every match checked; `symbol_review.md` lists each button and its picture.
- ARASAAC attribution (CC BY-NC-SA 4.0) in About & credits and README.

### Phase 4: typing
- **Type** tab using the phone's own keyboard, with suggestions from the user's own saved
  phrases and past sentences (prefix/substring matching, ranked by frequency and recency).
- Typing history is stored locally and can be cleared by the caregiver.

### Tests
- Headless browser test suite in `tests/` (24 tests).

## 1.0 — 27 October 2026
- First prototype: Hindi/English symbol board, sentence bar, recordings with
  speech fallback, IndexedDB autosave and snapshots, add-a-button, My phrases, Recent,
  routine-based Now screen, caregiver PIN and settings, one-file backup/import, offline PWA.
