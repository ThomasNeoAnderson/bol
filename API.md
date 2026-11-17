# Bol API

The Bol API covers the starter tiles (buttons) of Bol and what the app does with
them:

| What | How |
|---|---|
| Tile information: labels in English, Hindi, Tamil and Kannada, alternative wordings, word types and colours, emoji, ARASAAC symbols | Static JSON [endpoints](#endpoints) |
| Speech synthesis: every tile, alternative and ready-made sentence spoken in all 4 languages | Static MP3 [audio files](#audio) |
| Sentence construction from tiles, with the app's speech plan | [`bol.js`](#javascript-client-boljs) `buildSentence()` · MCP `build_sentence` |
| Autocomplete for typed text | [`bol.js`](#javascript-client-boljs) `autocomplete()` · MCP `autocomplete` |
| Search tiles by word, board or word type | [`bol.js`](#javascript-client-boljs) `searchTiles()` · MCP `search_tiles` |
| Speaking a sentence or typed text as one audio file | MCP `speak` ([mcp/README.md](mcp/README.md)) |
| All of the above for AI assistants (Claude, Cursor, VS Code…) | [MCP server](mcp/README.md) |

**Why some parts are a library and not a URL:** GitHub Pages only serves files and
cannot run code for each request. So everything that can be prepared in advance
(tile data, audio) is a file at a fixed URL, and the operations that depend on the
caller's input (sentences, autocomplete) run in `bol.js` in the caller's browser, or
in the MCP server on the caller's computer. Both use the app's own rules from
`js/core.js`, and the tests check that they give the same answers as the app.

**Base URL:** `https://thomasneoanderson.github.io/bol/api/v1/`

It is served by GitHub Pages, so there is no key, no login and no rate-limit
sign-up. Responses allow requests from any website (CORS). Every endpoint is a plain
`GET` of a static `.json` file, so it also works in a browser address bar.

## Endpoints

| Endpoint | Returns |
|---|---|
| `index.json` | API info, counts, languages and the list of endpoints |
| `tiles.json` | All 169 tiles |
| `tiles/{id}.json` | One tile, for example `tiles/core-0.json` |
| `categories.json` | All 15 categories with tile counts |
| `categories/{id}.json` | One category with its tiles in board order, for example `categories/food.json` |
| `languages.json` | Language codes, names in their own script, speech-voice codes |
| `word-types.json` | Word types and their colours (Modified Fitzgerald Key) |
| `audio/{lang}/{id}.mp3` | A tile spoken in a language, for example `audio/ta/needs-2.mp3` |
| `audio/{lang}/{id}.alt{n}.mp3` | A tile's alternative wording `n` (0 = first) spoken |
| `audio/manifest.json` | The exact text, voice and SHA-256 hash of every audio file |
| `bol.js` | JavaScript client with the operations (see below) |

Category ids: `core`, `phrases`, `needs`, `food`, `feelings`, `people`, `places`,
`home`, `play`, `school`, `morning`, `bedtime`, `family`, `pets`, `favs`.
`family`, `pets` and `favs` are personal categories. They start empty and are
filled in by caregivers on their own phone, so they have no tiles here.

## Examples

```bash
curl https://thomasneoanderson.github.io/bol/api/v1/tiles/needs-2.json
curl https://thomasneoanderson.github.io/bol/api/v1/categories/core.json
```

```js
const res = await fetch('https://thomasneoanderson.github.io/bol/api/v1/categories/food.json');
const food = await res.json();
console.log(food.tiles.map(t => t.label.hi));   // Hindi labels in board order
```

```python
import requests
tiles = requests.get('https://thomasneoanderson.github.io/bol/api/v1/tiles.json').json()
print(len(tiles), tiles[0]['label'])
```

## Tile fields

```json
{
 "id": "needs-2",
 "category": "needs",
 "slot": 2,
 "label": { "en": "help", "hi": "मदद", "ta": "உதவி", "kn": "ಸಹಾಯ" },
 "alternatives": [ { "en": "help me please", "hi": "प्लीज़ मेरी मदद करो", "ta": "…", "kn": "…" } ],
 "wordType": "verb",
 "color": "#8fd18f",
 "emoji": "🙋",
 "symbol": {
  "url": "https://thomasneoanderson.github.io/bol/symbols/needs-2.webp",
  "arasaacId": 4570,
  "attribution": "Pictograms: Sergio Palao. Origin: ARASAAC …"
 },
 "reviewed": { "en": true, "hi": false, "ta": false, "kn": false },
 "url": "https://thomasneoanderson.github.io/bol/api/v1/tiles/needs-2.json"
}
```

| Field | Meaning |
|---|---|
| `id` | Stable tile id; never reused |
| `category`, `slot` | Category id and position on that board (0 = first). Positions never move, to support motor memory |
| `label` | Text in each language code (`en`, `hi`, `ta`, `kn`) |
| `alternatives` | Other wordings a caregiver can pick with a long-press. May be empty |
| `wordType` | `person`, `verb`, `describe`, `noun`, `social`, `question`, `little` or `null` (phrases) |
| `color` | Background colour for the word type, or `null` |
| `emoji` | Shown when there is no symbol |
| `symbol` | ARASAAC pictogram (192 px WebP) with its id and required credit, or `null` (roti, idli, temple, and all phrases) |
| `reviewed` | Whether a native speaker has checked each language. Only English is checked so far: the Hindi, Tamil and Kannada labels are drafts |
| `audio`, `alternativeAudio` | MP3 of the label (and of each alternative) in each language. Added in Bol 2.2; existing fields are unchanged |

## Audio

Every tile, alternative and ready-made sentence is spoken in all four languages
(792 MP3 files, mono, 22 kHz, about 1–3 seconds each). They are made with
**eSpeak NG**, an open-source speech engine that covers Hindi, Tamil and Kannada. It
sounds robotic. The app itself does not use these files: on a phone it speaks with
the phone's own (usually better) voice or a caregiver's recording.

```html
<audio controls src="https://thomasneoanderson.github.io/bol/api/v1/audio/hi/phrases-0.mp3"></audio>
```

## JavaScript client (`bol.js`)

```html
<script type="module">
  import * as bol from 'https://thomasneoanderson.github.io/bol/api/v1/bol.js';

  const s = await bol.buildSentence(['core-0', 'core-2', 'needs-7'], 'hi');
  s.text          // "मैं चाहिए पानी"  — exactly what the app shows and says
  s.phrase.text   // "मुझे पानी चाहिए" — ready-made sentence with natural word order
  s.speech        // [{type:'speech', lang:'hi', voices:['hi-IN','hi'], text, fallback:{lang:'en', …}}]

  const a = await bol.autocomplete('I want wa', 'en');
  a.sentences     // [{text:'I want water', source:'starter', id:'phrases-0', audio, …}, …]
  a.tiles         // tiles completing the last word: [{id:'core-2', label:'want'}, {label:'water'}, …]

  await bol.speak(['core-0', 'core-2', 'needs-7'], 'hi');                    // plays the 3 tile clips
  await bol.speak(['core-0', 'core-2', 'needs-7'], 'hi', { usePhrase: true }); // plays "मुझे पानी चाहिए"
</script>
```

| Function | Returns |
|---|---|
| `buildSentence(tiles, lang)` | `{lang, text, words, phrase, speech, audio}`. `tiles` is a list of tile ids (`"needs-2"`), alternatives (`"needs-2.alt0"`) or typed words (`{text: "Ravi"}`). Words are joined in the order given, like the app; `phrase` is the matching ready-made sentence or `null` |
| `autocomplete(text, lang, {history, saved, starterPhrases, limit})` | `{sentences, tiles}` ranked like the app's Type tab: starts with the text > a word starts with it > contains it, then said most often, then most recently. `history` is the user's past sentences `[{text, lang, n, last}]`, `saved` their saved phrases (lists of tiles). With `starterPhrases: false` the result is exactly what the app would show |
| `searchTiles({query, lang, category, wordType, limit})` | Tiles matching a word in any language (or one), board or word type |
| `speak(tiles, lang, {usePhrase, voice})` | Plays the audio in a browser. `voice: 'device'` uses the browser's own voice instead, like the app |
| `getTile(id)`, `getCategory(id)`, `categories()`, `languages()` | The JSON above |

Unknown tile ids or languages throw an `Error` that says what is wrong.
`speechPlan` describes what the app would try, in order: the voice for the
language, then the fallback language's voice (only if every word has text in it;
typed words never get another language's voice), then showing the words on screen.

## MCP server

`mcp/server.mjs` offers the same operations to AI assistants through the Model
Context Protocol, plus `speak`, which returns audio. It runs on your own computer
with Node 18+ and no other installs. Setup and tool list: [mcp/README.md](mcp/README.md).

## Using the data: licence

The ARASAAC pictograms are **CC BY-NC-SA 4.0**. You must show the `attribution` text,
you may not use them commercially, and you must share any derivatives under the same
licence. The labels and the rest of the data come from the Bol repository.

## How it is built

The JSON is generated from `data/vocab.json` and `data/languages.json` by
`python3 tools/build_api.py`, and the audio by `python3 tools/build_audio.py`
(needs eSpeak NG and ffmpeg; it only re-speaks words that changed). Both are
committed in `api/v1/`. Don't edit the JSON or audio by hand. `ops.js` and `bol.js`
are written by hand; the rules they use are in `js/core.js`, shared with the app.
The tests (`tests/e2e.mjs`, `tests/mcp.mjs`) fail if `api/` or the audio is out of
date, a symbol or audio file is missing, or the API or MCP server disagrees with the app.
Pushing to `main` publishes changes within a minute or two.

What the API does **not** contain: anything a family adds or records on their phone
(personal buttons, photos, recordings, routines, typing history). Bol keeps that data
only on the device, and it is never uploaded. To personalise autocomplete, the caller
passes its own history to `autocomplete()`; nothing is sent anywhere.

`v1` is in the URL so the format can change later without breaking existing users. A
future `v2` would sit alongside it.
