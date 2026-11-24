# Hand tracking and camera-adapted recognition

The app now defaults to `hands-pose-recovery-video-v2`. It associates only hands
detected in the current frame. Short-lived wrist history stabilizes anatomical
identity when detector labels flicker or the hands cross; it expires after300ms
and clears between videos/camera sessions. Either visible body wrist can guide
assignment even when the other is occluded.

A separate IMAGE-mode hand detector can inspect a square crop around a visible
pose wrist when the VIDEO detector misses a hand. Crop landmarks are mapped back
to the original x/y/z scale. Duplicate and off-target detections are rejected.
Recovery has one-crop and retry-rate limits, adapts to processing cost, and fails
back to ordinary tracking if its optional model cannot run. It never fills gaps
with previously detected hand points. See the
[MediaPipe hand task documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web)
for IMAGE/VIDEO modes and landmark conventions.

Legacy/custom sequence stores also reject stationary turns using half the minimum
movement excursion among its loaded compatible references. The floor clears
with the references, and held-shape reference collections remain supported.
This prevents a resting hand from becoming a translated word.
The default published 40-word bundle instead uses its own training-fitted floor
and the evaluated hybrid decision rule. `src/ml/trainedSignModel.ts` validates
the bundle, and `sequenceStore` routes it through the same inference helper used
for the measurements below. `scripts/publish-trained-model.mjs` exports only
inference features, weights and Uzbek word labels; raw videos and audit records
remain private. Editing a gallery deactivates the fitted classifier.

## Measured comparison

All91existing video scenarios were processed separately with original, identity
stabilized and recovery tracking. Every capture asserts that its diagnostic
frame count equals the actual extracted frame count. Two initial comparisons
made against a hot-reload-created second tracker instance were discarded and
preserved as `unverified-*` artifacts; the reported runs all pass the assertion.

With the selected camera-trained model and recovery tracker:

| Same-recording scenario | Previous tracker/model | Updated tracker/model |
| --- | --- | --- |
| Normal pixels | 28/40 | 34/40 |
| Dim light, blur, reframing, faster signing | 24/38 | 30/38 |
| Unknown/idle examples rejected | 3/3 | 3/3 |

The selected model returned no wrong known words in these normal/adverse groups.
Other turns were rejected. Two-hand frame coverage increased from60.0% to68.0%;
this is a detection-coverage proxy, not annotated detection accuracy. Mean
processing time rose from70.8ms to79.7ms per frame on the tested Iris Xe system.
The real-time report separately tests the app's recording window and frame pump.
That final real-time replay recognized33/38reserved word repetitions, with one
wrong word. The expanded model remains experimental rather than a validated
general-purpose translation model.

## Training and reproducibility

Camera adaptation uses85usable views of the original43TRAIN performances,
covering40lexical labels. The views reproduce the camera framing, light, blur
and speed conditions, then pass through the actual recovery tracker. One view
failed tracking/movement checks and was quarantined. View variants share their
original performance/source identity and never create independent test samples.

The second dictionary takes and existing regression clips remain excluded from
fitting, normalization statistics and calibration. The model combines the new
compiled gallery with a trained palm-shape/body-position classifier. The combined
decision rule is the evaluated model; the classifier alone has different results.
An actual refit after changing every evaluation vector and label verifies that
fitted weights, feature statistics and calibration remain numerically identical.

Artifact paths relative to `private-video-work/`:

- `tracking-v2/report.html`: per-word results and playable clips.
- `tracking-v2/comparison.json`: three-tracker, three-head comparison.
- `training-expanded-v2/camera/camera-comparison.json`: paired camera-model results.
- `training-expanded-v2/camera/leakage-check/report.json`: refit leakage verification.
- `training-expanded-v2/trained-sign-model.json`: portable local research bundle.

Run `node scripts/benchmark-hand-tracking.mjs` with the local preview running.
Training preparation uses `tools/video/prepare_simulation.py --split train`,
`scripts/export-camera-training.mjs`, and `tools/ml/train_skeletal.py` with the
camera experiment input/output paths. `scripts/report-tracking-upgrade.mjs`
requires a finished live replay with the selected model's exact hash.

Keep generated training views separate from the existing evaluation manifest:

```powershell
python tools/video/prepare_simulation.py --split train --out private-video-work/tracking-v2/training-videos
$env:LINGORA_SIMULATION_MEDIA='private-video-work/tracking-v2/training-videos'
$env:LINGORA_SIMULATION_OUTPUT='private-video-work/tracking-v2/training-features'
node scripts/simulate-sign-camera.mjs --skeletal --pixels-only --tracking-mode=recovery
node scripts/export-camera-training.mjs
python tools/ml/train_skeletal.py --input private-video-work/training-expanded-v2/camera/normalized-words.json --out private-video-work/training-expanded-v2/camera/skeletal
node scripts/evaluate-expanded-training.mjs --skeletal --root private-video-work/training-expanded-v2/camera
node scripts/evaluate-camera-adaptation.mjs
$env:LINGORA_SIMULATION_MEDIA='private-video-work/training-expanded-v1/simulation'
$env:LINGORA_SIMULATION_OUTPUT='private-video-work/tracking-v2/selected-live'
$env:LINGORA_CLASSIFIER_PATH='private-video-work/training-expanded-v2/camera/skeletal/candidate-model.json'
$env:LINGORA_GALLERY_PATH='private-video-work/training-expanded-v2/camera/baseline-model.json'
node scripts/simulate-sign-camera.mjs --skeletal --live-only --tracking-mode=recovery
node scripts/report-tracking-upgrade.mjs
```

These are previously inspected same-recording development tests. Numbers5/6
and all six existing script phrases have training-source replays only. Fresh
signer generalization and specialist semantic accuracy remain unverified.
The40-label trained bundle is local research; deployment vocabulary is unchanged.
