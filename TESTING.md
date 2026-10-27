BOL - TESTING NOTES (version 2)

Live app: https://thomasneoanderson.github.io/bol/


1. EXPLANATION FOR MY PROFESSOR (5 lines)

Bol is a free picture-to-speech (AAC) web app for non-speaking children in India. It installs from a link and works with no internet, account or server.
The home screen is a fixed board of 36 "core" words (want, go, more, stop...) coloured by word type, plus topic boards, ready-made sentences and a typing tab.
Every word is stored as data in four languages (English, Hindi, Tamil, Kannada), so adding a language means adding data, not code; native speakers check translations through a spreadsheet.
Speaking tries the caregiver's recording, then the phone's voice, then a fallback language; if nothing can make sound, the words are shown full screen, so it never fails silently.
All data stays on the phone with automatic snapshots and one-file backups; typing suggestions come only from the user's own past sentences (simple matching, no machine learning).


2. AUTOMATED TESTS

Run:   cd tests && npm install && node e2e.mjs
(Set CHROME_PATH to a Chromium executable if Playwright's own browser is not installed.)

24 tests run in headless Chromium. That browser has no speech voices, which proves the
"no voice" fallbacks work. They cover: first-run language screen, core board order,
word-type colours, phrases, never-silent speech, draft restore, long-press variants,
saving phrases, adding a button with a photo, a broken image file, export/import between
two browser profiles, offline reload, restore, upgrade from Bol v1, the update banner,
Hindi/Tamil/Kannada boards and fonts, voice test report, second-language label,
symbols offline, typing suggestions and clearing typing history.

What the automated tests cannot check: real voices, the microphone, the camera, the
phone's share sheet, real keyboards, and how real children and caregivers use it.


3. DEVICE TEST CHECKLIST (do these on real phones)

Write down the phone model, Android/iOS version and browser for each test.

A. Install and first run
  [ ] Open the link in Chrome (Android) or Safari (iPhone) while online.
  [ ] The language screen appears with English, हिंदी, தமிழ், ಕನ್ನಡ. Pick one.
  [ ] Install: Chrome menu > Install app (Android) / Share > Add to Home Screen (iPhone).
  [ ] Open from the home screen. Core board is the first screen.

B. Airplane mode
  [ ] Open the app once online, close it, turn on airplane mode, open it again.
  [ ] All boards, symbols and fonts appear. Tap words and press Speak.
  [ ] Caregiver > Settings > Safety says "Works offline".

C. Force-close mid-sentence
  [ ] Tap 3 words, then immediately swipe the app away.
  [ ] Reopen: the 3 words are back with "Your unfinished sentence was restored".
  [ ] Repeat on the Type tab with half a typed sentence.

D. Upgrade from version 1 (if a phone already has the old Bol installed)
  [ ] Before updating, note a custom button, a recording and a saved phrase.
  [ ] Open the app online. Tap "Update available - tap to reload" if it appears.
      (Version 1 has no update banner: if the old version still shows, swipe the app
      away completely and open it again, once or twice, while online.)
  [ ] Message says Bol was updated; the custom button, recording, phrase, PIN and
      language are all still there, in the same positions. Core and Phrases tabs added.
  [ ] Settings > Safety lists a "before-upgrade" snapshot.

E. Backup to a second device
  [ ] Phone A: add a button with a photo and a recording, save a phrase, edit a routine.
  [ ] Caregiver > Settings > Share backup > send by WhatsApp (or Download backup).
  [ ] Phone B: Caregiver > Settings > Import backup > choose the file.
  [ ] Summary numbers are correct; photo, recording, phrase and routine all appear.
      Note: phone B now uses phone A's PIN.

F. Time to add a button (target: under 20 seconds)
  [ ] Caregiver > + Add button > Camera > type the word > Record > Save.
  [ ] The message says "added in N seconds". Repeat 5 times; write down each time.
  [ ] Check that no existing button moved.

G. Missing voices (do for Hindi, Tamil and Kannada)
  [ ] Remove the language's voice data (Android: Settings > Text-to-speech >
      Speech Services by Google > Install voice data > delete the language).
  [ ] Pick that language in Bol and tap a word: a yellow warning names the language
      and the word is spoken in English instead.
  [ ] Give one button a recording: it plays normally.
  [ ] Turn text-to-speech off completely and press Speak: the words appear full screen.
  [ ] Settings > Test voice: one line per language says "voice found" or "voice NOT
      found", followed by the install steps. Follow the steps, reopen Bol, test again.

H. Languages, fonts and keyboards
  [ ] On an older or cheaper phone, check Hindi, Tamil and Kannada text looks correct
      (no boxes, letters joined properly).
  [ ] Settings > Second language label: choose English. Small English words appear
      under each button.
  [ ] Type tab: switch the phone keyboard to Tamil/Kannada/Hindi, type a sentence,
      press Speak. Speak it twice; next time, the first letters bring it up as a suggestion.

I. Symbols and layout
  [ ] Core and topic boards show ARASAAC pictures; roti, idli and temple show emoji.
  [ ] Settings > Show picture symbols off: all buttons show emoji.
  [ ] Button colours: by word type / by category / none all work; positions never change.
  [ ] Lock layout on: buttons cannot be moved or deleted.

J. Updates
  [ ] After the next change is pushed, open the installed app online. The banner
      "Update available - tap to reload" appears. Nothing changes until it is tapped.


4. KNOWN LIMITATIONS

- Tamil and Kannada words and interface text are first drafts written with AI help and
  are NOT yet reviewed by native speakers (all marked "no" in vocab_review.csv). The Hindi
  has not been reviewed by a native speaker either.
- Speech quality depends on the phone. Tamil and Kannada voices are often not installed
  and must be downloaded once; some iPhones may not offer them at all.
- One recording per button plays in every language.
- Building sentences word by word in Hindi, Tamil and Kannada gives unnatural word order;
  the Phrases tab with ready-made sentences is the workaround.
- ARASAAC pictograms are licensed CC BY-NC-SA 4.0: Bol cannot be sold or used
  commercially. The attribution wording was taken from secondary sources because the
  arasaac.org terms page could not be read automatically; confirm it on arasaac.org.
- A few symbols are not ideal for India (no Indian foods; some pictures look European).
  roti, idli and temple use emoji. See symbol_review.md.
- All automated testing was in a headless desktop browser; nothing has been tested on
  real phones or with real users yet.
- On a narrow phone with 4 columns, long words are shown in smaller text. Choose
  3 columns or a smaller text size if that is hard to read.
- Changing the number of columns re-flows the grid; the Recent row reorders itself.
- The browser decides whether to keep stored data. iPhones can delete it after about a
  week of non-use unless the app is installed. Backups are the real safety net.
- The PIN is a child lock, not security. Backups are not encrypted and include the
  typing history, saved phrases and the PIN.
- The update banner needs a tap; until then the old version keeps running.
