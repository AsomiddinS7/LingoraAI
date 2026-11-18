# Lingora: web app (handoff README)

Builds the website and its mock services from *SignConnect Web Developer Brief v0.2*.
The team plugs in the AI parts (classifier, Azure Speech, backend) without changing the UI.

**Preview link:** https://asomiddins7.github.io/LingoraAI/ (GitHub Pages, redeployed on every push to `main`)
**Contract version:** API section 7 of brief v0.2, unchanged.

## Run in mock mode (no keys, no backend)

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 51 tests: API schema, state machine, phrasebook, language files, config
npm run build      # tsc + vite build into dist/
```

Mock mode is the default. Every `/api/*` call is answered by the in-browser mock server
(`src/api/mockServer.ts`), and the sign classifier is a mock that never reads video pixels.
The camera needs HTTPS or `localhost`. The Claude desktop browser pane blocks the camera, so use Chrome, Edge or Safari.

> Windows on ARM: `package.json` overrides `rollup` with `@rollup/wasm-node`, so the build
> does not need the Visual C++ runtime. You can remove the override on other machines.

## Config switches (brief section 2)

Set at build time in `.env` (copy `.env.example`). You can override them at runtime in **Console → Feature switches**.
The overrides live in memory, so a reload restores the build values. No code change is needed (U7).

| Switch | Values | Plan A | Plan B (default) |
|---|---|---|---|
| `VITE_STT_PROVIDER` | typed-input, browser-speech, azure-speech | azure-speech | typed-input |
| `VITE_TTS_PROVIDER` | browser-synthesis, azure-speech | azure-speech | browser-synthesis |
| `VITE_FACE_HINTS` | on, off | on | off |
| `VITE_LLM_PROVIDER` | azure-openai, mock | azure-openai | azure-openai |
| `VITE_MOCK_AZURE` | true, false | false in demo | true |
| `VITE_SIGN_CLASSIFIER` | mock, model | model | mock |
| `VITE_DATA_COLLECTION` | consenting-teammates, tutor-confirmed | | consenting-teammates |
| `VITE_CONFIDENCE_THRESHOLD` | 0..1 | | 0.80 |
| `VITE_API_BASE` | backend origin | | same origin |

Missing or unknown values fall back to Plan B ("silence counts as no").

## Adding a real provider

The UI imports only the interfaces in `src/types.ts`. The registry in `src/providers/index.ts` picks the implementation.

- **SignClassifier:** put `public/model/classifier.js` exporting `createClassifier()` (see `public/model/README.md`) and set `VITE_SIGN_CLASSIFIER=model`. If it fails to load, the app shows the "model failed" state, and phrases, typed text and read aloud keep working (N2).
- **Azure Speech (STT/TTS):** call `registerProvider('stt', () => new AzureStt())` and `registerProvider('tts', ...)` at startup, for example from a new `src/team/index.ts` imported in `main.tsx`. Get tokens with `backend.speechToken()` (`GET /api/speech-token`) and cache them for less than `expires_in_s`.
- **Backend:** set `VITE_MOCK_AZURE=false` and `VITE_API_BASE`. Responses are validated against the contract (`src/api/validate.ts`). An invalid answer shows a visible error.
- **Face hints:** replace `mockFaceHints` in `src/providers/index.ts` with a real `FaceHintProvider`.

## Lingora Platform v1: status

Following *Lingora Platform v1: design and architecture changes*, **build step 2 (user app on mocks) is done** and is live:

- **Design system (§9).** Spec tokens, light and dark themes (Profile → Theme), type scale 14–32 with 18 px minimum user text, radius 8 and 12, reduced motion.
- **Screens (§9).**
  - Welcome, shown on the first visit.
  - Conversation: on phones the camera is on top; on desktop it is two columns.
  - Phrasebook grid: tapping a phrase speaks it.
  - Contribute, and Profile and privacy.
  - Help and limits.
  - Sign in / Register: the form is ready, and it says honestly that the server is not connected.
- **Sign window (§8).** It runs `idle → countdown → recording → processing → result`:
  - The countdown and recording show progress rings.
  - Recording ends when the hands rest for 0.5 s, or after 3.5 s at most.
  - The result shows the best sign, up to 2 alternatives, and confidence in words plus a number.
  - The signer chooses Confirm, Confirm and add a sign, Pick another, or Try again.
  - All timings are in `config.signWindow`. A watchdog timeout stops a window that hangs.
  - Nothing is spoken before the signer confirms.
- **Recognizer switch.** `recognizer = sequence | static | mock` (`VITE_RECOGNIZER`):
  - `sequence`: the ML team's model, loaded through `GET /api/model/active`. The manifest is checked against its sha256, and the entry module must export `createSequenceRecognizer()`.
  - `static`: v0, MediaPipe plus k-NN.
  - `mock`: runs the whole app with no model.
- **Data from the API.** Signs come from `GET /api/signs?scenario=greeting` and phrases from `GET /api/phrasebook`. The seeds live in `src/api/seed/` and mirror the database seed.
- **Other v1 behaviour.**
  - One-tap feedback goes to `POST /api/feedback`.
  - The guest name for `my_name` is sent as the optional `name` field on `/api/sentence`.
  - The new error codes are supported.

**Not done yet:** the backend and everything that needs it, which is build steps 1 and 3–8. That covers the FastAPI server, PostgreSQL, auth, consents, the audit log, the admin dashboard, clips, the model registry and hardening. Hosting and the database are still open decisions (§14). Until the server exists, the mock server answers the account endpoints with `503 NOT_AVAILABLE`; it never fakes accounts.

## Real recognition (MediaPipe)

`signClassifier = mediapipe` (the default on the live GitHub Pages site) gives real, on-device recognition:

- **Hand tracking:** MediaPipe Hand Landmarker (`@mediapipe/tasks-vision` 0.10.14). It uses the GPU and falls back to the CPU, and finds 21 landmarks per frame. The WASM runtime (`public/mediapipe`, copied by `scripts/copy-mediapipe.mjs`) and the model (`public/model/hand_landmarker.task`) are served from this site, with no CDN. They load only when recognition starts, and a warm-up pass runs during loading.
- **Recognition:** a k-NN classifier (`src/ml/knn.ts`) over normalised landmarks (`src/ml/features.ts`). It is trained on samples recorded in **Console → Data collection and training**, which keeps landmarks only, never video, in memory, with export/import as JSON. With no samples it recognises nothing. A hand pose far from every recorded sign returns `none` and is not guessed.
- **Speed:** the frame pump processes the newest frame only (no backlog, max 30 fps). A sign must agree on at least 3 frames and be held 150 ms (`src/ml/stability.ts`), and it fires once per hold. The gesture gate blocks repeats.
- **Accuracy:** the Evaluation card measures it by leaving whole recordings out. This uses the same signer, so it is optimistic and is not the brief's unseen-signer test.

Measured in headless Edge, which uses software WebGL, on real hand photos (`thumb_up`, `victory`, `pointing_up` from MediaPipe's test assets):
the two trained signs were told apart correctly, the untrained pose was not labelled, about 20 frames were analysed per second at 33–41 ms per frame, a held sign took 241–294 ms to be recognised, and it took 17–23 ms to appear on screen. A phone with a hardware GPU should be faster, but this has not been measured yet.

## Mock fixtures (Console → Mock API answer)

| Fixture | Result |
|---|---|
| success | 200, `[PLACEHOLDER]` sentence in the request language built from the sign glosses |
| refused | 200, `status: refused`, `reason: out_of_scope`, `needs_human: true` |
| validation_error | 400 `BAD_REQUEST` (real validation also runs: 1–5 signs, vocabulary labels, 0–1 confidence, 300-char simplify text) |
| timeout | no answer, so the 8 s client timeout fires, the request is retried once, and then an error is shown |
| upstream_error | 502 `UPSTREAM_ERROR` (retried once) |
| rate_limited | 429 `RATE_LIMITED` with `retry_after_s: 10` (not retried) |
| cap_reached | 429 `CAP_REACHED` |

Mock calls wait 300–800 ms so the loading states are visible. The Console can also simulate a classifier load failure, denied camera permission and offline mode, and emit mock face hints.

## Where things are

```
src/types.ts                 data model + provider interfaces (sections 6, 11)
src/config.ts                config object, Plan A/B
src/api/                     client (timeout/retry), contract validators, mock server, fixtures
src/providers/               mock classifier + /model loader, browser TTS, mock/browser STT, registry
src/state/machine.ts         conversation state machine (section 10), pure reducer
src/screens/                 Sign (A), Conversation (B), Console (C), Text to speech, Phrases, About
src/data/                    vocabulary.json, phrasebook.json, console-sample.json (all placeholders)
src/i18n/                    uz / ru / en language files (ru, uz are draft translations)
public/                      manifest, service worker, icons, /model folder
```

## Deploy the preview

You can use Netlify (`netlify.toml`) or Vercel (`vercel.json`). Both build with `npm run build` and serve `dist/`.
GitHub Pages also works because the app uses relative paths and hash routing.
The configs set a strict Content-Security-Policy.

## Known gaps and open items

- `[CONFIRM]` items are built as Plan B with TODOs: UI languages, sign language variety, interpreter contact, test phone model and final hosting.
- The vocabulary, phrasebook, fixture sentences and the ru/uz translations are placeholders for the team to replace.
- Read aloud depends on the voices installed on the device. Many phones have no Uzbek voice, so the app shows the text and says so.
- `browser-speech` STT is experimental. Some browsers send audio to their vendor, and the UI warns about this.
- The Console data collection buttons are display-only until the team's tool is wired in. Evaluation and cost values show "awaiting team results".
- Not tested yet on physical Android or iOS devices (U5).
- The real camera has not been tested in the desktop browser pane, which blocks camera access. A synthetic stream was used instead.
