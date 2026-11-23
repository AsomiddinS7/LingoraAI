# Temporal model experiment

The recorded neural experiment below was not promoted. The current release uses
DTW with reviewed rejection references and a guarded visibility-aware profile;
see [the release research notes](../../docs/SIGN_MODEL_RESEARCH.md) for that
separate experiment and its small regression comparison.

This is a small trainable candidate beside the production DTW reference matcher. It uses frozen, pretrained MediaPipe hand and body landmarks. It does not train MediaPipe, learn a language foundation model, or establish general Uzbek sign-language accuracy.

The candidate was **not promoted**: DTW correctly accepted 3/5 previously inspected known regressions and rejected 3/3 unknown regressions. The finetuned candidate rejected all five known regressions and all three unknown regressions. Its nearest class was correct on four known examples, but its train-calibrated rejection rules rejected them. The pretrained encoder probe made false acceptances. DTW remains active; its feature precision is optimized separately with decision-preservation tests.

## Environment and input

The recorded run used Python 3.12, NumPy 2.5.5, one CPU thread and seed `20261123`. The installed PyTorch native DLL was blocked by Windows application control. The experiment therefore uses genuine NumPy backpropagation and Adam updates; no security settings were changed and no extra heavy dependencies were installed.

Run commands below from the repository root. If NumPy is not already available, install the single pinned dependency in a local virtual environment:

```powershell
python -m pip install -r tools/ml/requirements.txt
```

Prepare the normalized export with the repository's production JavaScript pipeline:

```powershell
node scripts/export-training-data.mjs
```

The default input is `private-video-work/training-v2/normalized-greetings.json`. Its format is `lingora-normalized-training-v1`, with `32 × 128` production-normalized vectors, four labels, source hashes, absolute retained source bounds, geometry hashes and explicit `train`, `regression`, `unknown_regression` splits. Baseline fields contain actual production DTW decisions.

There are six real training examples, five known regressions and three unknown regressions, all from one instructor/session. The regressions were already inspected during earlier development. They are **not an untouched test set**. The fixed pretrained VIDEO tracker uses 0.5 seconds of preceding context; a boundary frame can be shared even though retained feature windows do not overlap. Synthetic perturbations are not new independent signed performances.

## Actual training stages

```powershell
python tools/ml/train_temporal.py
```

Available options are `--input`, `--out`, `--seed`, `--pretrain-epochs`, `--finetune-epochs` and `--augmentations`. Defaults are seed `20261123`, 40 pretraining epochs, 60 finetuning epochs and 12 augmented versions per training template per epoch. Each stage is capped at 100 epochs. The default output directory is `private-video-work/training-v2/temporal-candidate`.

1. **Self-supervised denoising pretraining:** reconstruct clean normalized coordinates from corrupted training coordinates. Labels are absent from this loss. In the recorded final run, reconstruction loss decreased from `0.207095` to `0.005016` across 40 epochs.
2. **Supervised finetuning:** optimize class cross-entropy, within-class embedding center loss (weight 0.4), and reconstruction regularization (weight 0.03). Cross-entropy decreased from `1.79850` to `0.001742` across 60 epochs. Low training loss did not imply regression generalization.

Adam uses learning rates 0.001/0.0015 for the two stages, beta values 0.9/0.999, epsilon `1e-8`, batches of 24 and gradient norm clipping at 5. The temporal encoder contains a per-frame `128 → 32` dense layer, learned positions, a residual width-32 Conv1D with kernel 3/padding 1, tanh-approximate GELU, presence-weighted pooling and a normalized embedding. It has a reconstruction decoder and a supervised training head. Inference uses cosine class prototypes and the exported rejection radius/margin; the training head's softmax is not the inference decision rule.

Augmentation happens **after splitting**, on training templates only: coordinate scales 0.97–1.03, small x/y translations up to 0.005 and smooth coordinate noise. Hand-presence bits and missingness are preserved exactly. There is no time warping, new labeling or regression augmentation for fitting.

Rejection is calibrated on train-only augmentations and genuine leave-template-out refits where a class remains represented. Both the encoder pretraining and supervised fitting exclude the left-out template in each fold. All four eligible variant folds generalized poorly; they are reported, not hidden. The final radius `0.03` and minimum cosine margin `0.15` were frozen before regression prediction. No thresholds were selected from the known/unknown regressions.

## Artifacts and tests

- `pretrained-checkpoint.npz` and `finetuned-checkpoint.npz` preserve distinct stage weights.
- `pretrained-probe.json` exports the frozen pretrained encoder with a training-label centroid probe.
- `candidate-model.json` exports explicit architecture, weight layouts, prototypes and rejection settings for portable JavaScript inference.
- `data-audit.json`, `train-only-loto.json`, `training-report.json` and `training-tests.json` contain source/split/duplicate audits, losses, predictions, timing and numerical tests.

Training first verifies dense/temporal-convolution/position/decoder/classifier gradients against finite differences and separately checks the GELU derivative. A tiny overfit test on two real training examples reduced cross-entropy from `2.23490` to `0.0000204` with 100% training classification. This tests optimization correctness, not recognition accuracy.

Repeat the same run and compare deterministic state:

```powershell
python tools/ml/train_temporal.py --out private-video-work/training-v2/temporal-candidate-repeat
python tools/ml/check_reproducibility.py private-video-work/training-v2/temporal-candidate private-video-work/training-v2/temporal-candidate-repeat --report private-video-work/training-v2/temporal-candidate/reproducibility.json
```

The recorded runs produced byte-identical exports/checkpoints and identical loss histories, thresholds and predictions. Reproducibility is established on the recorded CPU/backend, not across all platforms. Candidate JSON SHA-256: `e2678d22fb673590bf34833a32fd4fc4d55f5e942fbe2358b8e954137669aa8c`; pretrained checkpoint: `2bbfb90eb3ddb1e754526cb8af370c340b0f765ca52830bad7ddcacef6402844`; finetuned checkpoint: `74d8dd08c0f344f19a3d58463f3d8b57a5a3cbd08125fe50450662abda46ed47`.

Run the adversarial leakage test:

```powershell
python tools/ml/test_leakage.py
```

It changes only every regression/unknown vector and label while retaining the training partition byte-for-byte, repeats actual 40/60-epoch fitting and train-only calibration, and asserts identical parameters, prototypes and rejection rules before prediction. It saves `leakage-test.json` alongside the candidate.

The repository's portable JavaScript comparison (`scripts/evaluate-temporal-candidate.mjs`) separately checked NumPy/JS inference agreement. Its promotion gate correctly rejected this candidate because it did not improve known recognition. Keep the DTW baseline and gather additional independently labeled performances before making stronger learned-model claims.
