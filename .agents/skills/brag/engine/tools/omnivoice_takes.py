#!/usr/bin/env python3
# Voice-over takes with OmniVoice (k2-fsa/OmniVoice): local, free, 600+ languages, runs on Apple Silicon (mps).
#   usage: <venv>/bin/python tools/omnivoice_takes.py pieces/<name> [--lang en|el|...] [--ref voice/ref.wav [--ref-text "..."]]
#   (--lang defaults to script.json's "lang")
#                                              [--instruct "female, middle-aged, moderate pitch"] [--only id,id] [--force]
#                                              [--fit] [--speed 1.0] [--steps 32] [--seed 7]
# reads  <piece>/voice/script.json (the same file tools/voice.mjs reads) and writes one take per line, voice/<id>.wav,
# setting "file" on each line. Lines that already have a take are skipped unless --force or --only names them.
#   --ref       clone this voice (3-10 s, same language as the script, from someone who agreed to it). Best quality.
#   --instruct  design a voice from attributes instead: gender, age, pitch, whisper, English accent. Trained on
#               English and Chinese only: for other languages prefer --ref.
#   neither     the model picks a voice; it changes from line to line, so use it for tests only.
#   --fit       make each line last its "dur" (seconds) from script.json, when a line has one.
#   --speed     speaking rate for every line (<1 slower, e.g. 0.85 for an unhurried narrator); --fit wins where both apply.
# Then run tools/voice.mjs as usual.
import argparse, json, os, sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('piece')
ap.add_argument('--lang', default=None)
ap.add_argument('--ref', default=None)
ap.add_argument('--ref-text', default=None)
ap.add_argument('--instruct', default=None)
ap.add_argument('--only', default=None)
ap.add_argument('--force', action='store_true')
ap.add_argument('--fit', action='store_true')
ap.add_argument('--speed', type=float, default=None)
ap.add_argument('--steps', type=int, default=32)
ap.add_argument('--seed', type=int, default=7)
a = ap.parse_args()

vdir = Path(a.piece) / 'voice'
spath = vdir / 'script.json'
S = json.loads(spath.read_text(encoding='utf-8'))
only = set(a.only.split(',')) if a.only else None

todo = []
for i, L in enumerate(S['lines']):
    lid = L.get('id') or f'l{i + 1}'
    if only and lid not in only: continue
    out = vdir / f'{lid}.wav'
    if out.exists() and not a.force and not only: L['file'] = out.name; continue
    todo.append((lid, L, out))
if not todo:
    print('omnivoice: every line already has a take (use --force or --only to redo)'); sys.exit(0)

# transformers loads weights from 4 threads at once; onto mps that segfaults about half the time
os.environ.setdefault('HF_DEACTIVATE_ASYNC_LOAD', '1')
import torch, soundfile as sf
from omnivoice import OmniVoice

device = 'cuda:0' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
model = OmniVoice.from_pretrained('k2-fsa/OmniVoice', device_map=device, dtype=torch.float16)
kw = dict(language=a.lang or S.get('lang'), num_step=a.steps)
if a.ref:
    kw['voice_clone_prompt'] = model.create_voice_clone_prompt(ref_audio=str(Path(a.ref)), ref_text=a.ref_text)
elif a.instruct:
    kw['instruct'] = a.instruct

for lid, L, out in todo:
    torch.manual_seed(a.seed)  # same seed per line, so a re-take of one line keeps the others' voice
    dur = L.get('dur') if a.fit else None
    audio = model.generate(text=L['text'], duration=dur, speed=None if dur else a.speed, **kw)[0]
    sf.write(out, audio, model.sampling_rate)
    L['file'] = out.name
    print(f'  {lid:<10} {len(audio) / model.sampling_rate:5.2f}s  {out.name}  "{L["text"]}"')

spath.write_text(json.dumps(S, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(f'omnivoice: {len(todo)} take(s) in {vdir} on {device}; now run tools/voice.mjs {a.piece}')
