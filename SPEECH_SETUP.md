# Uzbek speech setup

Run build/configuration commands from the full source checkout. The prebuilt local
archive runs the existing build; changing its build-time provider URLs requires a
rebuild from source. Server credentials stay separate from the frontend build.

Current recorded-audio checks compare one existing 58.112-second presentation with
the intended script, which is not a manually verified verbatim transcript:

| Provider | Provisional word error rate | Provisional character error rate |
|---|---:|---:|
| NVIDIA Uzbek CTC ONNX + speech detection | 20.63% | 5.72% |
| Ovozify Whisper Small, own int8 conversion | 23.81% | 8.47% |
| Chrome native Uzbek | 30.16% | 10.53% |
| Local Whisper small | 109.52% | 31.58% |
| Local Whisper large-v3-turbo | 84.13% | 25.17% |

WER can exceed100% when insertions/splitting add errors. These figures do not mean
general language accuracy or physical microphone validation. Raw outputs were not
corrected to match the expected script. NVIDIA CTC with speech detection is now
the local demo default on port 8791. Both new free candidates passed the silence
check with detection enabled. Generic Whisper/Turbo remain optional experiments.
NVIDIA processed the full 58.112 s recording in 3.95 s, Ovozify in 10.47 s.
The original NVIDIA default Transducer decoder was not benchmarked; these figures
refer to the community CTC ONNX conversion. Azure and audible Uzbek TTS still
need live validation with configured credentials.

Lingora supports `local-stt` for the tested local NVIDIA Uzbek service; see [tools/speech/README.md](tools/speech/README.md) for installation and startup. It needs no paid API key. The microphone-to-Chat flow passed in the production preview with an existing lesson recording as the Chromium virtual microphone (17.58 s capture, 1.234 s processing). `browser-speech` remains available through the browser vendor; `local-whisper` is the legacy local-service option; `azure-speech` uses the Azure token broker. These choices do not change sign recognition or train the hand movement model.

Browser TTS needs a matching Uzbek voice exposed by the actual browser. Check it before relying on playback; do not infer availability from the operating system or a successful STT test. Azure TTS provides named Uzbek voices independently of the browser's voice inventory.

**What Azure supports.** Microsoft currently lists `uz-UZ` (Uzbek, Latin, Uzbekistan) for real-time speech recognition and the standard neural voices `uz-UZ-MadinaNeural` (female) and `uz-UZ-SardorNeural` (male). Lingora currently selects Madina in `SPEECH_VOICES` in `src/providers/azureSpeech.ts`; there is no voice-selection environment variable. Selecting Sardor requires changing that mapping. Confirm the desired provider and voice before configuring a live deployment. [Microsoft language and voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)

Create/use an Azure **Speech** resource with real-time transcription and neural TTS available in its region. Copy the resource's region identifier, such as `westeurope`, rather than its display name or full endpoint. Its key and region must belong to the same resource: a different region causes authentication errors. The existing broker targets public Azure; custom private endpoints and sovereign Azure clouds need additional integration. [Microsoft Speech regions](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions)

**Inspect the current setup without using Azure.** From the project root, using Node 22+:

```powershell
node scripts/check-speech-readiness.mjs
node --test tests/speech-readiness.test.mjs
```

The diagnostic reads `.env.speech`, `.env.local`, and process environment variables, reporting presence/format flags without printing their values. It makes GET requests only to local health endpoints by default. It does not request an Azure token, transcribe, synthesize, save audio, or change configuration. A key shape check cannot prove authentication or resource compatibility.

Browser voice enumeration is a separate opt-in check; it does not speak or request microphone access:

```powershell
node scripts/check-speech-readiness.mjs --browser-voices --channel chrome
```

`not_queried` means unknown. `queried` reports voices exposed to this headless browser runtime; another browser profile/device can differ. No Uzbek voices in that queried runtime means browser Uzbek TTS cannot be relied on there. Use the website on the presentation computer to confirm actual audible playback.

**Configure Azure locally.** If `.env.speech` does not exist, copy `.env.speech.example` to `.env.speech`. Edit the file locally; do not paste the key into chat, frontend code, screenshots, or `VITE_` variables. Keep `.env.speech` uncommitted. Set these existing server variables:

```dotenv
AZURE_SPEECH_KEY=<your Speech resource key, server only>
AZURE_SPEECH_REGION=<matching resource region identifier>
SPEECH_PORT=8787
SPEECH_HOST=127.0.0.1
SPEECH_SERVE_DIST=true
SPEECH_PUBLIC_ORIGIN=http://localhost:8787
SPEECH_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173,https://asomiddins7.github.io
```

Update only the relevant lines in the existing `.env.local`, preserving model URLs and other project settings:

```dotenv
VITE_STT_PROVIDER=azure-speech
VITE_TTS_PROVIDER=azure-speech
VITE_SPEECH_TOKEN_URL=http://localhost:8787/api/speech-token
```

You can choose Azure TTS while retaining `VITE_STT_PROVIDER=browser-speech` or `local-stt`. `VITE_SPEECH_TOKEN_URL` is a public broker URL, never a subscription key or bearer token. Azure Speech calls use the real broker independently of the app's mock sentence/API switch.

Build and serve the application with the existing local command:

```powershell
npm run build
npm run start:local
```

Open `http://localhost:8787/#/conversation`. For Vite development, restart the dev server after changing environment settings and keep the broker running separately on 8787. Its allowed origins must include the exact frontend origin and port.

After the configured broker is running, explicitly test authorization:

```powershell
node scripts/check-speech-readiness.mjs --live
```

`--live` fetches an authorization token through the existing broker, validates its shape/expiry, and discards it without logging. It does not generate speech or prove STT/TTS quality. It is blocked if configuration is incomplete, transport is unsafe, or a credential is placed in frontend configuration. `health.broker.speechConfigured` describes the running server; environment flags describe this terminal's configuration, which may differ until the server is restarted.

Then test both directions on the presentation computer: start the microphone, say a short Uzbek sentence, stop, and inspect the actual Chat text; confirm a signer message and verify audible Uzbek playback. Token authorization, SDK unit tests, and voice inventory alone do not establish successful playback or recognition quality.

**Keep local Whisper as an option.** Follow `tools/speech/README.md` to install and start `tools/speech/server.py --warmup`. Set `VITE_STT_PROVIDER=local-whisper` and `VITE_LOCAL_STT_URL=http://127.0.0.1:8790`. The readiness diagnostic reads `/api/health`; check `ready: true`, `loadFailed: false`, and `supportsUzbek: true`. Loading, busy, or failed status needs to be resolved before presenting. These health flags do not measure Uzbek transcription accuracy. This service runs on the same computer as the browser; the public website does not install or start it for visitors.

**Use a public HTTPS broker for the public website.** GitHub Pages serves static frontend files and cannot run this Node token broker. Deploy `scripts/speech-server.mjs` to an HTTPS server you control, supply the Azure credentials in that server's secret settings, and build the public frontend with an absolute URL such as `VITE_SPEECH_TOKEN_URL=https://your-broker.example/api/speech-token`. A localhost broker URL points to each visitor's own computer and is not public deployment configuration.

Set `SPEECH_PUBLIC_ORIGIN` to the broker's exact public origin, preserve the public Host header through the reverse proxy, and allow only your frontend origins in `SPEECH_ALLOWED_ORIGINS`, including `https://asomiddins7.github.io`. Configure a suitable public listen host on that server. No credentials belong in GitHub Pages frontend variables or its generated JavaScript. Deploying a publicly reachable token endpoint also requires appropriate hosting/access controls for the audience and usage you intend.

To test the hosted broker explicitly, use the frontend's allowed origin:

```powershell
node scripts/check-speech-readiness.mjs --live --origin https://asomiddins7.github.io
```

Run this after the terminal's `VITE_SPEECH_TOKEN_URL` or `.env.local` points to the intended hosted broker. The report deliberately omits endpoint values, keys, tokens and raw server errors.
