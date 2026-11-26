"""Generate the bundled introduction from the pinned Uzbek voice model."""
import re
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'speech'))
from tiny_tts import TinyVocaEngine

source = (ROOT / 'src' / 'data' / 'presentation.ts').read_text(encoding='utf-8')
lines = source.split('export const PRESENTATION_CUES = [', 1)[1].split('] as const', 1)[0]
cues = re.findall(r"^\s*'([^']*)',\s*$", lines, flags=re.MULTILINE)
if len(cues) != 6:
    raise ValueError('Expected six simple presentation cues')
(ROOT / 'src' / 'data' / 'preparedAudioCues.json').write_text(
    json.dumps(cues, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
out = ROOT / 'public' / 'audio' / 'introduction'
out.mkdir(parents=True, exist_ok=True)
engine = TinyVocaEngine(directory=ROOT / 'private-video-work' / 'speech-models' / 'tiny-voca')
for index, cue in enumerate(cues, start=1):
    (out / f'{index}.wav').write_bytes(engine.synthesize(cue, 'uz'))
    print(f'Generated cue {index}/{len(cues)}', flush=True)
