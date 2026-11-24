# Expanded trained model and camera simulations

Latest tracker and camera-adapted model results: [Tracking and model v2](TRACKING_AND_MODEL_V2.md).

Artifacts are private at `private-video-work/training-expanded-v1/`. The trained
bundle is `trained-sign-model.json`; the playable per-word report is
`simulation/report.html`. These are the first training experiment's results.
The subsequent camera-adapted model is selected for the public website; see
[the tracking/model update](TRACKING_AND_MODEL_V2.md) for the final release.

## Training and evaluation split

The experiment freezes **43 training references for 40 lexical labels**, with
40 separate same-recording regression repetitions spanning 38 labels and three
unknown/idle clips. The first dictionary demonstration trains; the second is
excluded from gradient training, feature standardization and calibration.
This repartitions a fresh experiment; it does not modify the source corpus's
training-only grouping or turn repetitions into independent recordings.

Numbers five and six have one real example each. Their video replays and stress
tests are labeled training-source replays. Six existing whole-script phrases
remain a separate DTW scope and have no independent validation footage.

## What was trained

The temporal candidate uses 24 epochs of train-only coordinate denoising followed
by 64 epochs of supervised training. Its frozen MediaPipe backbone is unchanged.
It underperformed the enlarged template gallery and was not selected.

The selected candidate fits a regularized classifier to palm-relative finger
shape, anatomical hand orientation and body-relative wrist locations. Six temporal
statistics preserve movement order. Its 1,032 augmented training examples include
bounded coordinate noise, time warping and brief missing-hand bursts. These
augmentations are not new recordings or signers.

The trained classifier resolves a DTW ambiguity only when both methods name the
same nearest sign and the unchanged DTW distance is within range. A train-only
inactivity threshold rejects resting hands even if a template would match them.
It is half the minimum robust hand-centroid excursion across real training
references; no idle/test clip sets that threshold.

On the previously inspected source-feature regression, the selected combination
improves **27/40 to 31/40 correct**, with zero wrong known-word acceptances and
three of three unknown examples rejected. This is development evidence from
sparse correlated sources, not unseen-signer accuracy.

Python and portable JavaScript descriptors, predictions, scores and margins were
checked for numerical agreement. An adversarial leakage check refits the actual
model after changing all 43 evaluation labels and landmark sequences: weights,
feature standardization, score calibration and inactivity calibration must
remain numerically identical. The report is `leakage-check/report.json`.

## Camera-style tests

There are 91 generated MP4 trials covering every lexical label and the six script
phrases. Each video is actually decoded and processed by production MediaPipe
hand and pose tracking at 12.5 Hz on Intel Iris Xe GPU. Conditions include:

- 640 × 480 framing with short neutral endpoint holds;
- 65% brightness, blur, 320 × 240 downsampling, shifted/scaled framing and 1.25× speed;
- separate numerical stress tests for frame loss, speed changes and short/severe
  hand tracking loss on all 40 lexical labels.

Real-time browser replays additionally use the application's `MotionRecognizer`,
recording-window runner and frame pump. These have scripted user-start/finish
boundaries. They test the actual collection pipeline, not automatic continuous
language segmentation. The report separates normal/adverse pixel tests, live
tests, unknowns and training-source replays, including each wrong prediction and
rejected word. Severe missingness and no-hand cases must reject.

The harness loads each clip as a seekable local blob. Serving a complete MP4 as a
non-range HTTP response produced stale first-frame reads; those diagnostic
results were discarded before the verified run. The final report preserves raw
tracked observations, source hashes and classifier hashes. If a classifier is
updated, pixel observations can be rescored explicitly, while live trials must
verify the current classifier hash before report generation.

## Reproduce

Use the existing local source files and private reviewed corpus. Start the Vite
preview in another terminal, then run from the repository root:

```powershell
npm run model:export:expanded
npm run model:train:expanded
npm run model:train:skeletal
npm run model:evaluate:expanded
npm run model:prepare:simulation
npm run model:test:simulation
npm run model:test:tracking
npm run model:report:simulation
python tools/ml/check_expanded_leakage.py
npm run test:model-pipeline
python -m unittest discover -s tools/ml -p test_expanded_training.py
```

If an older `simulation/live-results.json` exists, rerun
`node scripts/simulate-sign-camera.mjs --skeletal --live-only` for the current
classifier before producing the report. It intentionally refuses stale live
verification. For a fresh run, `model:test:simulation` contains both pixel and
live phases and needs no separate live file.

The inference bundle contains only compiled gallery features, learned classifier
parameters and Uzbek output labels. Its browser-portable entry points are
`scripts/skeletal-inference.mjs` and `scripts/hybrid-sign-inference.mjs`; feed
production `SequenceFrame` observations through `createHybridClassifier` with
the bundled gallery and parsed classifier. This is a research format, not the
website's existing motion-model import format. Raw footage, tracking data and
model research artifacts remain gitignored.
