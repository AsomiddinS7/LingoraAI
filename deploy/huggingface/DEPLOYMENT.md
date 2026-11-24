# Publish Lingora speech on Hugging Face

Target Space: `asomiddinsaidov07/lingora-speech`. The owner's public account was
found, but publishing requires an authenticated Hugging Face write token in the
local credential cache. Enter it only into the local HF login prompt.

From this repository in PowerShell, using the prepared test environment:

```powershell
.venv-hf/Scripts/hf.exe auth login
.venv-hf/Scripts/python.exe tools/speech/deploy_space.py --deploy
```

The helper checks that the authenticated account matches the Space owner, requests
only free `zero-a10g` hardware, and uploads an explicit source allowlist. It never
falls back to paid compute. A token with insufficient permissions or an eligibility
failure must be corrected on the owner's account; do not switch to paid hardware.

The uploaded package has already been exercised locally through the real Gradio
queue: both model health checks, confirmed synthesis/native audio playback, and
existing prerecorded microphone audio reaching Chat. Those CPU checks do not
verify ZeroGPU's cloud/CUDA runtime. Wait for the hosted Space to be RUNNING, then
repeat the model calls and browser test against its actual app URL:

```powershell
$env:LINGORA_SPEECH_SPACE_URL='https://asomiddinsaidov07-lingora-speech.hf.space'
node scripts/check-huggingface-speech.mjs
```

Only after hosted inference passes, set the GitHub Actions repository variable
`LINGORA_SPEECH_SPACE_URL` to the verified app URL and rerun the Pages workflow.
That variable is public configuration, never an HF token. Until it is configured,
the website retains its current browser speech providers. The Console's
Hugging Face choice gives a typed-message fallback when its URL is missing.

The Space contains speech inference only. The separate FastAPI account/admin
backend needs persistent PostgreSQL and a same-site authentication deployment;
see `docs/BACKEND_REVIEW.md`.
