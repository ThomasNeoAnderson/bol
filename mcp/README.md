# Bol MCP server

Lets an AI assistant (Claude Desktop, Claude Code, Cursor, VS Code, or any client
that supports the [Model Context Protocol](https://modelcontextprotocol.io)) look up
Bol's tiles, build sentences from them, autocomplete typed text and speak in English,
Hindi, Tamil and Kannada.

It uses the same data as the public API (`api/v1/`) and the same rules as the app
(`js/core.js`), so its answers match the app. It runs on your own computer and
sends nothing anywhere.

## Requirements

- **Node.js 18 or newer.** Nothing else; there is no `npm install`.
- **Optional: eSpeak NG** (and ffmpeg for MP3 instead of WAV), to speak a whole
  sentence or typed text in one go. Without it, `speak` joins the pre-made per-tile
  clips, and typed text cannot be spoken.
  - Windows: installer from https://github.com/espeak-ng/espeak-ng/releases. If it is
    not on your PATH, set `BOL_ESPEAK` to the full path of `espeak-ng.exe` (see below).
  - macOS: `brew install espeak-ng ffmpeg`
  - Ubuntu/Debian: `sudo apt install espeak-ng ffmpeg`

## Install

```bash
git clone https://github.com/ThomasNeoAnderson/bol.git
node bol/mcp/server.mjs      # optional check: prints one line to stderr and waits; Ctrl+C to stop
```

**Claude Desktop:** Settings → Developer → Edit Config, add to `claude_desktop_config.json`
(use your own full path), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "bol": {
      "command": "node",
      "args": ["C:\\Users\\you\\bol\\mcp\\server.mjs"],
      "env": { "BOL_ESPEAK": "C:\\Program Files\\eSpeak NG\\espeak-ng.exe" }
    }
  }
}
```

(`env` is only needed on Windows when eSpeak NG is not on the PATH.)

**Claude Code:** `claude mcp add bol -- node /full/path/to/bol/mcp/server.mjs`

**Cursor / VS Code / others:** a stdio server with command `node` and argument
`/full/path/to/bol/mcp/server.mjs`.

**MCP Inspector** (to try the tools by hand in a browser):
`npx @modelcontextprotocol/inspector node bol/mcp/server.mjs`

## Tools

| Tool | What it does |
|---|---|
| `list_languages` | Languages, names in their own script, speech voice codes, fallback language |
| `list_categories` | Boards: core, phrases, topics, routines, personal |
| `get_category` | One board's tiles in board order (`lang` for compact labels) |
| `get_tile` | Everything about one tile, including symbol and audio URLs |
| `search_tiles` | Find tiles by word in any language, board or word type |
| `build_sentence` | The sentence the app would show and speak for a list of tiles, each word's symbol and audio, the matching ready-made sentence (natural word order), and the speech plan |
| `autocomplete` | Sentence suggestions and tile completions for typed text, ranked like the app. Pass the user's own `history`/`saved` phrases to personalise |
| `speak` | Audio (MP3, or WAV without ffmpeg) for tiles or typed text. `use_phrase` speaks the ready-made sentence; `save_to` also writes the file |

Tiles are given as ids (`"needs-2"`), alternatives (`"needs-2.alt0"`) or typed
words (`{"text": "Ravi"}`). Use `search_tiles` to find ids.

Example requests to an assistant once it is connected:

- "Using Bol, build the Tamil sentence for I + want + water and say it."
- "What would Bol suggest in Hindi after typing मुझे?"
- "Save the Kannada audio for 'I want to go home' to my Desktop."

## Limitations

- The voice is eSpeak NG: clear but robotic. The app on a phone uses the phone's voice.
- Hindi, Tamil and Kannada labels are unreviewed drafts (see `vocab_review.csv`).
- Words are joined in the order given, like the app, which can be unnatural in Hindi,
  Tamil and Kannada. `build_sentence` returns the ready-made sentence when one matches.
- Personal data from a phone (custom buttons, photos, recordings) is not available:
  Bol never uploads it.
- Some assistants do not play audio returned by a tool. Use `save_to` and open the file.
- Pictograms: ARASAAC, CC BY-NC-SA 4.0. Not for commercial use.

## Tests

```bash
cd tests && npm install && node mcp.mjs
```

12 tests connect to the server with the official MCP SDK client and check every
tool, errors, the older 2024-11-05 protocol, behaviour without eSpeak NG, and that
the returned audio decodes (with ffprobe, when installed).
