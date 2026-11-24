"""Average full-turn and activity-aware fitted heads; calibrate on training only."""
from pathlib import Path
import json
import hashlib
import numpy as np
from train_skeletal import descriptors,classify
from train_temporal import augment,write_json

def fuse_models(first,second,data):
    assert first['classes']==second['classes']==data['labels']
    assert np.array_equal(np.asarray(first['mean']),np.asarray(second['mean'])[:768])
    assert np.array_equal(np.asarray(first['scale']),np.asarray(second['scale'])[:768])
    model=dict(second)
    weight=np.asarray(second['weight'])*.5
    weight[:768]+=np.asarray(first['weight'])*.5
    bias=(np.asarray(first['bias'])+np.asarray(second['bias']))*.5
    train=[e for e in data['examples'] if e['split']=='train']
    x=np.asarray([e['vectors'] for e in train],dtype=np.float32)
    labels=np.asarray([data['labels'].index(e['label']) for e in train])
    _,noise=augment(np.repeat(x,24,axis=0),np.random.default_rng(20261125),robust=True)
    augmented=np.concatenate((x,noise));actual=np.concatenate((labels,np.repeat(labels,24)))
    features=descriptors(augmented,True)
    score=((features-model['mean'])/model['scale'])@weight+bias
    order=np.argsort(-score,axis=1);correct=order[:,0]==actual
    top=score[np.arange(len(actual)),order[:,0]];margin=top-score[np.arange(len(actual)),order[:,1]]
    model.update(weight=weight.tolist(),bias=bias.tolist(),
        minimum_score=max(.1,float(np.quantile(top[correct],.01))*.5),
        minimum_margin=max(.02,float(np.quantile(margin[correct],.01))*.5),
        ensemble={'weights':[.5,.5]},calibration={'training_only':True,'real_references':len(train),'augmented_examples':len(noise),
            'nontraining_examples_used':0,'procedure':'Equal fitted-head weights; half correct-training q01 score/margin with fixed floors0.1/0.02.'})
    numerical={**model,'weight':weight,'bias':bias,'mean':np.asarray(model['mean']),'scale':np.asarray(model['scale'])}
    rows=classify([e for e in data['examples'] if e['split']!='train'],numerical)
    report={'predictions':rows,'calibration':model['calibration'],
        'parity_descriptors':[{'id':train[0]['id'],'values':descriptors(x[:1],True)[0].tolist()}],
        'training_augmentation_top1':float(correct.mean())}
    return model,report

if __name__=='__main__':
    root=Path('private-video-work/training-expanded-v2')
    data=json.loads((root/'normalized-words.json').read_text(encoding='utf-8'))
    paths=[Path('private-video-work/training-expanded-v1/skeletal/candidate-model.json'),root/'skeletal/candidate-model.json']
    first,second=[json.loads(p.read_text(encoding='utf-8')) for p in paths]
    model,report=fuse_models(first,second,data)
    model['ensemble']['members_sha256']=[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    out=root/'ensemble';out.mkdir(exist_ok=True)
    write_json(out/'candidate-model.json',model);write_json(out/'training-report.json',report)
    rows=report['predictions']
    print(json.dumps({'training_only':True,'classes':len(data['labels']),'training_augmentation_top1':report['training_augmentation_top1'],
        'known_correct':sum(r['label']==r['expected'] for r in rows if r['split']=='regression'),
        'known_wrong':sum(r['label'] not in ('none',r['expected']) for r in rows if r['split']=='regression')}))
