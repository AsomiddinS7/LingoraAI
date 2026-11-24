"""Prepare an allowlisted Space upload; --deploy publishes only on free ZeroGPU."""
import argparse
import json
from pathlib import Path
import re
import shutil

ROOT=Path(__file__).resolve().parents[2]
RUNTIME=['server.py','nvidia_ctc.py','speech_audio.py','tiny_tts.py','space_api.py',
         'download_tts.py','download_candidates.py','MODEL_NOTICES.md',
         'requirements.txt','requirements-candidates.txt','requirements-tts.txt']

def prepare(out):
    out=Path(out)
    if not out.resolve().is_relative_to((ROOT/'output').resolve()):
        raise ValueError('Space build must stay in the ignored project output directory')
    (out/'runtime').mkdir(parents=True,exist_ok=True)
    expected={'app.py','README.md','requirements.txt'}|{'runtime/'+name for name in RUNTIME}
    # Refuse a stale folder containing anything outside the explicit source list.
    for path in out.rglob('*'):
        if path.is_file() and '__pycache__' not in path.relative_to(out).parts and path.relative_to(out).as_posix() not in expected:
            raise ValueError('Unexpected file in upload directory; choose a fresh output folder')
    for name in ['app.py','README.md','requirements.txt']:
        shutil.copyfile(ROOT/'deploy/huggingface'/name,out/name)
    for name in RUNTIME:
        shutil.copyfile(ROOT/'tools/speech'/name,out/'runtime'/name)
    return sorted(expected)

def main(args):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*',args.repo):
        raise ValueError('Use an owner/space-name repository ID')
    files=prepare(args.out)
    print(json.dumps({'prepared':str(args.out),'files':files,'hardware':'zero-a10g','paid_hardware_allowed':False}),flush=True)
    if not args.deploy:return
    from huggingface_hub import HfApi,get_token,SpaceHardware
    if not get_token():
        raise SystemExit('Hugging Face login is missing. Run hf auth login locally with a write token, then rerun --deploy. No credential was printed.')
    api=HfApi();identity=api.whoami()
    if identity.get('name','').lower()!=args.repo.split('/')[0].lower():
        raise SystemExit('The authenticated account does not match the selected Space owner.')
    api.create_repo(repo_id=args.repo,repo_type='space',space_sdk='gradio',private=False,
                    space_hardware=SpaceHardware.ZERO_A10G,exist_ok=True)
    state=api.get_space_runtime(args.repo)
    if state.hardware!=SpaceHardware.ZERO_A10G and state.requested_hardware!=SpaceHardware.ZERO_A10G:
        api.request_space_hardware(args.repo,hardware=SpaceHardware.ZERO_A10G)
    api.upload_folder(repo_id=args.repo,repo_type='space',folder_path=args.out,allow_patterns=files,
                      commit_message='Deploy Lingora Uzbek speech on free ZeroGPU')
    info=api.space_info(args.repo)
    print(json.dumps({'space_url':'https://huggingface.co/spaces/'+args.repo,
                      'app_url':getattr(info,'host',None),'published':True,'running_verified':False}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',default='asomiddinsaidov07/lingora-speech')
    p.add_argument('--out',type=Path,default=ROOT/'output/huggingface-space')
    p.add_argument('--deploy',action='store_true')
    main(p.parse_args())
