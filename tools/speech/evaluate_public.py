"""Evaluate frozen audio profiles on a hash-pinned speech split, entirely offline."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import numpy as np
from evaluate import score, NORMALIZATION
from nvidia_ctc import NvidiaCtcModel, cached_model_directory
from server import decode_audio

def digest(data):
    return hashlib.sha256(data).hexdigest()

def variant(samples, kind, seed):
    if kind == 'clean': return samples
    if kind == 'quiet': return samples * .06
    rng = np.random.default_rng(seed)
    rms = np.sqrt(np.mean(samples**2))
    return np.clip(samples + rng.normal(0, rms / (10**.9), len(samples)), -1, 1).astype(np.float32)

def evaluate(manifest_path, role, profiles, output):
    raw = manifest_path.read_bytes(); manifest = json.loads(raw)
    examples = [e for e in manifest['examples'] if e['role'] == role]
    if not examples: raise ValueError('Empty benchmark role')
    groups = [e['sentence_group'] for e in manifest['examples']]
    if len(groups) != len(set(groups)): raise ValueError('Duplicate sentence group across benchmark')
    directory = cached_model_directory()
    model = NvidiaCtcModel(directory)
    results = []
    for e in examples:
        data = (manifest_path.parent/e['audio']).read_bytes()
        if digest(data) != e['sha256']: raise ValueError('Evaluation audio hash mismatch')
        audio = decode_audio(data)
        for condition in ['clean', 'quiet', 'noise18db']:
            samples = variant(audio, condition, e['row_index'] + 20261124)
            input_hash = digest(samples.tobytes())
            for profile in profiles:
                model.preprocessing = profile
                start = time.perf_counter(); text = model.transcribe(samples)
                elapsed = time.perf_counter()-start
                results.append({'id': e['id'], 'role': role, 'condition': condition, 'profile': profile,
                                'input_sha256': input_hash, 'transcript': text, 'reference': e['reference'],
                                'seconds': len(samples)/16000, 'inference_seconds': elapsed,
                                'metrics': score(e['reference'], text)})
        print(json.dumps({'evaluated': e['id'], 'role': role}), flush=True)
    silence = []
    rng = np.random.default_rng(20261124)
    for name, samples in [('silence', np.zeros(48000, dtype=np.float32)),
                          ('quiet_noise', rng.normal(0, .0005, 48000).astype(np.float32)),
                          ('dc_offset', np.full(48000, .1, dtype=np.float32))]:
        for profile in profiles:
            model.preprocessing = profile
            text = model.transcribe(samples)
            silence.append({'condition': name, 'profile': profile, 'text': text, 'rejected': not text})
    summary = []
    for profile in profiles:
        for condition in ['clean', 'quiet', 'noise18db']:
            rows = [r for r in results if r['profile'] == profile and r['condition'] == condition]
            summary.append({'profile': profile, 'condition': condition, 'examples': len(rows),
                            'wer': sum(r['metrics']['wer']['errors'] for r in rows)/sum(r['metrics']['wer']['reference_units'] for r in rows),
                            'cer': sum(r['metrics']['cer']['errors'] for r in rows)/sum(r['metrics']['cer']['reference_units'] for r in rows),
                            'mean_inference_seconds': sum(r['inference_seconds'] for r in rows)/len(rows)})
    report = {'format': 'lingora-public-speech-results-v1', 'created_at': datetime.now(timezone.utc).isoformat(),
              'manifest_sha256': digest(raw), 'role': role, 'model_directory': str(directory),
              'normalization': NORMALIZATION, 'reference_source': 'FLEURS human corpus transcript',
              'model_finetuned': False, 'audio_uploaded': False, 'physical_microphone_tested': False,
              'scope': manifest['scope'], 'summary': summary, 'silence': silence, 'results': results}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'summary': summary, 'silence': silence}), flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, default=Path('private-video-work/speech-evaluation/public-v1/manifest.json'))
    p.add_argument('--role', choices=['dev', 'holdout'], default='dev')
    p.add_argument('--profiles', nargs='+', choices=['raw', 'trim', 'level'], default=['raw', 'trim', 'level'])
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args(); evaluate(args.manifest, args.role, args.profiles, args.out)
