"""Fit a regularized finger-shape + body-location classifier using training only."""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from train_temporal import augment, audit_dataset, write_json

def activity_vectors(x):
    out = []
    for sample in x:
        energy = np.zeros(32)
        for offset in (0,64):
            indices = np.flatnonzero(sample[:,offset])
            if len(indices) < 2: continue
            anchor = (sample[indices[0],offset+1:offset+64] + sample[indices[-1],offset+1:offset+64]) / 2
            difference = (sample[:,offset+1:offset+64]-anchor).reshape(32,21,3)[:,:,:2]
            value = np.sqrt((difference**2).mean(axis=(1,2))) * sample[:,offset]
            energy = np.maximum(energy,value)
        active = np.flatnonzero(energy >= energy.max() * .2) if energy.max() > 1e-8 else np.arange(32)
        start = min(8,max(0,int(active[0])-1)); end = max(23,min(31,int(active[-1])+1))
        times = np.linspace(start,end,32)
        low = np.floor(times).astype(int); high = np.minimum(low+1,31); alpha = (times-low)[:,None]
        selected = np.zeros_like(sample)
        for offset in (0,64):
            a,b = sample[low,offset:offset+64],sample[high,offset:offset+64]
            shared = ((a[:,0] > 0)&(b[:,0] > 0))[:,None]
            selected[:,offset:offset+64] = np.where(shared,a*(1-alpha)+b*alpha,np.where(alpha<.5,a,b))
        out.append(selected)
    return np.asarray(out)

def descriptors(x, active=False):
    x = np.asarray(x, dtype=np.float64)
    frames = np.zeros_like(x)
    for offset in (0, 64):
        present = x[:, :, offset:offset+1]
        points = x[:, :, offset+1:offset+64].reshape(len(x), 32, 21, 3)
        wrist = points[:, :, :1]
        palm = np.maximum(.04, np.median(np.linalg.norm(points[:, :, [5, 9, 17]] - wrist, axis=-1), axis=-1))
        frames[:, :, offset] = present[:, :, 0]
        frames[:, :, offset+1:offset+4] = points[:, :, 0] * present
        frames[:, :, offset+4:offset+64] = ((points[:, :, 1:] - wrist) / palm[:, :, None, None]).reshape(len(x), 32, 60) * present
    blocks = []
    for start, end, variance in ((0,32,False),(0,32,True),(0,8,False),(8,16,False),(16,24,False),(24,32,False)):
        values = frames[:, start:end]
        block = np.zeros((len(x), 128))
        for offset in (0, 64):
            present = values[:, :, offset:offset+1]
            count = np.maximum(present.sum(axis=1), 1)
            mean = values[:, :, offset+1:offset+64].sum(axis=1) / count
            ratio = present.mean(axis=1)
            block[:, offset:offset+1] = np.sqrt(ratio * (1-ratio)) if variance else ratio
            block[:, offset+1:offset+64] = np.sqrt(np.maximum(0, (values[:, :, offset+1:offset+64]**2).sum(axis=1)/count - mean**2)) if variance else mean
        blocks.append(block)
    features = np.concatenate(blocks, axis=1)
    return np.concatenate((features,descriptors(activity_vectors(x))),axis=1) if active else features

def motion_spans(x):
    spans = []
    for sample in x:
        hands = []
        for offset in (0,64):
            observed = sample[sample[:,offset] > 0, offset+1:offset+64].reshape(-1,21,3)
            if len(observed) < 4:
                hands.append(0.); continue
            center = observed[:,:,:2].mean(axis=1)
            ordered = np.sort(center,axis=0)
            delta = ordered[int((len(center)-1)*.9)] - ordered[int((len(center)-1)*.1)]
            hands.append(float(np.linalg.norm(delta)))
        spans.append(max(hands))
    return np.asarray(spans)

def classify(examples, model):
    if not examples: return []
    x = np.asarray([e['vectors'] for e in examples])
    z = (descriptors(x,model['descriptor'].endswith('activity-v2')) - model['mean']) / model['scale']
    score = z @ model['weight'] + model['bias']
    spans = motion_spans(x)
    order = np.argsort(-score, axis=1)
    rows = []
    for i, example in enumerate(examples):
        if example.get('reference')!='body' or example.get('handCoverage',0)<.65 or np.maximum(x[i,:,0],x[i,:,64]).mean()<.65:
            rows.append({'id':example['id'],'expected':example['label'],'split':example['split'],'label':'none',
                'nearest_label':None,'accepted':False,'score':None,'margin':None,'reason':'insufficient_tracking'});continue
        first, second = order[i, :2]
        top, margin = float(score[i, first]), float(score[i, first] - score[i, second])
        accepted = bool(top >= model['minimum_score'] and margin >= model['minimum_margin'] and spans[i] >= model['motion_gate']['minimum_span'])
        rows.append({'id': example['id'], 'expected': example['label'], 'split': example['split'],
            'label': model['classes'][first] if accepted else 'none', 'nearest_label': model['classes'][first],
            'accepted': accepted, 'score': top, 'margin': margin})
    return rows

def main(args):
    data = json.loads(args.input.read_text(encoding='utf-8'))
    audit = audit_dataset(data, args.input)
    train = [e for e in data['examples'] if e['split'] == 'train']
    x = np.asarray([e['vectors'] for e in train], dtype=np.float32)
    labels = np.asarray([data['labels'].index(e['label']) for e in train])
    rng = np.random.default_rng(args.seed)
    repeated = np.repeat(x, args.augmentations, axis=0)
    _, noisy = augment(repeated, rng, robust=True)
    augmented = np.concatenate((x, noisy))
    y = np.concatenate((labels, np.repeat(labels, args.augmentations)))
    active = args.descriptor == 'activity'
    real_features, features = descriptors(x,active), descriptors(augmented,active)
    mean = real_features.mean(axis=0); scale = np.maximum(.1, real_features.std(axis=0))
    z = (features - mean) / scale
    z = np.column_stack((z, np.ones(len(z))))
    targets = np.eye(len(data['labels']))[y]
    regularization = np.eye(z.shape[1]) * args.ridge
    regularization[-1, -1] = .001
    weights = np.linalg.solve(z.T @ z + regularization, z.T @ targets)
    scores = z @ weights
    order = np.argsort(-scores, axis=1)
    correct = order[:, 0] == y
    assert correct.any()
    top = scores[np.arange(len(y)), order[:, 0]]
    margins = top - scores[np.arange(len(y)), order[:, 1]]
    spans = motion_spans(x)
    model = {'format': 'lingora-skeletal-ridge-v1', 'feature_version': 'two-hand-body-v2', 'classes': data['labels'],
        'descriptor': 'palm-local-shape-body-wrist-activity-v2' if active else 'palm-local-shape-body-wrist-six-pools-v1', 'mean': mean, 'scale': scale,
        'weight': weights[:-1], 'bias': weights[-1],
        'minimum_score': max(.1, float(np.quantile(top[correct], .01)) * .5),
        'minimum_margin': max(.02, float(np.quantile(margins[correct], .01)) * .5),
        'motion_gate': {'profile': 'body-centroid-q10-q90-v1', 'minimum_span': float(spans.min()) * .5,
            'minimum_training_span': float(spans.min()), 'procedure': 'Half the minimum real-training centroid excursion; no evaluation clips used.'},
        'data_audit': audit, 'seed': args.seed, 'ridge': args.ridge,
        'calibration': {'training_only': True, 'real_references': data.get('provenance',{}).get('base_real_training_performances',len(train)),
            'training_views':len(train),'augmented_examples': len(noisy),
            'procedure': 'Half correct-training-augmentation q01 top score and margin; fixed score floor0.1/margin floor0.02.',
            'nontraining_examples_used': 0},
        'limitation': 'Sparse same-source samples. Finger shape is palm-relative, but anatomical orientation and global body wrist locations remain represented. No expert semantic or independent-signer validation.'}
    args.out.mkdir(parents=True, exist_ok=True)
    portable = {k: v.tolist() if isinstance(v, np.ndarray) else v for k, v in model.items()}
    write_json(args.out / 'candidate-model.json', portable)
    rows = classify([e for e in data['examples'] if e['split'] != 'train'], model)
    report = {'input_sha256': hashlib.sha256(args.input.read_bytes()).hexdigest(), 'predictions': rows,
        'train_augmentation_top1': float(correct.mean()), 'calibration': model['calibration'],
        'known_correct': sum(r['label'] == r['expected'] for r in rows if r['split'] == 'regression'),
        'known_wrong': sum(r['label'] not in ('none', r['expected']) for r in rows if r['split'] == 'regression'),
        'unknown_wrong': sum(r['label'] != 'none' for r in rows if r['split'] == 'unknown_regression'),
        'parity_descriptors': [{'id': train[0]['id'], 'values': real_features[0].tolist()}]}
    write_json(args.out / 'training-report.json', report)
    print(json.dumps({k: v for k, v in report.items() if k not in ('predictions', 'parity_descriptors')}), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('private-video-work/training-expanded-v1/normalized-words.json'))
    parser.add_argument('--out', type=Path, default=Path('private-video-work/training-expanded-v1/skeletal'))
    parser.add_argument('--seed', type=int, default=20261125)
    parser.add_argument('--augmentations', type=int, default=24)
    parser.add_argument('--ridge', type=float, default=1.)
    parser.add_argument('--descriptor',choices=('body','activity'),default='body')
    main(parser.parse_args())
