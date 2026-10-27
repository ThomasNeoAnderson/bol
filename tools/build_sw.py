#!/usr/bin/env python3
"""Regenerate the file list and CACHE_VERSION inside sw.js.

Run after changing any app file:   python3 tools/build_sw.py
Check without writing (for tests): python3 tools/build_sw.py --check

The version is a hash of every cached file, so it changes whenever any
file changes, and phones are offered the update.
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INCLUDE = ['index.html', 'manifest.webmanifest', 'css', 'js', 'data', 'icons', 'fonts', 'symbols']
SKIP_SUFFIX = {'.md', '.txt', '.csv', '.py'}

def app_files():
    files = []
    for entry in INCLUDE:
        p = ROOT / entry
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            files += sorted(f for f in p.rglob('*') if f.is_file() and f.suffix not in SKIP_SUFFIX)
    return files

def main():
    files = app_files()
    h = hashlib.sha256()
    for f in files:
        h.update(str(f.relative_to(ROOT)).encode())
        h.update(f.read_bytes())
    sw = ROOT / 'sw.js'
    src = sw.read_text(encoding='utf-8')
    # The hash covers sw.js's own non-generated code too.
    body = re.sub(r'// BEGIN GENERATED.*?// END GENERATED', '', src, flags=re.S)
    h.update(body.encode())
    version = 'bol-' + h.hexdigest()[:10]
    listing = ',\n  '.join(["'./'"] + [f"'./{f.relative_to(ROOT).as_posix()}'" for f in files])
    block = f"// BEGIN GENERATED\nconst CACHE_VERSION = '{version}';\nconst APP_FILES = [\n  {listing},\n];\n// END GENERATED"
    new = re.sub(r'// BEGIN GENERATED.*?// END GENERATED', block, src, flags=re.S)
    if '--check' in sys.argv:
        if new != src:
            print('sw.js is out of date: run python3 tools/build_sw.py'); sys.exit(1)
        print('sw.js up to date:', version); return
    sw.write_text(new, encoding='utf-8')
    print(f'{version}: {len(files)} files')

main()
