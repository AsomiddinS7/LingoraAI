# Sign recognition: research and evaluation

Reviewed 23 November 2026. This document separates published research, engineering choices, and measurements on Lingora's available footage.

## Scope and evidence

Lingora is a bounded reference-matching prototype for selected Uzbek signs and six supplied phrases. It uses frozen MediaPipe hand/body estimators, not a pretrained Uzbek sign-language translation model. Vocabulary examples come from reviewed lesson repetitions; speech examples contain one take per phrase. Existing known/unknown regression recordings have already been inspected during development. They are not an untouched test set, and source replay is only a pipeline consistency check.

No new participant recordings are collected. Duplicated encodes of a lesson are one source, not independent people or sessions. Synthetic timing/dropout perturbations test a mechanism; they do not establish real-world accuracy.

## Findings from primary sources

| Source | What it supports | Implication for Lingora |
|---|---|---|
| [MediaPipe Hand Landmarker documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web) | VIDEO mode tracks hands between frames; detection, presence, and tracking thresholds control different stages. Web inference is synchronous. | Keep monotonic timestamps, two-hand tracking, and a bounded frame pump. A higher camera FPS does not guarantee enough processed observations. |
| [Moryossef et al., CVPR Workshops 2021](https://arxiv.org/abs/2104.10166) | Pose features separate motion from appearance, but pose-estimation failures can remove information needed for sign recognition. | Treat missing landmarks as missing observations, preserve hand/body location, and reject insufficient evidence. |
| [Sarkar et al., November 2026 preprint](https://arxiv.org/abs/2611.16621) | Low-resource dictionary retrieval compares angle-DTW with pretrained cross-language pose encoders. Transfer performance varies across target datasets. | A foreign-language encoder is a candidate to benchmark, not an Uzbek label mapping or accuracy guarantee. This preprint does not evaluate Lingora's footage. |
| [OpenHands official repository](https://github.com/AI4Bharat/OpenHands) | Provides pose-based pretrained sign-recognition tooling across languages; the repository states it is no longer actively maintained. | Research reference for future transfer learning. Adoption needs runtime conversion, matching input conventions, checkpoint/data license review, and independent Uzbek validation. |

These sources motivate engineering directions. They do not supply performance estimates for this application.

## Current representation

Each bounded turn is resampled to 32 frames. Each frame has two hand slots, each containing a presence bit and 21 three-dimensional landmarks: 128 values in total. Both hands share a body-relative origin and shoulder scale; x and hand depth account for image aspect ratio. When body evidence is inadequate, the hand-only fallback is deliberately incompatible with body-relative templates.

Dynamic time warping preserves temporal order and uses forced endpoints with a 25% alignment band. Different word variants can retain separate references under one label. Rejection uses a fixed distance radius, minimum competing-label margin and distance ratio. Similarity is not a calibrated probability.

Whole-word mirroring and arbitrary rotation are not applied by default: they can change meaningful hand/body relationships. Movement-based trimming must not erase lexical holds or pauses inside a sign. A language model must not invent a translation when visual evidence is missing.

## Experiment policy

1. Freeze each candidate's mechanism before reading its regression outcomes. Do not select thresholds by searching the five already inspected known examples.
2. Compare real training repetitions with leave-template-out folds where a label remains represented. Report folds that cannot be evaluated.
3. Preserve unknown-sign rejection and no-hand handling. Show wrong acceptances separately from safe rejections.
4. Run controlled dropout, missing-hand overlap, timing and reversed-order tests. Count them separately from real performances.
5. Compare raw and compiled references and validate the actual browser path before promotion.

The earlier NumPy temporal neural experiment is retained in [tools/ml](../tools/ml/README.md). Its lower training loss did not translate to better accepted recognition: it rejected all five known regressions. It remains a research candidate, and no neural-training improvement is claimed for the deployed matcher.

## Release measurements

Baseline on the original small regression set: 3/5 correct known acceptances, no wrong known acceptances, two safe rejections, and 3/3 unknown rejections. Six speech-reference replays matched their source phrases; those are not held-out accuracy measurements.

The first visibility-aware candidate improved old known examples but failed a new unknown-sign check, so that four-class candidate was not selected. The selected candidate adds two caption-verified **No / Yo‘q training repetitions as rejection-only references**, while retaining four supported output words. Neither separate No regression repetition is added to training. These regressions have been inspected during development.

| Regression behavior | Original strict matcher | Visibility-aware matcher with rejection references |
|---|---:|---:|
| Correctly accepted supported signs | 3/5 | 4/5 |
| Wrong accepted supported signs | 0/5 | 0/5 |
| Rejected supported signs | 2/5 | 1/5 |
| Rejected unknown clips (three original + two No regressions) | 5/5 | 5/5 |

This is a small, same-instructor/session regression comparison. It is not an 80% general-recognition claim. Negative training clips are checked separately for source consistency and never counted as held-out success. The extra word is not exposed as a supported sign, proposed translation, or recognition alternative.

The distance rule retains observed-joint geometry, uses a visibility-disagreement cost of 0.22, gives fully unobserved frame pairs a 0.44 cost, and requires at least 60% shared-hand observations along alignment. The original 0.22 acceptance radius, 0.025 ambiguity margin, 0.85 ratio, 32 frames, temporal band and duration penalty remain unchanged. No coordinates are synthesized.

An explicit model manifest names the reviewed labels and every reference ID. Missing/extra references, missing variants, or incompatible coordinates disable visibility-aware matching. Custom imports use strict matching by default. Editing a dictionary with rejection references explicitly switches its metric to strict DTW while preserving the background-denial policy; background movements must never silently become translated words.

Source/build hashes, raw/compiled parity, quantization parity, missingness/timing tests and browser checks accompany promotion. Private clips, source windows/hashes and raw landmarks stay under `private-video-work/`. Public assets contain normalized inference features and reference identifiers, without footage or source paths. The six-phrase model retains strict DTW and its existing references.

## What remains

Generalization to new signers, camera viewpoints, lighting, dialects and natural continuous signing remains unmeasured. Larger vocabulary and unrestricted translation require a properly labeled, diverse dataset and signer-separated evaluation. Facial and non-manual information are not modeled by the current matcher. Physical phone testing and expert review are still needed beyond this MVP.
