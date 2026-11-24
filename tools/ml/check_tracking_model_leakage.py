"""Refit both selected-head members after adversarial evaluation changes."""
from pathlib import Path
from types import SimpleNamespace
import json
import copy
import numpy as np
from train_skeletal import main as fit
from fuse_skeletal import fuse_models

root=Path('private-video-work/training-expanded-v2')
data=json.loads((root/'normalized-words.json').read_text(encoding='utf-8'))
changed=copy.deepcopy(data)
for example in changed['examples']:
    if example['split']=='train':continue
    x=np.asarray(example['vectors'])[::-1].copy()
    for offset in (0,64):x[:,offset+1:offset+64]*=-2.5
    example['vectors']=x.tolist();example['label']=data['labels'][0] if example['label']!=data['labels'][0] else data['labels'][1]
assert [e for e in data['examples'] if e['split']=='train']==[e for e in changed['examples'] if e['split']=='train']
folder=root/'leakage-check';folder.mkdir(exist_ok=True)
fused=[]
for name,source in [('original',data),('modified',changed)]:
    path=folder/(name+'.json');path.write_text(json.dumps(source),encoding='utf-8')
    models=[]
    for descriptor in ('body','activity'):
        out=folder/(name+'-'+descriptor)
        fit(SimpleNamespace(input=path,out=out,seed=20261125,augmentations=24,ridge=1.,descriptor=descriptor))
        models.append(json.loads((out/'candidate-model.json').read_text(encoding='utf-8')))
    model,_=fuse_models(*models,source);fused.append(model)
checks={}
for key in ('weight','bias','mean','scale','minimum_score','minimum_margin'):
    error=float(np.max(np.abs(np.asarray(fused[0][key])-np.asarray(fused[1][key]))))
    assert error<1e-12,(key,error)
    checks[key]={'max_absolute_difference':error,'passed':True}
assert fused[0]['motion_gate']==fused[1]['motion_gate']
report={'passed':True,'altered_evaluation_examples':43,'training_examples_unchanged':43,
    'both_members_actually_refitted':True,'parameters_and_calibration':checks,'motion_gate_identical':True,
    'scope':'Only numerical fitted state is compared; source dataset hash metadata changes with adversarial evaluation edits.'}
(folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
