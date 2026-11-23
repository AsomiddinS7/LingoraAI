# Lingora

An Uzbek-first communication prototype with camera-based sign matching, speech-to-text, typed replies, and text-to-speech integration.

The camera processes both hands and the upper body locally with MediaPipe. A temporal reference matcher compares each signing turn with a small set of reviewed video examples. This is an experimental, limited-vocabulary demo. It has not been validated as a general Uzbek sign-language translator or with new signers.

## Run locally

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173/#/conversation`. For the built preview:

```sh
npm run build
npm run start:local
```

Open `http://localhost:8787/#/conversation`. Prepared model assets are included in `public/model/`; no private recording is needed to load them. Camera and microphone capture require HTTPS or localhost and browser permission.

## Use the demo

1. Choose **Oʻzbekcha**, turn on the camera, and keep your hands and shoulders in view.
2. Press **Sign now**, wait for the countdown, sign one supported word, then press **Done signing**. Review a match before confirming it.
3. For the supplied six-sentence speech, open **Signed speech**, sign one complete reference phrase, and press **Finish and recognize**.
4. The hearing person can type a reply or press the microphone, speak, and press it again to request the transcript. Empty speech results and service failures show visible guidance.

The displayed sign vocabulary comes from the loaded model. Unsupported, ambiguous, or insufficiently tracked movements should be rejected. Similarity scores are distances to examples, not calibrated probabilities or accuracy percentages. The phrasebook and typed replies remain available when recognition fails.

## Speech providers

| Provider | Setup | Where inference runs |
|---|---|---|
| Browser speech recognition | Supported browser, microphone permission, internet; no project API key | Browser vendor service |
| Local NVIDIA Uzbek CTC | Python service and one model download; no paid API key | This computer |
| Local Whisper | Optional Python service and downloaded checkpoint | This computer |
| Azure Speech | Server-only Speech key/region and token broker | Azure |

GitHub Pages uses browser speech by default. It cannot start a Python service on visitors' computers. The prepared local build can use NVIDIA at `http://127.0.0.1:8791`; start that service separately as described in [local speech setup](tools/speech/README.md).

Uzbek audio output needs an Uzbek voice exposed by the browser or configured Azure TTS. STT success does not establish TTS playback. See [SPEECH_SETUP.md](SPEECH_SETUP.md) for measured STT comparisons, provider settings and the remaining playback checks.

## Configuration

Copy `.env.example` to `.env.local` and edit public build settings as needed. Console overrides are temporary and reset on reload. Rebuild after changing environment settings.

| Setting | Purpose |
|---|---|
| `VITE_RECOGNIZER=motion` | Temporal two-hand matcher |
| `VITE_MOTION_MODEL_URL=model/motion-model.json` | Vocabulary reference model |
| `VITE_SIGNED_SPEECH_MODEL_URL=model/signed-speech-model.json` | Six-phrase reference model |
| `VITE_STT_PROVIDER=browser-speech` | Alternatives: `local-stt`, `local-whisper`, `azure-speech`, `typed-input` |
| `VITE_LOCAL_STT_URL=http://127.0.0.1:8791` | Local NVIDIA endpoint, when explicitly selected |
| `VITE_TTS_PROVIDER=browser-synthesis` | Browser TTS; `azure-speech` is also available |
| `VITE_SPEECH_TOKEN_URL` | Public URL of a server-only Azure token broker |
| `VITE_LLM_PROVIDER=local` | Deterministic wording from confirmed labels |

Never put API keys in `VITE_` variables. `.env.local`, `.env.speech`, private videos, raw landmarks, research checkpoints, model downloads, and local output archives are excluded from Git.

The older optional [account/database backend](backend/README.md) is preserved separately. It is not required for the stateless camera/phrasebook demo or GitHub Pages.

## Checks and packaging

```sh
npm test
npm run test:model-pipeline
npm run test:speech-readiness
npm run test:speech-server
npm run build
```

`npm run test:browser` and `npm run test:presentation` exercise the real browser pipeline against existing private source videos. They need those files and installed browser tooling; private-data checks do not run as public CI accuracy tests. `scripts/check-local-stt.mjs` exercises MediaRecorder, real local STT, and Chat using an existing WAV as a virtual microphone.

`npm run package:local` prepares the built app, local server and speech setup tools. `npm run package:archive` creates a curated ZIP excluding credentials, recordings and downloaded speech weights.

## Research, models and deployment

- [Sign-model research and evaluation](docs/SIGN_MODEL_RESEARCH.md)
- [Model formats, provenance and notices](public/model/README.md)
- [MVP behavior and validation](MVP.md)
- [Existing-video preparation](tools/video/README.md)
- [Temporal neural experiment](tools/ml/README.md)

Pages checks the repository, tests the app, bundles both selected reference models, and deploys the static artifact from `main`. Azure speech can be selected through the repository variable `LINGORA_SPEECH_TOKEN_URL`, pointing to a public HTTPS token broker. Raw footage is never included in the static artifact.

Public demo: https://asomiddins7.github.io/LingoraAI/
