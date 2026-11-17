// Tests for the Bol MCP server (mcp/server.mjs), using the official MCP
// TypeScript SDK client, the same library many AI apps use.
//
//   cd tests && npm install && node mcp.mjs
//
// Audio is checked by decoding it with ffprobe when that is installed.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'mcp', 'server.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-mcp-'));
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
async function test(name, fn) {
  try { await fn(); results.push(true); console.log('  ✓', name); }
  catch (e) { results.push(false); console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); }
}
const has = (cmd, flag) => { try { execFileSync(cmd, [flag], { stdio: 'ignore' }); return true; } catch { return false; } };
const FFPROBE = has('ffprobe', '-version');
const ESPEAK = has('espeak-ng', '--version');

/** Decode audio with ffprobe: returns {format, duration} or throws. */
function probe(bytes, ext) {
  const f = path.join(TMP, `p-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  fs.writeFileSync(f, bytes);
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration', '-of', 'json', f], { encoding: 'utf8' });
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { stdio: 'pipe' });    // full decode, throws on errors
  const fmt = JSON.parse(out).format;
  return { format: fmt.format_name, duration: Number(fmt.duration) };
}

async function connect(env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, ...env }, stderr: 'pipe' });
  const client = new Client({ name: 'bol-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const json = r => { assert(!r.isError, 'tool error: ' + (r.content[0] && r.content[0].text)); return JSON.parse(r.content[0].text); };

console.log('Bol MCP server tests' + (ESPEAK ? '' : ' (eSpeak NG not installed: sentence synthesis tests skipped)'));
const c = await connect();

await test('handshake: server info, tools capability, instructions', async () => {
  eq(c.getServerVersion().name, 'bol', 'server name');
  assert(c.getServerCapabilities().tools, 'tools capability');
  assert(/AAC/.test(c.getInstructions() || ''), 'instructions');
});

await test('lists all 8 tools with input schemas', async () => {
  const { tools } = await c.listTools();
  eq(tools.map(t => t.name).sort(), ['autocomplete', 'build_sentence', 'get_category', 'get_tile', 'list_categories', 'list_languages', 'search_tiles', 'speak'], 'tools');
  for (const t of tools) assert(t.inputSchema && t.inputSchema.type === 'object' && t.description.length > 20, 'schema/description for ' + t.name);
});

await test('data tools match the published API files', async () => {
  const api = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'v1', f), 'utf8'));
  eq(json(await c.callTool({ name: 'list_languages', arguments: {} })), api('languages.json'), 'languages');
  eq(json(await c.callTool({ name: 'list_categories', arguments: {} })), api('categories.json'), 'categories');
  eq(json(await c.callTool({ name: 'get_tile', arguments: { id: 'needs-2' } })), api('tiles/needs-2.json'), 'tile');
  eq(json(await c.callTool({ name: 'get_category', arguments: { id: 'food' } })), api('categories/food.json'), 'category');
  const kn = json(await c.callTool({ name: 'get_category', arguments: { id: 'core', lang: 'kn' } }));
  eq(kn.tiles[0].label, 'ನಾನು', 'compact Kannada board');
});

await test('search_tiles finds words in any language and filters', async () => {
  const r = json(await c.callTool({ name: 'search_tiles', arguments: { query: 'தண்ணி' } }));
  assert(r.some(t => t.id === 'needs-7'), 'Tamil "water" found');
  const verbs = json(await c.callTool({ name: 'search_tiles', arguments: { category: 'core', word_type: 'verb', limit: 100 } }));
  assert(verbs.length > 5 && verbs.every(t => t.wordType === 'verb' && t.category === 'core'), 'filters');
});

await test('build_sentence: app order, phrase match, speech plan, typed words', async () => {
  const s = json(await c.callTool({ name: 'build_sentence', arguments: { tiles: ['core-0', 'core-2', 'needs-7'], lang: 'ta' } }));
  eq(s.text, 'நான் வேணும் தண்ணி', 'Tamil sentence, word by word');
  eq(s.phrase.text, 'எனக்கு தண்ணி வேணும்', 'ready-made sentence');
  eq(s.speech[0].voices, ['ta-IN', 'ta'], 'voices');
  eq(s.speech[0].fallback.lang, 'en', 'fallback language');
  const typed = json(await c.callTool({ name: 'build_sentence', arguments: { tiles: [{ text: 'Ravi' }, 'core-12'], lang: 'en' } }));
  assert(typed.text.startsWith('Ravi '), 'typed word kept: ' + typed.text);
  eq(typed.phrase, null, 'no phrase match with typed words');
});

await test('autocomplete: ranking, personal history first when said more, tiles for last word', async () => {
  const r = json(await c.callTool({ name: 'autocomplete', arguments: {
    text: 'I want', lang: 'en', history: [{ text: 'I want my blue car', lang: 'en', n: 4, last: 5 }], limit: 3 } }));
  eq(r.sentences[0].text, 'I want my blue car', 'most-said history first');
  eq(r.sentences[0].source, 'history', 'source');
  assert(r.sentences.slice(1).every(s => s.source === 'starter' && s.audio), 'then starter phrases with audio');
  eq(r.tiles[0].label, 'want', 'tile completion for last word');
  const only = json(await c.callTool({ name: 'autocomplete', arguments: { text: 'I', lang: 'en', starter_phrases: false } }));
  eq(only.sentences, [], 'no history, no starter phrases: nothing (like a new app)');
});

await test('errors are reported as tool errors, not crashes', async () => {
  for (const [name, args, re] of [['get_tile', { id: 'nope' }, /Unknown tile/], ['build_sentence', { tiles: ['nope'], lang: 'en' }, /Unknown tile/],
    ['build_sentence', { tiles: ['core-0'], lang: 'fr' }, /Unknown language/], ['speak', { lang: 'en' }, /empty/]]) {
    const r = await c.callTool({ name, arguments: args });
    assert(r.isError && re.test(r.content[0].text), `${name} error: ${r.content[0].text}`);
  }
  const ok = json(await c.callTool({ name: 'get_tile', arguments: { id: 'core-0' } }));
  eq(ok.id, 'core-0', 'server still works after errors');
});

await test('speak (clips): returns playable MP3 made of the tile clips, and saves it', async () => {
  const out = path.join(TMP, 'clips.mp3');
  const r = await c.callTool({ name: 'speak', arguments: { tiles: ['core-0', 'core-2', 'needs-7'], lang: 'hi', mode: 'clips', save_to: out } });
  const info = json(r);
  eq(r.content[1].type, 'audio', 'audio content block');
  eq(r.content[1].mimeType, 'audio/mpeg', 'mp3');
  const bytes = Buffer.from(r.content[1].data, 'base64');
  eq(bytes.equals(fs.readFileSync(out)), true, 'saved file equals returned audio');
  const clips = ['core-0', 'core-2', 'needs-7'].map(id => fs.readFileSync(path.join(ROOT, 'api', 'v1', 'audio', 'hi', id + '.mp3')));
  eq(bytes.equals(Buffer.concat(clips)), true, 'the three Hindi clips in order');
  eq(info.text, 'मैं चाहिए पानी', 'text');
  if (FFPROBE) { const p = probe(bytes, 'mp3'); assert(p.format === 'mp3' && p.duration > 1.5 && p.duration < 6, 'decodes: ' + JSON.stringify(p)); }
});

await test('speak (phrase): ready-made sentence clip', async () => {
  const r = await c.callTool({ name: 'speak', arguments: { tiles: ['core-0', 'core-2', 'needs-7'], lang: 'kn', use_phrase: true } });
  const bytes = Buffer.from(r.content[1].data, 'base64');
  eq(bytes.equals(fs.readFileSync(path.join(ROOT, 'api', 'v1', 'audio', 'kn', 'phrases-0.mp3'))), true, 'phrases-0 Kannada clip');
  eq(json(r).text, 'ನನಗೆ ನೀರು ಬೇಕು', 'phrase text');
});

if (ESPEAK) await test('speak (eSpeak NG): whole sentence and typed text in all 4 languages decode as audio', async () => {
  for (const lang of ['en', 'hi', 'ta', 'kn']) {
    for (const args of [{ tiles: ['core-0', 'core-2', 'core-19'] }, { text: lang === 'en' ? 'My name is Ravi' : json(await c.callTool({ name: 'get_tile', arguments: { id: 'phrases-5' } })).label[lang] }]) {
      const r = await c.callTool({ name: 'speak', arguments: { ...args, lang } });
      const info = json(r);
      assert(/eSpeak/.test(info.voice), 'used eSpeak: ' + info.voice);
      const bytes = Buffer.from(r.content[1].data, 'base64');
      if (FFPROBE) { const p = probe(bytes, info.mimeType === 'audio/mpeg' ? 'mp3' : 'wav'); assert(p.duration > 0.5 && p.duration < 10, `${lang} decodes: ${JSON.stringify(p)}`); }
    }
  }
});

await c.close();

await test('without eSpeak NG: tiles still speak from clips; typed text gives a clear error', async () => {
  const noEspeak = await connect({ BOL_ESPEAK: 'off' });
  try {
    assert(/NOT found/.test(noEspeak.getInstructions()), 'instructions say eSpeak is missing');
    const r = await noEspeak.callTool({ name: 'speak', arguments: { tiles: ['core-0', 'core-2'], lang: 'ta' } });
    assert(!r.isError && /pre-made clips/.test(json(r).voice), 'clips used: ' + r.content[0].text);
    const t = await noEspeak.callTool({ name: 'speak', arguments: { text: 'hello', lang: 'en' } });
    assert(t.isError && /eSpeak NG/.test(t.content[0].text), 'clear error: ' + t.content[0].text);
  } finally { await noEspeak.close(); }
});

await test('older clients (protocol 2024-11-05) get audio as an embedded resource', async () => {
  const p = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = [];
  let buf = '';
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = m => p.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'old', version: '0' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'speak', arguments: { tiles: ['core-0'], lang: 'en', mode: 'clips' } } });
  send({ jsonrpc: '2.0', id: 3, method: 'no/such' });
  p.stdin.write('not json\n');
  for (let i = 0; i < 50 && lines.length < 4; i++) await new Promise(r => setTimeout(r, 100));
  p.kill();
  eq(lines[0].result.protocolVersion, '2024-11-05', 'negotiated old version');
  eq(lines[1].result.content[1].type, 'resource', 'resource block');
  assert(lines[1].result.content[1].resource.blob.length > 1000, 'audio blob');
  eq(lines[2].error.code, -32601, 'unknown method');
  eq(lines[3].error.code, -32700, 'parse error');
});

fs.rmSync(TMP, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
