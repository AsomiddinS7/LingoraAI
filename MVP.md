# Lingora MVP

An experimental communication prototype for a limited Uzbek sign vocabulary and six supplied phrases, with speech/typed replies and TTS integration. Unrestricted signing and new-signer accuracy have not been validated.

## Run and deployment

Run `npm ci` and `npm run dev`, then open `http://localhost:5173/#/conversation`. For a built preview, use `npm run build` and `npm run start:local`, then open `http://localhost:8787/#/conversation`.

Compiled models in `public/model/` are tracked and bundled. New checkouts do not need private recordings to load them. Pages selects both model URLs and checks source/build hashes. Public speech uses the browser vendor unless an HTTPS Azure broker is configured. A static site cannot start local Python STT for visitors.

## Signing

Conversation supports **Salom, Xayr, Iltimos, Rahmat**. Start a turn, wait for the countdown, sign one word, then press **Done signing**. The normal window is capped at 3.5 seconds. **Signed speech** (`#/presentation`) matches six references from the existing presentation recording, one phrase at a time, with a 20-second limit.

Review a match before confirming it. Unsupported, ambiguous, or insufficiently tracked movements are rejected. Similarity is not a probability. Keep hands and shoulders visible; missing detections remain missing.

MediaPipe hands and pose run in VIDEO mode with monotonic timestamps and the same frozen image. On 217 controlled frames, the current setup detected at least one hand in 188 frames versus 171 with the earlier IMAGE setup, and both hands in 82 versus 66. CPU hand-model time was slower (183 ms versus 143 ms). These are visibility/performance observations, not language accuracy.

Research, matcher decisions, regression counts and limits are in [SIGN_MODEL_RESEARCH.md](docs/SIGN_MODEL_RESEARCH.md). Two reviewed Yo‘q training examples supply rejection-only references, without adding Yo‘q as an output word. This candidate correctly accepts 4/5 known regressions versus 3/5 previously, makes no wrong known acceptances, and rejects all five unknown regressions. These are previously inspected same-instructor clips, not general accuracy. No new signer recordings were collected.

## Speech

Press the microphone, speak, then press it again to request text. Local recordings automatically finish after 28 seconds. Processing remains visible until the response. Empty recognition and connection, language or microphone errors show guidance.

| Provider | Provisional word error | Provisional character error |
|---|---:|---:|
| NVIDIA Uzbek CTC ONNX with speech gate | 20.63% | 5.72% |
| Ovozify, own CTranslate2 int8 conversion | 23.81% | 8.47% |
| Chrome native, earlier run | 30.16% | 10.53% |
| Generic Whisper small, earlier run | 109.52% | 31.58% |
| Generic Whisper Turbo, earlier run | 84.13% | 25.17% |

These compare one existing 58.112-second recording against the intended script, not a verified verbatim transcript. NVIDIA took about 3.95 seconds and Ovozify 10.47 seconds. These are not general accuracy estimates. Neither model receives the script as a prompt.

The prepared local build can use NVIDIA on 127.0.0.1:8791. Installation and startup are in [tools/speech/README.md](tools/speech/README.md). Real MediaRecorder → local model → Chat checks passed with existing audio as a Chromium virtual microphone; physical-microphone acoustics remain untested.

Uzbek audio output needs an installed browser voice or configured Azure TTS. Audible Uzbek TTS remains unverified on this computer. See [SPEECH_SETUP.md](SPEECH_SETUP.md).

## Training and data

MediaPipe is a frozen pretrained estimator. The NumPy temporal candidate performed denoising pretraining and supervised finetuning but rejected all five known regressions, so it was not promoted. See [tools/ml](tools/ml/README.md). Training loss is not presented as deployment accuracy.

Public models contain normalized features without footage, audio, source filenames or absolute timestamps. Private reviews, source windows/hashes, raw landmarks, checkpoints and reports remain under ignored `private-video-work/`. Four-decimal quantization is checked for decision parity. See [model provenance](public/model/README.md) and [third-party notices](public/THIRD_PARTY_NOTICES.md).

## Verification and delivery

Run `npm test`, `npm run test:model-pipeline`, `npm run test:speech-readiness`, `npm run test:speech-server`, and `npm run build`. Public CI checks tracked assets, model contracts, private-file exclusion and built hashes. Local browser checks cover MediaPipe, decoding, camera lifecycle, confirmation and layouts. Source replay is a consistency check.

`npm run package:local` and `npm run package:archive` create a curated local delivery excluding credentials, recordings and downloaded speech weights. Deployment is checked against committed model bytes.

Further work needs expert review, signer-separated evaluation, physical phone testing, continuous signing, and verified Uzbek playback.
