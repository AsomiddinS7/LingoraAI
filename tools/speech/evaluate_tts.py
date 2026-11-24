"""Generate fixed voice checks, then score with independent ASR in a separate run.

ASR round trips are diagnostics, not a human intelligibility or MOS assessment.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

PHRASES = ['Assalomu alaykum. Menga yordam kerak.', 'Iltimos, yana bir marta takrorlang.',
           'Men sizni tushundim.', 'Mening ismim Ali. Sizning ismingiz nima?',
           'Men eshitmayman. Iltimos, yozib bering.', 'Shifoxona qayerda?',
           'Bugun Toshkentda havo yaxshi.', 'Bir, ikki, uch, to‘rt, besh.']
def main(args):
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path=args.out/'generated.json'
    if args.generate:
        from tiny_tts import TinyVocaEngine
        engine=TinyVocaEngine();start=time.perf_counter();engine.load();load_seconds=time.perf_counter()-start
        rows=[]
        for i,text in enumerate(PHRASES):
            start=time.perf_counter();wav=engine.synthesize(text,'uz');elapsed=time.perf_counter()-start
            path=args.out/f'phrase-{i:02d}.wav';path.write_bytes(wav)
            rows.append({'id':i,'text':text,'spoken_text':engine.normalize(text,mode='infer'),'file':path.name,
                         'sha256':hashlib.sha256(wav).hexdigest(),'duration_seconds':(len(wav)-44)/48000,
                         'generation_seconds':elapsed})
        manifest_path.write_text(json.dumps({'model':engine.model_name,'model_load_seconds':load_seconds,'examples':rows},ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'samples':len(rows),'mean_generation_seconds':sum(r['generation_seconds'] for r in rows)/len(rows)}))
    else:
        from nvidia_ctc import NvidiaCtcModel,cached_model_directory
        from server import decode_audio
        from evaluate import score
        m=NvidiaCtcModel(cached_model_directory());manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
        for row in manifest['examples']:
            data=(args.out/row['file']).read_bytes()
            if hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Generated audio hash changed')
            text=m.transcribe(decode_audio(data));row['asr_transcript']=text;row['asr_metrics']=score(row['spoken_text'],text)
        rows=manifest['examples'];manifest['roundtrip_wer']=sum(r['asr_metrics']['wer']['errors'] for r in rows)/sum(r['asr_metrics']['wer']['reference_units'] for r in rows)
        manifest['scope']='Synthetic speech decoded by a separate ASR model. ASR errors and short-turn VAD can affect results. No human intelligibility or pronunciation score.'
        (args.out/'roundtrip.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'roundtrip_wer':manifest['roundtrip_wer'],'samples':len(rows)}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--generate',action='store_true')
    p.add_argument('--out',type=Path,default=Path('private-video-work/speech-evaluation/tts-v1'))
    main(p.parse_args())
