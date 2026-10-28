#!/usr/bin/env python3
"""Generate the read-only tile API in api/v1/ from data/vocab.json.

Run after changing the vocabulary:   python3 tools/build_api.py
Check without writing (for tests):  python3 tools/build_api.py --check

GitHub Pages has no server code, so the "API" is a set of static JSON files
served at fixed URLs (see API.md). data/vocab.json stays the source of truth;
never edit api/ by hand. The app itself does not use these files, so they are
not in the service worker's offline cache.
"""
import json, pathlib, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'api' / 'v1'
SITE = 'https://thomasneoanderson.github.io/bol/'
API = SITE + 'api/v1/'
ATTRIBUTION = ('Pictograms: Sergio Palao. Origin: ARASAAC (https://arasaac.org). '
               'Licence: CC BY-NC-SA 4.0. Owner: Government of Aragón (Spain).')


def load(name):
    return json.loads((ROOT / 'data' / name).read_text(encoding='utf-8'))


def tile(b, vocab, langs):
    """One button as an API tile: plain field names and absolute URLs."""
    wt = vocab['wordTypes'].get(b.get('pos') or '')
    sym = b.get('sym')
    return {
        'id': b['id'],
        'category': b['cat'],
        'slot': b['slot'],
        'label': b['text'],
        'alternatives': [a['text'] for a in b.get('alts', [])],
        'wordType': b.get('pos'),
        'color': wt['color'] if wt else None,
        'emoji': b['emoji'],
        'symbol': {
            'url': SITE + sym,
            'arasaacId': b.get('symId'),
            'attribution': ATTRIBUTION,
        } if sym else None,
        # English is the source; every other language is a draft until a
        # native speaker marks the row reviewed in vocab_review.csv.
        'reviewed': {l: (l == 'en' or b['id'] in set(vocab.get('reviewed', []))) for l in langs},
        'url': API + f"tiles/{b['id']}.json",
    }


def build():
    """Return {relative path: data} for every API file."""
    vocab, languages = load('vocab.json'), load('languages.json')
    langs = [l['code'] for l in languages]
    tiles = [tile(b, vocab, langs) for b in vocab['buttons']]
    by_cat = {}
    for t in tiles:
        by_cat.setdefault(t['category'], []).append(t)
    for ts in by_cat.values():
        ts.sort(key=lambda t: t['slot'])

    cats = [{
        'id': c['id'],
        'kind': c['kind'],          # core | phrases | topic | routine | personal (empty, filled by caregivers)
        'label': c['text'],
        'emoji': c['emoji'],
        'color': c['color'],
        'tileCount': len(by_cat.get(c['id'], [])),
        'url': API + f"categories/{c['id']}.json",
    } for c in vocab['categories']]

    files = {
        'index.json': {
            'name': 'Bol tile API',
            'version': 1,
            'vocabularyVersion': vocab['version'],
            'description': 'Read-only starter vocabulary of the Bol AAC app. Static JSON on GitHub Pages; no key needed.',
            'docs': 'https://github.com/ThomasNeoAnderson/bol/blob/main/API.md',
            'languages': langs,
            'counts': {'tiles': len(tiles), 'categories': len(cats)},
            'endpoints': {
                'languages': API + 'languages.json',
                'wordTypes': API + 'word-types.json',
                'categories': API + 'categories.json',
                'category': API + 'categories/{id}.json',
                'tiles': API + 'tiles.json',
                'tile': API + 'tiles/{id}.json',
            },
            'symbolAttribution': ATTRIBUTION,
        },
        'languages.json': [{k: l[k] for k in ('code', 'name', 'englishName', 'speech', 'fallback')} for l in languages],
        'word-types.json': [{'id': k, 'label': w['text'], 'color': w['color']} for k, w in vocab['wordTypes'].items()],
        'categories.json': cats,
        'tiles.json': tiles,
    }
    for c in cats:
        files[f"categories/{c['id']}.json"] = {**c, 'tiles': by_cat.get(c['id'], [])}
    for t in tiles:
        files[f"tiles/{t['id']}.json"] = t
    return {p: json.dumps(d, ensure_ascii=False, indent=1) + '\n' for p, d in files.items()}


def main():
    files = build()
    if '--check' in sys.argv:
        on_disk = {p.relative_to(OUT).as_posix() for p in OUT.rglob('*.json')} if OUT.exists() else set()
        stale = [p for p, s in files.items() if not (OUT / p).exists() or (OUT / p).read_text(encoding='utf-8') != s]
        extra = sorted(on_disk - set(files))
        if stale or extra:
            print('api/ is out of date: run python3 tools/build_api.py', (stale + extra)[:5]); sys.exit(1)
        print(f'api/ up to date: {len(files)} files'); return
    if OUT.exists():
        shutil.rmtree(OUT)            # removes tiles that no longer exist
    for p, s in files.items():
        f = OUT / p
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(s, encoding='utf-8')
    print(f'Wrote {len(files)} files to api/v1/')


main()
