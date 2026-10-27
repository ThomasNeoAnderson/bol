#!/usr/bin/env python3
"""Write vocab_review.csv so a native speaker can check every word and phrase.

    python3 tools/export_review.py

Open the CSV in Excel, LibreOffice or Google Sheets (it is UTF-8 with a BOM so
Tamil, Kannada and Hindi display correctly). Fix any cell, set "reviewed" to
yes for rows that were checked, save as CSV, then run tools/import_review.py.
"""
import csv
from review_common import load, text_objects, reviewed_set, CSV, COLUMNS

vocab, ui = load()
done = reviewed_set(vocab)
with open(CSV, 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(COLUMNS)
    n = 0
    for rid, t in text_objects(vocab, ui):
        w.writerow([rid, t.get('en', ''), t.get('hi', ''), t.get('ta', ''), t.get('kn', ''),
                    'yes' if rid in done else 'no'])
        n += 1
print(f'Wrote {CSV.name}: {n} rows ({len(done)} reviewed)')
