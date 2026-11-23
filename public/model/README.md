# Bundled recognition models

The current app uses `VITE_RECOGNIZER=motion`. It processes two hands and upper-body
landmarks locally with MediaPipe VIDEO tracking, then compares a normalized sequence
against compiled reference features. It does not load a `classifier.js` plugin.

| File | Role |
| --- | --- |
| `motion-model.json` | Six positive references for `hello`, `goodbye`, `please`, `thank_you`, plus two rejection-only `no` references. |
| `signed-speech-model.json` | Six phrase references, `speech_01` through `speech_06`, for the supplied presentation. |
| `hand_landmarker.task` | Google MediaPipe Hand Landmarker; tracks up to two hands. |
| `pose_landmarker.task` | Google MediaPipe Pose Landmarker; supplies body normalization and wrist assignment. |

Both sign models use `format: "lingora-motion-model"`; the vocabulary model uses
version 2 for its explicit rejection policy, while the legacy speech model uses version 1,
`feature_version: "two-hand-body-v2"`, 32 input frames and 128 features per frame.
Each reference has an ID, label and normalized features, including duration and hand
coverage. The production parser in `src/ml/sequence.ts` validates the contract.
The vocabulary model also declares `matching.profile`, `labels`, `templateIds`
and `rejectionLabels: ["no"]`. Rejection references compete during matching but
never become output words or recognition alternatives; four words remain supported.
The visibility-aware rule requires the complete declared gallery and compatible
coordinates. Custom/edited dictionaries fall back to strict DTW; edited negative
dictionaries preserve rejection policy with the explicit `strict-dtw-v1` profile.
The six-phrase model retains strict matching. See `docs/SIGN_MODEL_RESEARCH.md`
in the repository for the small regression comparison and the discarded candidate.
Publication files omit raw frames, source names, local paths, permission annotations,
absolute video timestamps and audio. Normalized motion features are still derived
data; removing source metadata does not establish anonymity or reuse permission.

**Deployment.** GitHub Pages builds select the committed assets with:

```dotenv
VITE_MOTION_MODEL_URL=model/motion-model.json
VITE_SIGNED_SPEECH_MODEL_URL=model/signed-speech-model.json
```

These paths are relative so they work under `/LingoraAI/`. Vite copies this directory
to `dist/model`; CI requires all four files to be tracked and verifies that the built
bytes match the selected source files. MediaPipe WASM is copied from the pinned npm
package by `scripts/copy-mediapipe.mjs`. Model requests bypass the service-worker
cache so replacement model files are fetched again. A fresh checkout must contain
the selected compiled models; local ignored training files cannot supply a CI build.

Run `node scripts/check-deployment.mjs` before building, and
`node scripts/check-deployment.mjs --built` after building with the intended public
environment. The checker rejects local-only STT providers for the public website and
requires HTTPS for an Azure token broker. Browser STT is the Pages fallback and may
send microphone audio to the browser vendor. Browser TTS still depends on an Uzbek
voice exposed by that device; publishing these sign models does not provide one.

**Provenance and measured scope.** Greeting references were derived from existing
Uzbek sign-language lesson footage used in the team's local lesson workflow. The
user supplied [imo-ishora.uz](https://imo-ishora.uz/) as the lesson resource. This is
source acknowledgement, not a claim that the site endorsed Lingora or licensed model
redistribution. Lesson model-training/distribution permission has not been independently
established. Six separate presentation phrase references come from the existing
recording supplied for this project. This repository does not publish that recording
or its audio, and does not assert a broader source license or performer release.

The greeting demo has four supported labels and two rejection-only `no` examples;
the positive No class was not promoted. Every reference change needs regression
and unknown-rejection checks. The presentation
demo has one source take per phrase. Replaying source clips checks extraction and
packaging consistency; same-signer held-out repetitions are limited regression
evidence. Neither establishes accuracy with new signers or unrestricted Uzbek sign
translation. Similarity scores are not calibrated probabilities. Keep new training
and evaluation data separate, preserve their private provenance, and promote model
changes using the documented regression and unknown-rejection checks. See `MVP.md`
in the repository for the current measurements and experiment history.

**Third-party tracking assets.** MediaPipe is by Google/The MediaPipe Authors. The
application uses `@mediapipe/tasks-vision` 0.10.14, which declares Apache-2.0, and
redistributes its WASM runtime plus the hand and pose tracking assets. The tracking
weights are not Lingora-trained sign-language models. Preserve the corresponding
license and attribution notices with redistribution:

- [MediaPipe source and license](https://github.com/google-ai-edge/mediapipe).
- [Hand Landmarker documentation and model information](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).
- [Pose Landmarker documentation and model information](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).

These upstream notices do not grant rights to the separate lesson or participant
footage. Optional local ASR checkpoint notices are in `tools/speech/MODEL_NOTICES.md`;
those spoken-language weights are downloaded separately and are not bundled here.
The deployed artifact also includes `../THIRD_PARTY_NOTICES.md` and
`../licenses/Apache-2.0.txt`; deployment checks require these files and verify that
their built copies match the committed public originals.
