---
title: Lingora Uzbek Speech
emoji: "🗣️"
colorFrom: green
colorTo: blue
sdk: gradio
sdk_version: 6.32.0
python_version: 3.12.12
app_file: app.py
models:
  - algorithco/stt_uz_fastconformer_hybrid_large_pc
  - Inomjonov/tiny-voca-uzbek-navoiy
preload_from_hub:
  - algorithco/stt_uz_fastconformer_hybrid_large_pc model.int8.onnx,tokens.txt,NOTICE,README.md 1786554e0cdfacb8bf9076b4d9739cb81d2fbb2d
---

This Space provides Uzbek speech recognition and a synthetic Uzbek voice for
Lingora. Select **ZeroGPU** hardware using an eligible free account. The upload
helper explicitly requests only `zero-a10g`; it never selects paid hardware.

APIs use Gradio's official queued protocol: `/gradio_api/call/health`,
`/gradio_api/call/transcribe`, and `/gradio_api/call/synthesize`. Text/audio are
base64 JSON payloads, so inference does not need arbitrary file URLs or public
audio file paths. Gradio temporarily retains queue inputs/results in memory;
this is not a persistent account or transcript database. Free quota/queue delays
apply, and anonymous visitors have lower GPU quota than signed-in HF users.

STT uses the pinned NVIDIA CTC ONNX conversion on CPU, with the tested audio
leveling and speech gate. TTS uses the pinned Uzbek tiny-voca checkpoint. On
ZeroGPU, its CUDA weights load at startup and synthesis runs inside
`@spaces.GPU`; local tests use CPU. Local CPU tests cannot establish cloud CUDA
compatibility; actual model calls must pass after deployment.

See `runtime/MODEL_NOTICES.md` and the downloaded upstream license/NOTICE files.
This Space hosts speech inference, not Lingora's PostgreSQL account/admin API.
