# Bol tile API

A read-only JSON API for the starter tiles (buttons) of Bol: labels in English,
Hindi, Tamil and Kannada, alternative wordings, word types and colours, emoji and
ARASAAC symbol images.

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

## Using the data: licence

The ARASAAC pictograms are **CC BY-NC-SA 4.0**. You must show the `attribution` text,
you may not use them commercially, and you must share any derivatives under the same
licence. The labels and the rest of the data come from the Bol repository.

## How it is built

The API is generated from `data/vocab.json` and `data/languages.json` by
`python3 tools/build_api.py`, and committed in `api/v1/`. Don't edit `api/` by hand.
The tests (`tests/e2e.mjs`) fail if `api/` is out of date or a symbol URL is broken.
Pushing to `main` publishes changes within a minute or two.

What the API does **not** contain: anything a family adds or records on their phone.
Bol keeps that data only on the device, and it is never uploaded.

`v1` is in the URL so the format can change later without breaking existing users. A
future `v2` would sit alongside it.
