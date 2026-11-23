# Local Uzbek speech recognition

## Recommended local demo: NVIDIA Uzbek CTC

The current local build selects `local-stt` at `http://127.0.0.1:8791`. It requires this separate Python service. No paid API key is required; model downloads need internet, and subsequent inference runs locally. This is turn-based recognition: stop the microphone to receive text. The NVIDIA backend supports **Uzbek only**; keep browser speech or Whisper for English/Russian.

From the project/package root in PowerShell:

```powershell
python -m venv .venv-stt
.\.venv-stt\Scripts\python.exe -m pip install -r tools\speech\requirements-candidates.txt
.\.venv-stt\Scripts\python.exe tools\speech\download_candidates.py --candidate nvidia-onnx
.\.venv-stt\Scripts\python.exe tools\speech\server.py --engine nvidia-ctc --port 8791 --warmup
```

The download helper fetches the pinned 174 MB community ONNX conversion of NVIDIA's Uzbek FastConformer CTC branch and writes a hash manifest. It never uploads audio. Startup resolves that pinned cache offline; missing weights require running the download command first. This conversion uses MatMul int8 and float32 convolutions; it is not the original default Transducer decoder. See [MODEL_NOTICES.md](MODEL_NOTICES.md) for NVIDIA attribution, OpenVoiceOS/Algorithco conversion credit, and CC BY 4.0 terms.

The NVIDIA wrapper uses Silero speech detection before decoding, because the ungated model produced a stray letter on silence. Speech detection suppresses non-speech turns; it does not replace words or add expected text. No presentation script is passed to recognition.

With this service running, open `http://localhost:8787/#/conversation`. For a source build, set `VITE_STT_PROVIDER=local-stt` and `VITE_LOCAL_STT_URL=http://127.0.0.1:8791` in `.env.local`, then rebuild. The legacy `local-whisper` provider name remains supported. To return to browser STT, select `browser-speech` in Console or change the build setting and rebuild.

On the existing 58.112-second recording, provisional comparison to the intended script gave NVIDIA 20.63% word error / 5.72% character error in 3.95 s including initial speech-detector work. Ovozify gave 23.81% / 8.47% in 10.47 s; the prior Chrome run gave 30.16% / 10.53%. Both free candidates returned empty output on one second of silence with detection enabled. These are single-recording comparisons, not general Uzbek accuracy estimates. Physical microphones and new speakers remain untested. Short-turn NVIDIA inference took 0.68–0.74 s for fixed 18–20 s clips in this run.

The actual production website was also tested with an existing lesson WAV as a Chromium virtual microphone: MediaRecorder sent 17.58 s to NVIDIA, the real HTTP response took 1.234 s, and the returned Uzbek text appeared in Chat without recognition mocks. This verifies the capture/inference/display path, not the accuracy of every returned word.

## Reproduce candidate benchmarks from the source checkout

`download_candidates.py` also supports the original `nvidia` and `ovozify` checkpoints. `convert_ovozify.py` converts the original safetensors locally to CTranslate2 int8 without training, using a separate environment with PyTorch, `transformers==4.57.6`, `safetensors`, and CTranslate2. Use `--source <original-snapshot>` and a new `--output <folder>`; `--runtime-site` can reference an existing CTranslate2 installation. It never overwrites a model folder.

Run `evaluate_free.py --candidate nvidia-onnx --model-dir <snapshot> --out <report-folder>` or `--candidate ovozify --model-dir <converted-folder>`. Evaluation reads cached model files and the existing private WAV, runs a complete-clip test, a silence test, and fixed 20-second turns, then scores the raw transcript. It never supplies the reference to either model. `--no-vad` preserves NVIDIA's ungated diagnostic behavior. `compare_free.py` checks source/reference hashes before comparing the saved runs. Reports and recordings are private and excluded from the delivery archive.

## Alternative: generic Whisper

This service transcribes real microphone audio with `faster-whisper`, independently of browser speech-recognition language support. It runs on the presenter's own computer; it is not a public hosted API. Audio and transcripts stay in memory and are never written to files or request logs. The first model download needs internet access. Subsequent inference can run offline from the model cache.

From the project root in PowerShell:

```powershell
python -m venv .venv-stt
.\.venv-stt\Scripts\python.exe -m pip install -r tools\speech\requirements.txt
.\.venv-stt\Scripts\python.exe tools\speech\server.py --warmup
```

The default is the multilingual `small` model on CPU using int8. Faster Whisper installs PyAV and its decoding libraries; a separate system FFmpeg executable is not required. Leave the process running while using Lingora. Health is available at `http://127.0.0.1:8790/api/health`. `--warmup` downloads/loads the model before accepting requests; without it, the first recording triggers model loading. Warm up before a presentation to avoid first-request timeouts.

For a larger multilingual model, use `--model large-v3-turbo` or set `LINGORA_STT_MODEL`. This requires a much larger download and more CPU memory and time. Recognition accuracy, particularly Uzbek, must be checked with real speakers and recordings; a successful API request does not establish language accuracy.

Frontend integration:

```ts
import { LocalWhisperStt } from './providers/localStt';
const stt = new LocalWhisperStt({
  url: 'http://127.0.0.1:8790',
  onStatus: status => console.log(status),
  onError: error => console.error(error.message),
});
await stt.start('uz', (text, final) => { /* show the actual transcript */ });
await stt.stop(); // Stops recording, submits audio, waits for final callback.
stt.cancel(); // Discards/aborts a turn on navigation/reset, including late permission grants.
```

Statuses: `idle`, `requesting-microphone`, `recording`, `processing`, `error`. Recording is turn based, not streaming: release/stop the microphone to get a transcript. Turns automatically finish after 28 seconds, leaving space for encoded frames under the server's 30-second bound. `onError` reports failures during automatic finalization; errors from an explicit `stop()` reject its promise. Silence produces an empty transcript, with no replacement phrase. No speech script is passed to the model.

The service binds only `127.0.0.1`. Frontend origins `http://localhost:5173`, `http://127.0.0.1:5173`, and the same hosts on ports 4173 and 8787 are allowed. Add a specific origin with `--allow-origin http://localhost:5174`. A hosted HTTPS frontend may require the browser's local-network permission. Run the frontend locally for the presentation if that permission or policy blocks the request. The service must run on the same computer as the microphone browser.

Protocol:

- `GET /api/health` returns `ok`, `provider`, `model`, `ready`, `loading`, `busy`, `load_failed`, supported `languages`, and `max_duration_seconds`. `ready: false` means no model has loaded yet.
- `POST /api/transcribe?language=uz` accepts binary WAV/WebM/MP4/Ogg data with its actual `Content-Type` and `Content-Length`. Languages: `uz`, `ru`, `en`. Maximum 10 MiB and 30 decoded seconds. A successful response has `text`, `language`, `duration_seconds`, `processing_ms`, `provider`, and `model`.
- Errors return `{error, code}` with HTTP 400 (invalid request), 403 (origin/host), 408 (upload timeout), 413 (size/duration), 415 (format), 422 (invalid audio), 503 (busy/model load failure), or 500 (inference failure). Only one inference runs at a time; additional concurrent turns receive 503. The browser times out transcription after 120 seconds by default. Aborting the request prevents a stale UI result; it does not forcibly interrupt already running CPU inference.

`create_server(..., engine=fake_engine)` supports protocol tests without loading ML packages. A fake engine supplies `health()` and `transcribe(payload, language)`. Browser provider tests use mocked microphones and HTTP results; those verify capture, transport, cancellation, and error handling, not model accuracy. Run a real spoken recording through the service separately before claiming STT works for the demo.
