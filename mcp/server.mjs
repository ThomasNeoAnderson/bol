#!/usr/bin/env node
// Bol MCP server: lets an AI assistant (Claude Desktop, Claude Code, Cursor,
// VS Code…) use Bol's tiles, build sentences, autocomplete and speak.
//
//   node mcp/server.mjs            (run from a clone of the repository)
//
// Needs Node 18+ and nothing else: no npm install. It talks MCP over stdio
// (JSON-RPC 2.0, one message per line) and reads the same files the public
// API serves (api/v1/), with the app's own rules (js/core.js via ops.js), so
// its answers match the app and the API. Speaking a whole sentence or typed
// text in one go also needs eSpeak NG on this computer; without it, tiles are
// spoken from the pre-made clips. Setup: mcp/README.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ops from '../api/v1/ops.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'api', 'v1');
const SITE = 'https://thomasneoanderson.github.io/bol/';
const SERVER = { name: 'bol', title: 'Bol AAC', version: '1.0.0' };
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
let protocol = VERSIONS[0];

const readJSON = f => JSON.parse(fs.readFileSync(path.join(API_DIR, f), 'utf8'));
const data = ops.prepare({ tiles: readJSON('tiles.json'), languages: readJSON('languages.json') });
const categories = readJSON('categories.json');
const espeakVoices = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'languages.json'), 'utf8')).map(l => [l.code, l.espeakVoice]));

// ------------------------------------------------------------ speech ---

function has(cmd, flag) {
  try { execFileSync(cmd, [flag], { stdio: 'ignore' }); return true; } catch { return false; }
}
// BOL_ESPEAK=off turns sentence synthesis off; BOL_ESPEAK=/path/espeak-ng picks a program.
const ESPEAK = process.env.BOL_ESPEAK === 'off' ? null : process.env.BOL_ESPEAK || (has('espeak-ng', '--version') ? 'espeak-ng' : null);
const FFMPEG = process.env.BOL_FFMPEG || (has('ffmpeg', '-version') ? 'ffmpeg' : null);

/** Local file for a published clip URL (the clips ship with the repository). */
const clipFile = url => path.join(ROOT, url.replace(SITE, '').split('/').join(path.sep));

/** Speak text with eSpeak NG (same voice and speed as the pre-made clips). */
function synthesize(text, lang) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-'));
  try {
    const wav = path.join(tmp, 'a.wav');
    execFileSync(ESPEAK, ['-v', espeakVoices[lang], '-s', '140', '-w', wav, text], { stdio: 'ignore' });
    if (!FFMPEG) return { bytes: fs.readFileSync(wav), mimeType: 'audio/wav', ext: 'wav' };
    const mp3 = path.join(tmp, 'a.mp3');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '22050', '-b:a', '40k', mp3], { stdio: 'ignore' });
    return { bytes: fs.readFileSync(mp3), mimeType: 'audio/mpeg', ext: 'mp3' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** MP3 clips can be joined by appending their bytes (frames play in order). */
const joinClips = urls => ({ bytes: Buffer.concat(urls.map(u => fs.readFileSync(clipFile(u)))), mimeType: 'audio/mpeg', ext: 'mp3' });

function speak({ tiles, text, lang, use_phrase = false, mode = 'auto', save_to }) {
  if (!lang) throw new Error('lang is required');
  let audio, how, said;
  if (text != null) {
    if (tiles) throw new Error('Give either tiles or text, not both');
    if (!ESPEAK) throw new Error('Speaking typed text needs eSpeak NG on this computer (see mcp/README.md). Tiles can be spoken without it.');
    ops.buildSentence([], lang, data);                        // checks the language
    said = String(text).trim();
    if (!said) throw new Error('text is empty');
    audio = synthesize(said, lang); how = 'eSpeak NG, whole text';
  } else {
    const s = ops.buildSentence(tiles || [], lang, data);
    if (!s.words.length) throw new Error('tiles is empty');
    if (use_phrase && s.phrase) {
      audio = joinClips([s.phrase.audio]); said = s.phrase.text; how = `pre-made clip of ready-made sentence ${s.phrase.id}`;
    } else if (mode !== 'clips' && ESPEAK) {
      said = s.text; audio = synthesize(said, lang); how = 'eSpeak NG, whole sentence as one utterance (like the app)';
    } else {
      if (s.audio.some(u => !u)) throw new Error('Typed words have no pre-made clip; install eSpeak NG to speak them (see mcp/README.md)');
      said = s.text; audio = joinClips(s.audio); how = `${s.audio.length} pre-made clips, one per tile`;
    }
  }
  let saved = null;
  if (save_to) {
    saved = path.resolve(save_to.endsWith(path.sep) || (fs.existsSync(save_to) && fs.statSync(save_to).isDirectory())
      ? path.join(save_to, `bol-${lang}-${Date.now()}.${audio.ext}`) : save_to);
    fs.writeFileSync(saved, audio.bytes);
  }
  return { audio, info: { lang, text: said, voice: how, mimeType: audio.mimeType, bytes: audio.bytes.length, savedTo: saved } };
}

// ------------------------------------------------------------- tools ---

const tileRef = {
  description: 'A tile id such as "needs-2", an alternative such as "needs-2.alt0", or a typed word {"text": "Ravi"}',
  anyOf: [{ type: 'string' }, { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }],
};
const langProp = { type: 'string', enum: data.langCodes, description: 'Language: en English, hi Hindi, ta Tamil, kn Kannada' };
const readOnly = { readOnlyHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'list_languages', title: 'List languages',
    description: 'Languages Bol supports, with names in their own script, speech voice codes and the fallback language used when a voice is missing.',
    inputSchema: { type: 'object', properties: {} }, annotations: readOnly,
    run: () => data.languages,
  },
  {
    name: 'list_categories', title: 'List boards',
    description: 'Bol boards (categories): core words, phrases, topic boards (food, feelings…), routines and personal boards, with tile counts.',
    inputSchema: { type: 'object', properties: {} }, annotations: readOnly,
    run: () => categories,
  },
  {
    name: 'get_category', title: 'Get a board',
    description: 'All tiles on one board in board order (positions never move). Give lang to get compact labels in one language.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', enum: categories.map(c => c.id) }, lang: langProp }, required: ['id'] },
    annotations: readOnly,
    run: ({ id, lang }) => {
      const cat = readJSON(`categories/${id}.json`);
      if (!lang) return cat;
      return { id, label: ops.labelOf(cat, lang), tiles: cat.tiles.map(t => ({ id: t.id, slot: t.slot, label: ops.labelOf(t, lang), wordType: t.wordType, emoji: t.emoji })) };
    },
  },
  {
    name: 'get_tile', title: 'Get a tile',
    description: 'Everything about one tile: labels in all languages, alternatives, word type and colour, symbol image and audio URLs.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: readOnly,
    run: ({ id }) => { const t = data.byId.get(id); if (!t) throw new Error(`Unknown tile id: ${id}`); return t; },
  },
  {
    name: 'search_tiles', title: 'Search tiles',
    description: 'Find tiles by word (in any language, including alternatives), board or word type. Use it to turn words into tile ids.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string' }, lang: langProp, category: { type: 'string' },
      word_type: { type: 'string', enum: ['person', 'verb', 'describe', 'noun', 'social', 'question', 'little'] },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } } },
    annotations: readOnly,
    run: a => ops.searchTiles(data, { query: a.query, lang: a.lang, category: a.category, wordType: a.word_type, limit: a.limit }),
  },
  {
    name: 'build_sentence', title: 'Build a sentence from tiles',
    description: 'Build the sentence the Bol app would show and speak for these tiles, in order. Returns the text, each word with symbol and audio, '
      + 'a ready-made sentence with natural word order when one matches ("phrase"), and the speech plan (voice codes and fallback language).',
    inputSchema: { type: 'object', properties: { tiles: { type: 'array', items: tileRef, minItems: 1 }, lang: langProp }, required: ['tiles', 'lang'] },
    annotations: readOnly,
    run: ({ tiles, lang }) => ops.buildSentence(tiles, lang, data),
  },
  {
    name: 'autocomplete', title: 'Autocomplete',
    description: 'Suggestions for partly typed text, ranked like the app\'s Type tab (starts with > word starts with > contains, then most often, then most recent). '
      + 'Returns whole sentences and tiles completing the last word. Pass the user\'s own history/saved phrases to personalise; '
      + 'set starter_phrases false to get exactly what the app would suggest.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string' }, lang: langProp,
      history: { type: 'array', description: 'Past sentences', items: { type: 'object', properties: {
        text: { type: 'string' }, lang: { type: 'string' }, n: { type: 'integer', description: 'times said' }, last: { type: 'number', description: 'last said, ms since 1970' } }, required: ['text', 'lang'] } },
      saved: { type: 'array', description: 'Saved phrases, each a list of tiles', items: { type: 'array', items: tileRef } },
      starter_phrases: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 8 } }, required: ['text', 'lang'] },
    annotations: readOnly,
    run: a => ops.autocomplete(a.text, a.lang, data, {
      history: (a.history || []).map(e => ({ n: 1, last: 0, ...e })), saved: a.saved || [],
      starterPhrases: a.starter_phrases !== false, limit: a.limit }),
  },
  {
    name: 'speak', title: 'Speak',
    description: 'Synthesise speech for tiles (or typed text) in a language and return the audio (MP3, or WAV without ffmpeg). '
      + 'Tiles are spoken as one sentence with eSpeak NG if installed, otherwise by joining the pre-made per-tile clips. '
      + 'use_phrase speaks the matching ready-made sentence instead. save_to writes the audio to a file or folder. Robotic open-source voice.',
    inputSchema: { type: 'object', properties: {
      tiles: { type: 'array', items: tileRef }, text: { type: 'string', description: 'Typed text instead of tiles (needs eSpeak NG)' },
      lang: langProp, use_phrase: { type: 'boolean', default: false },
      mode: { type: 'string', enum: ['auto', 'clips'], default: 'auto', description: 'clips: always use the pre-made clips' },
      save_to: { type: 'string', description: 'File or folder path on this computer' } }, required: ['lang'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    audio: true,
    run: speak,
  },
];

// ---------------------------------------------------------- protocol ---

function toolResult(tool, args) {
  try {
    const out = tool.run(args || {});
    if (!tool.audio) {
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], ...(protocol >= '2025-06-18' ? { structuredContent: Array.isArray(out) ? { items: out } : out } : {}) };
    }
    const b64 = out.audio.bytes.toString('base64');
    const audioBlock = protocol >= '2025-03-26'
      ? { type: 'audio', data: b64, mimeType: out.audio.mimeType }
      : { type: 'resource', resource: { uri: `bol://audio/${out.info.lang}.${out.audio.ext}`, mimeType: out.audio.mimeType, blob: b64 } };
    return { content: [{ type: 'text', text: JSON.stringify(out.info, null, 1) }, audioBlock] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e.message }] };
  }
}

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      protocol = VERSIONS.includes(params && params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      return {
        protocolVersion: protocol,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: 'Bol is a picture-to-speech (AAC) board for non-speaking children in English, Hindi, Tamil and Kannada. '
          + 'Use search_tiles to find tile ids, build_sentence to make a sentence from tiles, autocomplete for typed text and speak for audio. '
          + `Hindi, Tamil and Kannada labels are unreviewed drafts. Pictograms: ARASAAC, CC BY-NC-SA 4.0 (non-commercial). eSpeak NG ${ESPEAK ? 'found' : 'NOT found: speak uses pre-made tile clips only'}.`,
      };
    case 'ping': return {};
    case 'tools/list':
      return { tools: TOOLS.map(({ run, audio, ...t }) => (protocol >= '2025-06-18' ? t : { name: t.name, description: t.description, inputSchema: t.inputSchema })) };
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === (params && params.name));
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${params && params.name}`), { code: -32602 });
      return toolResult(tool, params.arguments);
    }
    default:
      if (id === undefined) return undefined;              // notification
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (msg.id === undefined || msg.method === undefined) continue;   // notifications and responses
    try {
      send({ jsonrpc: '2.0', id: msg.id, result: handle(msg) });
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
// Logs go to stderr: stdout is reserved for MCP messages.
console.error(`Bol MCP server ${SERVER.version}: ${data.tiles.length} tiles, languages ${data.langCodes.join(', ')}, eSpeak NG ${ESPEAK ? 'found' : 'not found'}`);
