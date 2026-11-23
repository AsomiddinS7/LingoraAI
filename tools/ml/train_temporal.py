"""Actual NumPy gradient training on frozen MediaPipe features, never regressions.

Installed torch_python.dll is blocked by Windows application control. This small
manual-backprop implementation avoids new dependencies or security changes.
"""
from __future__ import annotations
import os
for _name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[_name] = '1'
import argparse
import hashlib
import json
import math
import platform
import time
from collections import Counter
from pathlib import Path
import numpy as np

EPS, WIDTH, LOGIT_SCALE = 1e-8, 32, 10.0

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding='utf-8')

def gelu(x):
    return .5 * x * (1 + np.tanh(math.sqrt(2 / math.pi) * (x + .044715 * x ** 3)))

def gelu_gradient(x):
    t = np.tanh(math.sqrt(2 / math.pi) * (x + .044715 * x ** 3))
    return .5 * (1 + t) + .5 * x * (1 - t ** 2) * math.sqrt(2 / math.pi) * (1 + 3 * .044715 * x ** 2)

class TemporalNet:
    def __init__(self, classes, seed, dtype=np.float32):
        rng = np.random.default_rng(seed)
        self.params = {
            'input_weight': rng.normal(0, math.sqrt(2 / (128 + WIDTH)), (128, WIDTH)),
            'input_bias': np.zeros(WIDTH), 'position': rng.normal(0, .02, (32, WIDTH)),
            'conv_weight': rng.normal(0, .05 / math.sqrt(3 * WIDTH), (3, WIDTH, WIDTH)),
            'conv_bias': np.zeros(WIDTH),
            'decoder_weight': rng.normal(0, math.sqrt(2 / (128 + WIDTH)), (WIDTH, 128)),
            'decoder_bias': np.zeros(128),
            'classifier_weight': rng.normal(0, math.sqrt(2 / (classes + WIDTH)), (WIDTH, classes)),
            'classifier_bias': np.zeros(classes),
        }
        self.params = {k: v.astype(dtype) for k, v in self.params.items()}

    def forward(self, x):
        p = self.params
        a1 = x @ p['input_weight'] + p['input_bias'] + p['position']
        h1 = gelu(a1)
        padded = np.pad(h1, ((0, 0), (1, 1), (0, 0)))
        a2 = h1 + sum(padded[:, k:k + 32] @ p['conv_weight'][k] for k in range(3)) + p['conv_bias']
        hidden = gelu(a2)
        mask = np.maximum(x[:, :, 0], x[:, :, 64])[:, :, None]
        denominator = np.maximum(mask.sum(axis=1), 1)
        pooled = (hidden * mask).sum(axis=1) / denominator
        norm = np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), EPS)
        embedding = pooled / norm
        return dict(x=x, a1=a1, padded=padded, a2=a2, hidden=hidden, mask=mask,
            denominator=denominator, norm=norm, embedding=embedding,
            logits=LOGIT_SCALE * (embedding @ p['classifier_weight'] + p['classifier_bias']),
            reconstruction=hidden @ p['decoder_weight'] + p['decoder_bias'])

    def loss_gradient(self, x, target, labels=None, reconstruction_weight=1., metric_weight=0.):
        c, p = self.forward(x), self.params
        gradients = {k: np.zeros_like(v) for k, v in p.items()}
        presence = np.repeat(np.stack((target[:, :, 0], target[:, :, 64]), axis=-1), 64, axis=-1)
        weights = .1 + .9 * presence
        weights[:, :, [0, 64]] = .25
        error = c['reconstruction'] - target
        reconstruction = float(np.sum(error ** 2 * weights) / weights.sum())
        dr = reconstruction_weight * 2 * error * weights / weights.sum()
        gradients['decoder_weight'] = c['hidden'].reshape(-1, WIDTH).T @ dr.reshape(-1, 128)
        gradients['decoder_bias'] = dr.sum(axis=(0, 1))
        dh = dr @ p['decoder_weight'].T
        ce, metric = 0., 0.
        if labels is not None:
            logits = c['logits'] - c['logits'].max(axis=1, keepdims=True)
            probability = np.exp(logits)
            probability /= probability.sum(axis=1, keepdims=True)
            ce = float(-np.log(np.maximum(probability[np.arange(len(labels)), labels], 1e-30)).mean())
            dl = probability.copy()
            dl[np.arange(len(labels)), labels] -= 1
            dl *= LOGIT_SCALE / len(labels)
            gradients['classifier_weight'] = c['embedding'].T @ dl
            gradients['classifier_bias'] = dl.sum(axis=0)
            de = dl @ p['classifier_weight'].T
            difference = np.zeros_like(c['embedding'])
            for label in np.unique(labels):
                selected = labels == label
                difference[selected] = c['embedding'][selected] - c['embedding'][selected].mean(axis=0)
            metric = float(np.sum(difference ** 2) / len(labels))
            de += metric_weight * 2 * difference / len(labels)
            embedding = c['embedding']
            dp = (de - embedding * np.sum(de * embedding, axis=1, keepdims=True)) / c['norm']
            dh += dp[:, None, :] * c['mask'] / c['denominator'][:, None, :]
        da2 = dh * gelu_gradient(c['a2'])
        gradients['conv_bias'] = da2.sum(axis=(0, 1))
        padded_gradient = np.zeros_like(c['padded'])
        for k in range(3):
            gradients['conv_weight'][k] = c['padded'][:, k:k + 32].reshape(-1, WIDTH).T @ da2.reshape(-1, WIDTH)
            padded_gradient[:, k:k + 32] += da2 @ p['conv_weight'][k].T
        da1 = (da2 + padded_gradient[:, 1:-1]) * gelu_gradient(c['a1'])
        gradients['input_weight'] = x.reshape(-1, 128).T @ da1.reshape(-1, WIDTH)
        gradients['input_bias'] = da1.sum(axis=(0, 1))
        gradients['position'] = da1.sum(axis=0)
        return {'total': reconstruction_weight * reconstruction + ce + metric_weight * metric,
                'reconstruction': reconstruction, 'cross_entropy': ce, 'metric': metric}, gradients

class Adam:
    def __init__(self, params, learning_rate):
        self.lr, self.step = learning_rate, 0
        self.m = {k: np.zeros_like(v) for k, v in params.items()}
        self.v = {k: np.zeros_like(v) for k, v in params.items()}

    def update(self, params, gradients):
        self.step += 1
        norm = math.sqrt(sum(float(np.sum(v.astype(np.float64) ** 2)) for v in gradients.values()))
        scale = min(1., 5 / max(norm, EPS))
        for key in params:
            g = gradients[key] * scale
            self.m[key] = .9 * self.m[key] + .1 * g
            self.v[key] = .999 * self.v[key] + .001 * g ** 2
            params[key] -= self.lr * (self.m[key] / (1 - .9 ** self.step)) / (np.sqrt(self.v[key] / (1 - .999 ** self.step)) + 1e-8)

def augment(base, rng, noisy=True):
    """Bounded coordinate changes; hand presence and missingness remain exact."""
    clean = base.copy()
    for hand in (0, 64):
        present = base[:, :, hand:hand + 1]
        points = clean[:, :, hand + 1:hand + 64].reshape(len(base), 32, 21, 3)
        scale = rng.uniform(.97, 1.03, (len(base), 1, 1, 1))
        translation = rng.uniform(-.005, .005, (len(base), 1, 1, 3))
        translation[:, :, :, 2] = 0
        points[:] = (points * scale + translation) * present[:, :, :, None]
    corrupted = clean.copy()
    if noisy:
        noise = rng.normal(0, .008, clean.shape)
        noise = (np.roll(noise, 1, axis=1) + noise + np.roll(noise, -1, axis=1)) / 3
        for hand in (0, 64):
            corrupted[:, :, hand + 1:hand + 64] += noise[:, :, hand + 1:hand + 64] * clean[:, :, hand:hand + 1]
    assert np.array_equal(corrupted[:, :, [0, 64]], base[:, :, [0, 64]])
    return clean.astype(base.dtype), corrupted.astype(base.dtype)

def prototypes(model, x, labels, classes):
    embedding = model.forward(x)['embedding']
    out = np.stack([embedding[labels == label].mean(axis=0) for label in range(classes)])
    return out / np.maximum(np.linalg.norm(out, axis=1, keepdims=True), EPS)

def scores(model, x, centers):
    similarity = model.forward(x)['embedding'] @ centers.T
    order = np.argsort(-similarity, axis=1)
    predicted = order[:, 0]
    top = similarity[np.arange(len(x)), predicted]
    return predicted, 1 - top, top - similarity[np.arange(len(x)), order[:, 1]]

def calibration(model, x, labels, centers, seed, correct_loto=None):
    _, corrupted = augment(np.repeat(x, 128, axis=0), np.random.default_rng(seed))
    actual = np.repeat(labels, 128)
    predicted, distance, margin = scores(model, corrupted, centers)
    correct = predicted == actual
    if not correct.any():
        raise ValueError('No correct train-only calibration predictions')
    limit = float(np.quantile(distance[correct], .99))
    loto_distances = [item['distance'] for item in (correct_loto or [])]
    if loto_distances:
        limit = max(limit, float(np.quantile(loto_distances, .95)))
    return {'distance_limit': min(.6, max(.03, limit + .02)),
        'minimum_margin': max(.01, min(.15, float(np.quantile(margin[correct], .01)) * .5)),
        'procedure': 'Train augmentations q99 distance +0.02; correct train-only LOTO q95 if available; fixed radius[0.03,0.6]. Half q01 correct margin, fixed[0.01,0.15].',
        'augmentation_examples': len(actual), 'train_augmentation_correct': int(correct.sum()),
        'correct_loto_examples': len(loto_distances), 'regression_examples_used': 0, 'unknown_examples_used': 0}

def predictions(model, examples, centers, rejection, classes):
    x = np.asarray([item['vectors'] for item in examples], dtype=np.float32)
    predicted, distance, margin = scores(model, x, centers)
    out = []
    for i, item in enumerate(examples):
        accepted = bool(float(distance[i]) <= rejection['distance_limit'] and float(margin[i]) >= rejection['minimum_margin'])
        out.append({'id': item['id'], 'expected': item['label'], 'split': item['split'],
            'label': classes[int(predicted[i])] if accepted else 'none', 'nearest_label': classes[int(predicted[i])],
            'distance': float(distance[i]), 'margin': float(margin[i]), 'accepted': accepted, 'baseline': item.get('baseline')})
    return out

def train_model(x, labels, classes, seed, pre_epochs, fine_epochs, augmentations, keep_pretrained=False):
    model, rng = TemporalNet(classes, seed), np.random.default_rng(seed + 1)
    histories, stage_times, pretrained = {}, {}, None
    for stage, epochs in (('pretrain', pre_epochs), ('finetune', fine_epochs)):
        started = time.perf_counter()
        optimizer, history = Adam(model.params, .001 if stage == 'pretrain' else .0015), []
        for epoch in range(epochs):
            indices = np.repeat(np.arange(len(x)), augmentations)
            rng.shuffle(indices)
            clean, corrupted = augment(x[indices], rng)
            losses = []
            for start in range(0, len(indices), 24):
                end = min(len(indices), start + 24)
                loss, gradient = model.loss_gradient(corrupted[start:end], clean[start:end],
                    labels[indices[start:end]] if stage == 'finetune' else None,
                    reconstruction_weight=.03 if stage == 'finetune' else 1., metric_weight=.4 if stage == 'finetune' else 0.)
                optimizer.update(model.params, gradient)
                losses.append(loss)
            history.append({'epoch': epoch + 1, **{k: float(np.mean([v[k] for v in losses])) for k in losses[0]}})
        histories[stage], stage_times[stage] = history, time.perf_counter() - started
        if stage == 'pretrain' and keep_pretrained:
            pretrained = TemporalNet(classes, seed)
            pretrained.params = {k: v.copy() for k, v in model.params.items()}
    return model, pretrained, histories, stage_times

def gradient_checks():
    rng, model = np.random.default_rng(901), TemporalNet(2, 902, dtype=np.float64)
    x = rng.normal(0, .12, (4, 32, 128)); x[:, :, [0, 64]] = 1
    target = x + rng.normal(0, .01, x.shape); target[:, :, [0, 64]] = 1
    labels = np.asarray([0, 0, 1, 1])
    _, gradient = model.loss_gradient(x, target, labels, .2, .3)
    checks, epsilon = [], 1e-5
    for key in ('input_weight', 'conv_weight', 'position', 'decoder_weight', 'classifier_weight'):
        index = np.unravel_index(np.argmax(np.abs(gradient[key])), gradient[key].shape)
        original = model.params[key][index]
        model.params[key][index] = original + epsilon
        positive = model.loss_gradient(x, target, labels, .2, .3)[0]['total']
        model.params[key][index] = original - epsilon
        negative = model.loss_gradient(x, target, labels, .2, .3)[0]['total']
        model.params[key][index] = original
        numerical, analytic = (positive - negative) / (2 * epsilon), float(gradient[key][index])
        relative = abs(numerical - analytic) / max(1e-7, abs(numerical) + abs(analytic))
        checks.append({'parameter': key, 'analytic': analytic, 'finite_difference': numerical, 'relative_error': relative})
        assert relative < 2e-4, f'Gradient check failed: {key}: {relative}'
    points = np.asarray([-2., -.4, 0., .5, 2.])
    difference = float(np.max(np.abs((gelu(points + epsilon) - gelu(points - epsilon)) / (2 * epsilon) - gelu_gradient(points))))
    assert difference < 1e-7
    return {'finite_difference': checks, 'gelu_max_absolute_error': difference, 'passed': True}

def tiny_overfit(x, labels, ids):
    _, i, j = max((float(np.linalg.norm(x[i] - x[j])), i, j)
        for i in range(len(x)) for j in range(i + 1, len(x)) if labels[i] != labels[j])
    small_x, small_y = x[[i, j]], np.asarray([0, 1])
    model, history = TemporalNet(2, 710), []
    optimizer = Adam(model.params, .01)
    for _ in range(60):
        loss, gradient = model.loss_gradient(small_x, small_x, small_y, 0., 0.)
        optimizer.update(model.params, gradient); history.append(loss['cross_entropy'])
    accuracy = float(np.mean(model.forward(small_x)['logits'].argmax(axis=1) == small_y))
    assert history[-1] < history[0] * .2 and accuracy == 1.
    return {'ids': [ids[i], ids[j]], 'train_only': True, 'epochs': 60, 'initial_cross_entropy': history[0],
            'final_cross_entropy': history[-1], 'training_accuracy': accuracy, 'passed': True}

def audit_dataset(data, path):
    assert data['format'] == 'lingora-normalized-training-v1'
    assert (data['frames'], data['features']) == (32, 128)
    items = data['examples']; assert len({item['id'] for item in items}) == len(items)
    for item in items:
        value = np.asarray(item['vectors'])
        assert value.shape == (32, 128) and np.isfinite(value).all()
        assert item['split'] in ('train', 'regression', 'unknown_regression')
        assert item['source_start_ms'] < item['source_end_ms']
    overlaps, duplicates = [], []
    for i, first in enumerate(items):
        for second in items[i + 1:]:
            if first['source_key'] == second['source_key'] and max(first['source_start_ms'], second['source_start_ms']) < min(first['source_end_ms'], second['source_end_ms']):
                overlaps.append([first['id'], second['id']])
            same_geometry = first.get('geometry_sha256') and first.get('geometry_sha256') == second.get('geometry_sha256')
            if first['split'] != second['split'] and (same_geometry or digest(first['vectors']) == digest(second['vectors'])):
                duplicates.append([first['id'], second['id']])
    assert not overlaps, f'Retained source windows overlap: {overlaps}'
    assert not duplicates, f'Cross-split geometry duplicates: {duplicates}'
    train = [item for item in items if item['split'] == 'train']
    assert set(item['label'] for item in train) == set(data['labels'])
    return {'input_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'split_counts': dict(Counter(item['split'] for item in items)), 'training_ids': [item['id'] for item in train],
        'training_geometry_sha256': digest([item['vectors'] for item in train]),
        'source_keys': sorted({item['source_key'] for item in items}), 'retained_window_overlaps': overlaps,
        'cross_split_duplicates': duplicates, 'split_before_augmentation': True, 'regression_previously_inspected': True,
        'source_provenance': data.get('provenance'),
        'limitation': 'One signer/session; previously inspected regression, not untouched testing. Tracker pre-roll may share a boundary frame.'}

def export_model(model, centers, rejection, classes, audit, stage):
    return {'format': 'lingora-temporal-candidate-v1', 'stage': stage, 'classes': classes,
        'architecture': {'input_shape': [32, 128], 'width': WIDTH,
            'frame_linear': 'x @ input_weight[in,out] + input_bias[out] + position[time,out]',
            'activation': 'gelu_tanh_approximation', 'gelu_cubic': .044715,
            'temporal_conv': {'kernel': 3, 'padding': 1, 'stride': 1, 'layout': '[kernel,input_channel,output_channel]', 'operation': 'cross_correlation'},
            'residual': 'gelu(frame_hidden + conv(frame_hidden))',
            'pool': 'mean weighted by max(input[t,0], input[t,64]); denominator max(sum,1)',
            'embedding': 'L2 normalize pooled vector', 'normalization_epsilon': EPS, 'classifier_logit_scale': LOGIT_SCALE,
            'decision': 'nearest normalized class prototype by cosine similarity; require radius and top-two margin'},
        'weights': {k: v.tolist() for k, v in model.params.items()}, 'prototypes': centers.tolist(), 'rejection': rejection,
        'feature_version': 'two-hand-body-v2', 'data_audit': audit,
        'scope': 'Frozen pretrained MediaPipe inputs plus trainable temporal head; no foundation-language pretraining or backbone finetuning.'}

def summarize(rows):
    known, unknown = [r for r in rows if r['split'] == 'regression'], [r for r in rows if r['split'] == 'unknown_regression']
    return {'known_examples': len(known), 'correct_accepted': sum(r['label'] == r['expected'] for r in known),
        'wrong_accepted': sum(r['label'] not in ('none', r['expected']) for r in known), 'known_rejected': sum(r['label'] == 'none' for r in known),
        'unknown_examples': len(unknown), 'unknown_rejected': sum(r['label'] == 'none' for r in unknown),
        'unknown_wrong_accepted': sum(r['label'] != 'none' for r in unknown)}

def main(args):
    started = time.perf_counter()
    assert 1 <= args.pretrain_epochs <= 100 and 1 <= args.finetune_epochs <= 100
    args.out.mkdir(parents=True, exist_ok=True)
    data = json.loads(args.input.read_text(encoding='utf-8'))
    audit = audit_dataset(data, args.input); write_json(args.out / 'data-audit.json', audit)
    tests = gradient_checks()
    train = [item for item in data['examples'] if item['split'] == 'train']
    evaluation = [item for item in data['examples'] if item['split'] != 'train']
    classes = data['labels']
    x = np.asarray([item['vectors'] for item in train], dtype=np.float32)
    y = np.asarray([classes.index(item['label']) for item in train])
    tests['tiny_overfit'] = tiny_overfit(x, y, [item['id'] for item in train])
    write_json(args.out / 'training-tests.json', tests)
    print(json.dumps({'audit': audit['split_counts'], 'gradient_checks': 'passed', 'tiny_overfit': tests['tiny_overfit']}), flush=True)
    folds, counts = [], Counter(y.tolist())
    for excluded, example in enumerate(train):
        if counts[y[excluded]] < 2: continue
        retained = np.asarray([i for i in range(len(train)) if i != excluded])
        model, _, history, timing = train_model(x[retained], y[retained], len(classes), args.seed + 100 + excluded,
            args.pretrain_epochs, args.finetune_epochs, args.augmentations)
        centers = prototypes(model, x[retained], y[retained], len(classes))
        label, distance, margin = scores(model, x[[excluded]], centers)
        fold = {'excluded_id': example['id'], 'expected': example['label'], 'predicted': classes[int(label[0])],
            'distance': float(distance[0]), 'margin': float(margin[0]), 'training_ids': [train[i]['id'] for i in retained],
            'timing_seconds': timing, 'histories': history, 'encoder_pretraining_excludes_held_template': True}
        folds.append(fold); write_json(args.out / 'train-only-loto.json', folds)
        print(json.dumps({'fold': example['id'], 'predicted': fold['predicted'], 'distance': fold['distance'], 'timing': timing}), flush=True)
    model, pretrained, histories, timing = train_model(x, y, len(classes), args.seed,
        args.pretrain_epochs, args.finetune_epochs, args.augmentations, keep_pretrained=True)
    np.savez(args.out / 'pretrained-checkpoint.npz', **pretrained.params)
    np.savez(args.out / 'finetuned-checkpoint.npz', **model.params)
    pre_centers, final_centers = prototypes(pretrained, x, y, len(classes)), prototypes(model, x, y, len(classes))
    correct_folds = [fold for fold in folds if fold['expected'] == fold['predicted']]
    pre_rejection = calibration(pretrained, x, y, pre_centers, args.seed + 500)
    final_rejection = calibration(model, x, y, final_centers, args.seed + 500, correct_folds)
    write_json(args.out / 'pretrained-probe.json', export_model(pretrained, pre_centers, pre_rejection, classes, audit, 'denoising_pretrained_encoder_centroid_probe'))
    write_json(args.out / 'candidate-model.json', export_model(model, final_centers, final_rejection, classes, audit, 'supervised_finetuned_candidate'))
    # Weights/prototypes/rejection are now frozen before regression evaluation.
    pre_rows = predictions(pretrained, evaluation, pre_centers, pre_rejection, classes)
    final_rows = predictions(model, evaluation, final_centers, final_rejection, classes)
    baseline_rows = [{'id': e['id'], 'expected': e['label'], 'split': e['split'], 'label': e['baseline']['label']} for e in evaluation]
    report = {'runtime': {'backend': 'NumPy manual backprop + Adam', 'numpy': np.__version__, 'python': platform.python_version(),
            'torch': 'Installed but torch_python.dll blocked by Windows application control; unused', 'threads': 1},
        'seed': args.seed, 'stages': {'pretrain': {'objective': 'denoise train-only normalized coordinates; no labels in loss', 'epochs': args.pretrain_epochs},
            'finetune': {'objective': 'cross-entropy +0.4 within-class embedding center loss +0.03 reconstruction', 'epochs': args.finetune_epochs}},
        'augmentation': {'train_only': True, 'per_template_per_epoch': args.augmentations, 'coordinate_scale': [.97, 1.03],
            'xy_translation_max': .005, 'smooth_coordinate_noise_std_before_smoothing': .008, 'hand_presence_changed': False, 'temporal_warp': False, 'new_semantic_labels': False},
        'data_audit': audit, 'histories': histories, 'stage_seconds': timing, 'train_only_loto': folds,
        'pretrained_probe_rejection': pre_rejection, 'final_rejection': final_rejection,
        'baseline': {'summary': summarize(baseline_rows), 'predictions': baseline_rows},
        'pretrained_probe': {'summary': summarize(pre_rows), 'predictions': pre_rows},
        'candidate': {'summary': summarize(final_rows), 'predictions': final_rows},
        'checkpoint_sha256': {name: hashlib.sha256((args.out / name).read_bytes()).hexdigest() for name in ('pretrained-checkpoint.npz', 'finetuned-checkpoint.npz', 'candidate-model.json')},
        'tests': tests, 'total_seconds': time.perf_counter() - started,
        'promotion': 'Research candidate only; no public model changes. Retain DTW if comparison gate fails.',
        'limitation': 'Six real training examples, four labels, one signer/session. Augmentations are not independent performances. Previously inspected regression is not untouched testing; train-calibrated rejection is not validated on fresh unknowns.'}
    write_json(args.out / 'training-report.json', report)
    print(json.dumps({'baseline': report['baseline']['summary'], 'pretrained_probe': report['pretrained_probe']['summary'],
        'candidate': report['candidate']['summary'], 'stage_seconds': timing, 'total_seconds': report['total_seconds']}), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('private-video-work/training-v2/normalized-greetings.json'))
    parser.add_argument('--out', type=Path, default=Path('private-video-work/training-v2/temporal-candidate'))
    parser.add_argument('--seed', type=int, default=20261123)
    parser.add_argument('--pretrain-epochs', type=int, default=40)
    parser.add_argument('--finetune-epochs', type=int, default=60)
    parser.add_argument('--augmentations', type=int, default=12)
    main(parser.parse_args())
