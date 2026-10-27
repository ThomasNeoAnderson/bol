#!/usr/bin/env python3
"""Load corrections from vocab_review.csv back into data/vocab.json and data/ui.json.

    python3 tools/import_review.py [path/to/vocab_review.csv]
    python3 tools/build_sw.py          # then bump the offline cache version

Only non-empty cells are applied, so a reviewer can leave cells blank. Rows
marked reviewed = yes are recorded. Existing users get the corrections on their
next app start (starter buttons a caregiver edited by hand are never changed).
"""
import csv, sys, pathlib
from review_common import load, save, text_objects, CSV, LANG_COLS

path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else CSV
vocab, ui = load()
targets = dict(text_objects(vocab, ui))     # row id -> the live dict inside vocab/ui
reviewed, changed, unknown = [], 0, []

with open(path, newline='', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        rid = (row.get('id') or '').strip()
        if not rid:
            continue
        if rid not in targets:
            unknown.append(rid)
            continue
        t = targets[rid]
        for col, code in LANG_COLS.items():
            val = (row.get(col) or '').strip()
            if val and t.get(code) != val:
                t[code] = val
                changed += 1
        if (row.get('reviewed') or '').strip().lower() in ('yes', 'y', 'true', '1', 'हाँ', 'ஆம்', 'ಹೌದು'):
            reviewed.append(rid)

vocab['reviewed'] = sorted(set(reviewed))
save(vocab, ui)
print(f'Applied {changed} changed cells; {len(reviewed)} rows marked reviewed.')
if unknown:
    print('Ignored unknown ids:', ', '.join(unknown[:20]), '…' if len(unknown) > 20 else '')
print('Now run: python3 tools/build_sw.py')
