"""Shared helpers for vocab_review.csv export/import.

Row ids in the CSV say where each text lives:
  core-2          a button (data/vocab.json)
  needs-7#alt1    the 1st alternative wording of a button
  cat:food        a category name
  type:verb       a word-type name (colour legend)
  ui:btn.speak    an interface string (data/ui.json)
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
VOCAB = ROOT / 'data' / 'vocab.json'
UI = ROOT / 'data' / 'ui.json'
CSV = ROOT / 'vocab_review.csv'
COLUMNS = ['id', 'English', 'Hindi', 'Tamil', 'Kannada', 'reviewed']
LANG_COLS = {'English': 'en', 'Hindi': 'hi', 'Tamil': 'ta', 'Kannada': 'kn'}


def load():
    return (json.loads(VOCAB.read_text(encoding='utf-8')),
            json.loads(UI.read_text(encoding='utf-8')))


def save(vocab, ui):
    VOCAB.write_text(json.dumps(vocab, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    UI.write_text(json.dumps(ui, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def text_objects(vocab, ui):
    """Yield (row_id, text_dict) for every translatable text, in a stable order."""
    for c in vocab['categories']:
        yield f"cat:{c['id']}", c['text']
    for k, w in vocab['wordTypes'].items():
        yield f'type:{k}', w['text']
    for b in vocab['buttons']:
        yield b['id'], b['text']
        for i, a in enumerate(b.get('alts', []), 1):
            yield f"{b['id']}#alt{i}", a['text']
    for k, v in ui.items():
        yield f'ui:{k}', v


def reviewed_set(vocab):
    r = vocab.get('reviewed', [])
    return set(r) if isinstance(r, list) else set()
