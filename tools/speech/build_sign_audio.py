"""Generate offline speech for the three-word recognition trial."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'speech'))
from tiny_tts import TinyVocaEngine

out = ROOT / 'public' / 'audio' / 'signs'
out.mkdir(parents=True, exist_ok=True)
engine = TinyVocaEngine(directory=ROOT / 'private-video-work' / 'speech-models' / 'tiny-voca')
for label, word in [('hello', 'Salom.'), ('goodbye', 'Xayr.'), ('please', 'Iltimos.')]:
    (out / f'{label}.wav').write_bytes(engine.synthesize(word, 'uz'))
    print(f'Generated {label}', flush=True)
