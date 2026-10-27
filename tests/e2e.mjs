// End-to-end tests for Bol, run in headless Chromium.
//
//   cd tests && npm install && node e2e.mjs
//   (set CHROME_PATH to use a specific Chromium build)
//
// The test starts its own static server for the repo, so nothing else is
// needed. Headless Chromium has NO speech voices, which is useful: it proves
// the "never fail silently" fallbacks work.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------ test server ---
let swSuffix = '';            // appended to sw.js to simulate a new release
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>blank</title>'); }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (url === '/sw.js' && swSuffix) body = Buffer.concat([body, Buffer.from(swSuffix)]);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

// -------------------------------------------------------------- framework ---
const results = [];
async function test(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await fn({ page, ctx, errors });
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
    results.push([true, name]); console.log('  ✓', name);
  } catch (e) {
    results.push([false, name, e.message]); console.log('  ✗', name, '\n     ', e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(OUT, `fail-${results.length}.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/** Open the app fresh and pick a language on the first-run screen. */
async function open(page, lang = 'en') {
  await page.goto(BASE + '/');
  await page.waitForSelector('.lang-btn');
  await page.click(`.lang-btn[lang=${lang}]`);
  await page.waitForSelector('#grid .sym');
}
const gridLabels = page => page.$$eval('#grid .sym:not(.empty)', els => els.map(e => e.getAttribute('aria-label')));
const status = page => page.textContent('#status .status-text').catch(() => '');
async function enterCaregiver(page, pin = '1234', create = true) {
  await page.click('#cg-toggle');
  for (const d of create ? pin + pin : pin) await page.click(`.pin-key:text-is("${d}")`);
  await page.waitForSelector('#cg-tools:not([hidden])');
}
async function seedV1(page) {
  const v1 = JSON.parse(fs.readFileSync(path.join(FIX, 'v1-profile.json'), 'utf8'));
  await page.goto(BASE + '/__blank');
  await page.evaluate(p => new Promise((res, rej) => {
    const r = indexedDB.open('bol', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('media', { keyPath: 'id' }); };
    r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(p, 'profile'); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = rej; };
    r.onerror = rej;
  }), v1);
}

console.log('Bol end-to-end tests');

// ------------------------------------------------------------- PHASE 1 ---
await test('first run asks for language; Core board is home with fixed core words', async ({ page }) => {
  await open(page);
  assert(await page.isVisible('.tab.active.home'), 'Core tab should be active');
  const labels = await gridLabels(page);
  assert(labels.length >= 30, 'expected ~30+ core words, got ' + labels.length);
  eq(labels.slice(0, 6), ['I', 'you', 'want', "don't want", 'yes', 'no'], 'first row of core words');
  for (const w of ['like', 'more', 'again', 'stop', 'go', 'come', 'help', 'look', 'give', 'open', 'eat', 'drink',
    'play', 'finished', 'this', 'that', 'here', 'there', 'in', 'on', 'up', 'down', 'good', 'bad', 'mine', 'what', 'where', 'please', 'thank you'])
    assert(labels.includes(w), 'missing core word ' + w);
});

await test('buttons are coloured by word type (verbs green, people yellow…) and can be switched', async ({ page }) => {
  await open(page);
  const col = l => page.$eval(`.sym[aria-label="${l}"]`, e => e.style.getPropertyValue('--cat'));
  eq(await col('want'), '#8fd18f', 'verb colour');
  eq(await col('I'), '#ffe066', 'pronoun colour');
  eq(await col('good'), '#8cc4ff', 'describing colour');
  eq(await col('please'), '#ff9ec7', 'social colour');
  await enterCaregiver(page);
  await page.click('#cg-settings');
  await page.selectOption('select:has(option[value=wordtype])', 'category');
  await page.click('.modal.full .modal-head .icon-btn');
  eq(await col('want'), '#2a6f97', 'category colour after switching');
});

await test('Phrases tab has ~30 whole sentences; Core stays one tap away', async ({ page }) => {
  await open(page);
  await page.click('.tab:has-text("Phrases")');
  const labels = await gridLabels(page);
  assert(labels.length >= 30, 'expected ~30 phrases, got ' + labels.length);
  await page.click('.sym[aria-label="I want water"]');
  assert((await page.textContent('#sentence')).includes('I want water'), 'phrase added to sentence');
  await page.click('.tab:has-text("Food")');
  assert((await gridLabels(page)).includes('idli'), 'topic board reachable in one tap');
  await page.click('.tab.home');
  eq((await gridLabels(page))[0], 'I', 'back to Core in one tap');
});

await test('no voice: visible warning on tap, full-screen words on Speak (never silent)', async ({ page }) => {
  await open(page);
  await page.click('.sym[aria-label="want"]');
  await page.click('.sym[aria-label="drink"]');
  await page.waitForSelector('#status.warn', { timeout: 15000 });
  assert(!(await page.isVisible('#show-card')), 'card must not block tapping');
  await page.click('#btn-speak');
  await page.waitForSelector('#show-card:not([hidden])', { timeout: 15000 });
  assert((await page.textContent('#show-card')).includes('drink'), 'card shows the words');
});

await test('unfinished sentence survives a reload (force-close)', async ({ page }) => {
  await open(page);
  await page.click('.sym[aria-label="want"]');
  await page.click('.sym[aria-label="more"]');
  await page.reload();
  await page.waitForSelector('#grid .sym');
  const s = await page.textContent('#sentence');
  assert(s.includes('want') && s.includes('more'), 'draft restored: ' + s);
});

await test('long-press shows other ways to say it; ★ saves to My phrases', async ({ page }) => {
  await open(page);
  await page.click('.tab:has-text("Needs")');
  const box = await page.locator('.sym[aria-label="water"]').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await page.click('.modal .btn.big:has-text("thirsty")');
  await page.click('#btn-save');
  assert((await page.textContent('#phrases')).includes("I'm thirsty"), 'phrase saved');
});

await test('caregiver adds a photo button into the next empty slot; nothing moves', async ({ page }) => {
  await open(page);
  const before = await gridLabels(page);
  await enterCaregiver(page);
  await page.click('#cg-add');
  await page.setInputFiles('.editor input[type=file]:not([capture])', path.join(ROOT, 'icons', 'icon-512.png'));
  await page.waitForSelector('text=✓');
  await page.fill('.editor input[lang=en]', 'chai');
  await page.click('.modal-actions .btn.primary');
  assert(/chai.*\d+/.test(await status(page)), 'timing toast shown');
  const after = await gridLabels(page);
  eq(after.slice(0, before.length), before, 'existing buttons unchanged');
  eq(after[before.length], 'chai', 'new button in next slot');
});

await test('a broken image file shows an error and never freezes the editor', async ({ page }) => {
  await open(page);
  await enterCaregiver(page);
  await page.click('#cg-add');
  const bad = path.join(OUT, 'bad.png'); fs.writeFileSync(bad, 'not an image');
  await page.setInputFiles('.editor input[type=file]:not([capture])', bad);
  await page.waitForSelector('.editor .hint:has-text("⚠️")', { timeout: 20000 });
  await page.fill('.editor input[lang=en]', 'swing');
  await page.click('.modal-actions .btn.primary');
  assert((await status(page)).includes('swing'), 'saved without photo');
});

await test('export on one device, import on another (with summary), then works offline', async ({ page }) => {
  await open(page);
  await page.click('.sym[aria-label="want"]'); await page.click('#btn-save');
  await enterCaregiver(page);
  await page.click('#cg-settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.btn:has-text("Download backup")')]);
  const file = path.join(OUT, 'backup.bol.json'); await dl.saveAs(file);
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await open(p2);
  await enterCaregiver(p2, '9999');
  await p2.click('#cg-settings');
  await p2.setInputFiles('.settings input[type=file]', file);
  await p2.click('.modal-actions .btn:has-text("Import")');
  await p2.waitForSelector('text=Import complete');
  assert((await p2.textContent('.modal-body')).includes('saved phrases'), 'summary shown');
  await p2.click('.modal-actions .btn:has-text("OK")');
  assert((await p2.textContent('#phrases')).includes('want'), 'phrase came across');
  await p2.evaluate(() => navigator.serviceWorker.ready);
  await p2.reload(); await p2.waitForSelector('#grid .sym');
  await ctx2.setOffline(true);
  await p2.reload(); await p2.waitForSelector('#grid .sym', { timeout: 8000 });
  await ctx2.close();
});

await test('one-tap "Restore last working version"', async ({ page }) => {
  await open(page);
  await enterCaregiver(page);
  await page.click('#cg-settings');
  await page.click('.settings .btn.danger:has-text("Reset")');
  await page.click('.modal-actions .btn.danger');
  await page.click('#cg-settings');
  await page.click('.settings .btn.primary:has-text("Restore last working version")');
  assert(/Restored/.test(await status(page)), 'restore reported');
});

await test('upgrade from Bol v1 keeps everything and snapshots first', async ({ page }) => {
  await seedV1(page);
  await page.goto(BASE + '/');
  await page.waitForSelector('#grid .sym');
  assert(!(await page.isVisible('.lang-btn')), 'v1 users are not asked for a language again');
  const st = await status(page);
  assert(/अपडेट|updated/.test(st), 'upgrade message: ' + st);
  const p = await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open('bol', 1);
    r.onsuccess = () => {
      const t = r.result.transaction('kv'); const s = t.objectStore('kv');
      const a = s.get('profile'), b = s.get('snapshots');
      t.oncomplete = () => res({ profile: a.result, snaps: b.result });
    };
  }));
  eq(p.profile.schema, 2, 'schema');
  eq(p.profile.settings.lang, 'hi', 'language kept');
  eq(p.profile.settings.pin, '2468', 'PIN kept');
  eq(p.profile.settings.theme, 'calm', 'theme kept');
  const b = id => p.profile.buttons.find(x => x.id === id);
  eq(b('b-custom1').slot, 10, 'custom button kept its slot');
  eq(b('b-custom1').img, 'i-fake-photo', 'photo reference kept');
  eq(b('b-custom1').audio, 'a-fake-rec', 'recording reference kept');
  eq(b('needs-7').text.hi, 'जल', 'caregiver edit not overwritten');
  eq(b('needs-6').text.hi, 'टॉयलेट', 'untouched starter word refreshed');
  assert(b('food-10').slot !== 10, 'new starter word placed in an empty slot');
  assert(p.profile.categories[0].id === 'core', 'Core board added first');
  eq(p.profile.phrases[0].items[0].text.hi, 'जल', 'saved phrase converted');
  assert(p.snaps.some(s => s.reason === 'before-upgrade' && (s.profile.schema || 1) === 1), 'v1 snapshot taken before upgrade');
});

await test('"Update available – tap to reload" appears for a new version', async ({ page }) => {
  swSuffix = '';
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('#grid .sym');
  swSuffix = '\n// new release ' + Date.now();
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForSelector('#status.update', { timeout: 15000 });
  await Promise.all([page.waitForEvent('load'), page.click('#status.update .btn.small:not(.icon-btn)')]);
  await page.waitForSelector('#grid .sym');
  swSuffix = '';
});

await test('Hindi: language picker switches labels, interface and lang attribute', async ({ page }) => {
  await open(page, 'hi');
  eq(await page.getAttribute('html', 'lang'), 'hi', 'html lang');
  assert((await gridLabels(page)).includes('चाहिए'), 'Hindi core word');
  assert((await page.textContent('#btn-speak')).includes('बोलो'), 'Hindi interface');
});

// ---------------------------------------------------------------- summary ---
await browser.close();
server.close();
const failed = results.filter(r => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
