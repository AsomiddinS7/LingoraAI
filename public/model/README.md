# Bundled recognition models

The website processes two hands and upper-body landmarks locally with MediaPipe.
Its default experimental model combines a compiled motion gallery with a trained
palm-shape/body-position classifier, using the same decision rule as the camera
replay evaluation. Scores are similarities, not calibrated probabilities.

| File | Role |
| --- | --- |
| `trained-sign-model.json` | Default: 48 Uzbek word labels, 101 camera-adapted references and fitted classifier coefficients. |
| `motion-model.json` | Legacy fallback: eight references for `hello`, `goodbye`, `no`, `please`, and `thank_you`. |
| `signed-speech-model.json` | Separate six-phrase presentation demo, `speech_01` through `speech_06`. |
| `hand_landmarker.task` | Google MediaPipe Hand Landmarker; detects up to two hands. |
| `pose_landmarker.task` | Google MediaPipe Pose Landmarker; supplies body normalization and wrist guidance. |

The trained bundle uses `lingora-trained-sign-bundle-v1`, feature version
`two-hand-body-v2` and tracking profile `hands-pose-recovery-video-v2`. The strict
parser in `src/ml/trainedSignModel.ts` checks its gallery, weights, movement gate
and exact Uzbek vocabulary. The gallery contains 32 frames and 128 features per
frame. Ambiguous motion matches are accepted only when the fitted classifier
agrees within the existing motion matcher acceptance radius. Stationary turns
are rejected using a floor fitted exclusively from training performances.
Editing/importing a legacy gallery removes the fitted head. The six-phrase model
keeps its own strict matching policy and never shares the word classifier.

**Measured scope.** Training uses 101 usable camera views of 51 existing training
performances, covering 48 words. Camera views are augmentations, not independent
participants. Reserved second takes remain excluded from fitting and calibration.
With recovery tracking, recorded-video checks recognized 34/40 nominal cases and
32/38 adverse cases, with no wrong accepted known word in these two groups; three
unknown/idle cases were rejected. A separate replay through the app's real-time
recording window returned 40/46 correct words, one wrong word and five rejections.
The eight added words scored 8/8 in both pixel conditions and 7/8 in real time.
Accuracy on new signers has not been established. These measurements do not
establish unrestricted Uzbek sign-language translation. Two number labels have
only training-source replays, and each presentation phrase has one source take.
See `docs/MODEL_AND_VOICE_V3.md` for procedures and limitations.

**Deployment.** GitHub Pages selects committed inference assets:

```dotenv
VITE_MOTION_MODEL_URL=model/trained-sign-model.json
VITE_SIGNED_SPEECH_MODEL_URL=model/signed-speech-model.json
```

Paths are relative for `/LingoraAI/`. CI validates the production parser and
48-word vocabulary contract, requires selected assets to be tracked and verifies
that built bytes match source assets. Model requests bypass the service-worker
cache. WASM is copied from the pinned MediaPipe npm package.

Run `node scripts/check-deployment.mjs` before building and add `--built` after
building with the public environment. Public hosting rejects local-only STT and
requires HTTPS for an Azure token broker. Browser STT is the Pages fallback and
may send audio to the browser vendor. Browser TTS needs a suitable voice exposed
by the visitor's device; these sign models do not supply an Uzbek speech voice.

**Sources and distribution.** Word references come from the project's existing
Uzbek lesson footage and internet dictionary workflow. The team supplied
[imo-ishora.uz](https://imo-ishora.uz/) as a lesson resource; expanded dictionary
entries are documented in `docs/DATASET_EXPANSION.md`. Presentation references
come from the recording supplied for this project. No source recording or audio
is published. Inference files omit raw landmarks, filenames, local paths,
absolute source timestamps and training/evaluation audit records. Normalized
motion features remain derived data; this does not establish anonymity or source
reuse permission. Source training/distribution rights and performer releases
have not been independently established, and no source endorsement is claimed.

**Third-party tracking assets.** MediaPipe is by Google/The MediaPipe Authors.
`@mediapipe/tasks-vision` 0.10.14 declares Apache-2.0. Its WASM and hand/pose assets
are tracking components, not Lingora-trained sign-language models. Preserve the
distributed `../THIRD_PARTY_NOTICES.md` and `../licenses/Apache-2.0.txt`:

- [MediaPipe source and license](https://github.com/google-ai-edge/mediapipe).
- [Hand Landmarker documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).
- [Pose Landmarker documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).

These notices do not license the separate lesson or participant footage.
Optional local ASR notices are in `tools/speech/MODEL_NOTICES.md`; those speech
weights are downloaded separately and are not bundled with the website.
