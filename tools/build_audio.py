#!/usr/bin/env python3
"""Generate the spoken audio for every starter tile, in every language.

Run after changing the vocabulary:   python3 tools/build_audio.py
Check without writing (for tests):  python3 tools/build_audio.py --check
Rebuild every file:                  python3 tools/build_audio.py --all

Writes api/v1/audio/{lang}/{tileId}.mp3 (and {tileId}.alt{n}.mp3 for the
long-press alternatives), plus api/v1/audio/manifest.json, which records the
exact text and voice of each file so changed words are re-spoken and stale
files are detected. Only changed or missing files are generated.

Needs eSpeak NG (open source, GPL-3.0; the audio it produces is not covered by
that licence) and ffmpeg:
  Ubuntu/Debian: sudo apt install espeak-ng ffmpeg
  macOS:         brew install espeak-ng ffmpeg
  Windows:       installers from github.com/espeak-ng/espeak-ng/releases and ffmpeg.org
The voice for each language is "espeakVoice" in data/languages.json.

eSpeak NG is robotic but fully open and covers Hindi, Tamil and Kannada. The
app does NOT use these files: on the phone it speaks with the phone's own
voice or a caregiver's recording. They are for API and MCP users.
"""
import hashlib, json, pathlib, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'api' / 'v1' / 'audio'
MANIFEST = OUT / 'manifest.json'
SPEED = 140          # words per minute; eSpeak's default 175 is fast for children
SETTINGS = f'espeak-ng -s {SPEED}; mp3 mono 22050 Hz 40 kb/s'


def load(name):
    return json.loads((ROOT / 'data' / name).read_text(encoding='utf-8'))


def pick(text, lang):
    """Same fallback as the app (js/core.js pick)."""
    return text.get(lang) or text.get('en') or next((v for v in text.values() if v), '')


def expected():
    """{relative path: {text, voice, lang, tile, alt}} for every audio file."""
    vocab, languages = load('vocab.json'), load('languages.json')
    files = {}
    for l in languages:
        for b in vocab['buttons']:
            texts = [(None, b['text'])] + [(i, a['text']) for i, a in enumerate(b.get('alts', []))]
            for alt, text in texts:
                name = b['id'] + (f'.alt{alt}' if alt is not None else '') + '.mp3'
                files[f"{l['code']}/{name}"] = {
                    'text': pick(text, l['code']).strip(), 'voice': l['espeakVoice'],
                    'lang': l['code'], 'tile': b['id'], 'alt': alt}
    return files


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def speak(text, voice, dest):
    """Synthesise one text to an mp3. Raises if eSpeak or ffmpeg fails."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / 'a.wav'
        subprocess.run(['espeak-ng', '-v', voice, '-s', str(SPEED), '-w', str(wav), text],
                       check=True, capture_output=True)
        if not wav.exists() or wav.stat().st_size < 1000:
            raise RuntimeError(f'eSpeak produced no audio for {text!r}')
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-ac', '1', '-ar', '22050',
                        '-b:a', '40k', '-map_metadata', '-1', '-fflags', '+bitexact', str(dest)],
                       check=True, capture_output=True)


def language_switches(text, voice):
    """eSpeak marks words it reads with another language's rules as (en) etc.
    Those words may sound wrong, so the build lists them."""
    out = subprocess.run(['espeak-ng', '-v', voice, '-q', '-x', text], capture_output=True, text=True).stdout
    return '(' in out


def engine_version():
    out = subprocess.run(['espeak-ng', '--version'], capture_output=True, text=True).stdout
    return out.split(':')[1].split('Data')[0].strip() if ':' in out else out.strip()


def main():
    want = expected()
    old = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {'files': {}}
    have = old.get('files', {})
    same = lambda p: (p in have and have[p]['text'] == want[p]['text'] and have[p]['voice'] == want[p]['voice']
                      and old.get('settings') == SETTINGS and (OUT / p).exists())

    if '--check' in sys.argv:
        stale = [p for p in want if not same(p)]
        bad = [p for p in want if same(p) and sha(OUT / p) != have[p]['sha256']]
        on_disk = {f.relative_to(OUT).as_posix() for f in OUT.rglob('*.mp3')} if OUT.exists() else set()
        extra = sorted(on_disk - set(want))
        if stale or bad or extra:
            print('api/v1/audio is out of date: run python3 tools/build_audio.py', (stale + bad + extra)[:5])
            sys.exit(1)
        print(f'audio up to date: {len(want)} files'); return

    for tool in ('espeak-ng', 'ffmpeg'):
        if not shutil.which(tool):
            sys.exit(f'{tool} is not installed (see the top of tools/build_audio.py)')
    todo = list(want) if '--all' in sys.argv else [p for p in want if not same(p)]
    files, warned = {}, []
    for p, info in want.items():
        if p in todo:
            speak(info['text'], info['voice'], OUT / p)
            if language_switches(info['text'], info['voice']):
                warned.append(f"{p}: {info['text']}")
        files[p] = {'text': info['text'], 'voice': info['voice'], 'sha256': sha(OUT / p)}
    for f in OUT.rglob('*.mp3'):
        if f.relative_to(OUT).as_posix() not in want:
            f.unlink()                      # tile or alternative removed
    manifest = {
        'engine': f'eSpeak NG {engine_version()}',
        'settings': SETTINGS,
        'note': 'Generated by tools/build_audio.py. Robotic open-source voice; the app itself uses the phone\'s voice.',
        'files': dict(sorted(files.items())),
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(todo)} generated, {len(want) - len(todo)} unchanged, {len(want)} audio files')
    if warned:
        print(f'{len(warned)} files contain words eSpeak reads with another language\'s rules (check by ear):')
        for w in warned[:20]:
            print('  ', w)


main()
