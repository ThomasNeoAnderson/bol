#!/usr/bin/env python3
"""Download ARASAAC pictograms for the starter buttons, once, into symbols/.

    pip install pillow
    python3 tools/fetch_symbols.py          # only buttons without a symbol
    python3 tools/fetch_symbols.py --all    # re-fetch everything
    python3 tools/build_sw.py               # then refresh the offline cache list

The app never contacts ARASAAC at run time: the images are stored in the repo
and cached by the service worker. Search words come from the button's English
label, or from tools/symbol_keywords.json where a better word (or a pinned
pictogram id, after review) is given. Writes symbol_review.md for checking.

Pictograms: Sergio Palao, property of the Government of Aragón, from ARASAAC
(https://arasaac.org), licence CC BY-NC-SA 4.0 (non-commercial, share-alike).
"""
import io, json, pathlib, sys, time, urllib.parse, urllib.request
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
VOCAB = ROOT / 'data' / 'vocab.json'
OUT = ROOT / 'symbols'
KEYWORDS = json.loads((ROOT / 'tools' / 'symbol_keywords.json').read_text(encoding='utf-8'))
API = 'https://api.arasaac.org/v1/pictograms/en'
IMG = 'https://static.arasaac.org/pictograms/{id}/{id}_300.png'
SIZE = 192
SKIP_CATS = {'phrases'}            # whole sentences keep their emoji

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Bol-AAC symbol fetcher (offline app)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def search(word):
    """ARASAAC 'bestsearch' first, then the broader 'search'. Skips pictograms
    flagged as violent or sexual."""
    for kind in ('bestsearch', 'search'):
        try:
            res = json.loads(get(f'{API}/{kind}/{urllib.parse.quote(word)}'))
        except Exception:
            continue
        res = [p for p in res if not p.get('violence') and not p.get('sex')]
        if res:
            return res[0]['_id'], kind
    return None, None

def main():
    vocab = json.loads(VOCAB.read_text(encoding='utf-8'))
    OUT.mkdir(exist_ok=True)
    rows, everything = [], '--all' in sys.argv
    for b in vocab['buttons']:
        if b['cat'] in SKIP_CATS:
            continue
        kw = KEYWORDS.get(b['id'], b['text']['en'])
        file = OUT / f"{b['id']}.webp"
        if kw is None:                       # reviewed: no good pictogram, keep emoji
            b['sym'] = None; b.pop('symId', None)
            if file.exists(): file.unlink()
            rows.append((b, '—', None, 'emoji kept (no good match)'))
            continue
        pinned = kw.get('id') if isinstance(kw, dict) else None
        word = '(pinned after review)' if pinned else kw
        if b.get('sym') and file.exists() and not everything:
            rows.append((b, word, b.get('symId'), 'kept'))
            continue
        pid, how = (pinned, 'pinned') if pinned else search(kw)
        if not pid:
            b['sym'] = None; b.pop('symId', None)
            rows.append((b, word, None, 'NOT FOUND - emoji kept'))
            continue
        try:
            img = Image.open(io.BytesIO(get(IMG.format(id=pid)))).convert('RGBA')
            img.thumbnail((SIZE, SIZE), Image.LANCZOS)
            img.save(file, 'WEBP', quality=82, method=6)
            b['sym'] = f"symbols/{b['id']}.webp"
            b['symId'] = pid
            rows.append((b, word, pid, how))
        except Exception as e:
            rows.append((b, word, pid, f'download failed: {e}'))
        time.sleep(0.15)    # be polite to the free service
    VOCAB.write_text(json.dumps(vocab, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    # Review file: one row per button, with a link to the pictogram.
    lines = ['# Symbol review', '',
             'Every starter button and the ARASAAC pictogram chosen for it. Look for bad matches;',
             'to fix one, find a better pictogram on https://arasaac.org, put its number in',
             '`tools/symbol_keywords.json` as `"<button id>": {"id": <number>}` (or a better search',
             'word), then run `python3 tools/fetch_symbols.py --all` and `python3 tools/build_sw.py`.', '',
             'Pictograms: Sergio Palao. Property of the Government of Aragón. ARASAAC (https://arasaac.org).',
             'Licence CC BY-NC-SA 4.0.', '',
             '| Button id | Board | English | Hindi | Search word | ARASAAC id | Picture | Status |',
             '|---|---|---|---|---|---|---|---|']
    for b, word, pid, how in rows:
        pic = f"![{b['text']['en']}](symbols/{b['id']}.webp)" if b.get('sym') else '—'
        link = f'[{pid}](https://arasaac.org/pictograms/en/{pid})' if pid else '—'
        lines.append(f"| {b['id']} | {b['cat']} | {b['text']['en']} | {b['text'].get('hi', '')} | {word} | {link} | {pic} | {how} |")
    (ROOT / 'symbol_review.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    found = sum(1 for r in rows if r[2])
    print(f'{found}/{len(rows)} buttons have a symbol; see symbol_review.md')

main()
