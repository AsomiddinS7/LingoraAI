# Existing video preparation

These tools inspect already available videos. They never collect a new camera
recording or infer sign meanings from gestures. Keep all generated files in
`private-video-work/` (gitignored), never in `public/`. Selected compiled inference
models are published separately after review and validation; see
`public/model/README.md`. Do not publish the raw extraction outputs.

The active camera now uses the `hands-pose-video-v1` browser tracking profile.
Prepare its references with `node scripts/prepare-tracked-models.mjs` using the
existing reviewed source windows. Results and hashes go to
`private-video-work/tracking-v1/`. Python IMAGE-mode extraction below remains
available for old experiments; its templates are not interchangeable with the
active VIDEO-mode pipeline. Matching thresholds remain fixed during preparation.

## Review footage

Requires the existing local Python environment with `opencv-python`, `numpy`, and
`mediapipe`. On this Windows machine those native packages require an approved
unsandboxed command because Application Control blocks their DLLs in the sandbox.

```powershell
python tools/video/prepare_sources.py inventory --source ../lingora-video-tools-v0.1 --out private-video-work --interval 30
python tools/video/prepare_sources.py contacts --video ../lingora-video-tools-v0.1/video_2026-11-17_18-25-35.mp4 --out private-video-work/contacts/greetings.jpg --start 603 --end 672 --step 0.5
```

The inventory records source SHA-256, duration, dimensions, cache coverage, and
local contact-sheet paths. `review.json` starts empty intentionally: fill each
label from the source's explanation/caption and mark a complete repetition's
actual movement boundaries. An on-screen title may remain visible during idle
or explanatory gestures, so the title's whole duration is not a training clip.

## Extract reviewed motion examples

Use `greeting-review.json` (local review artifact) or another reviewed manifest:

```powershell
python tools/video/extract_templates.py --video ../lingora-video-tools-v0.1/video_2026-11-17_18-25-35.mp4 --review private-video-work/greeting-review.json --models ../lingora-video-tools-v0.1/models --legacy-tool ../lingora-video-tools-v0.1/tools/video_landmarks.py --out private-video-work --fps 12.5 --local-experiment-only
```

`--local-experiment-only` permits preparing a private local experiment while
source reuse permission remains unresolved. It does not establish permission to
publish footage, landmark files, or trained assets. Remove that switch only when
the manifest contains confirmed permission evidence. Do not copy these examples
into the public build automatically.

Outputs match the browser parser in `src/ml/sequence.ts`:

- `templates-train.json`: complete labeled source repetitions.
- `templates-heldout.json`: different, non-overlapping complete repetitions.
- `templates-negative.json`: idle/unsupported movements for rejection evaluation
  only; `expected_none` is an expected result, never a training class.
- `extraction-report.json`: exact boundaries, caption evidence, source hash,
  tracking coverage, and roles.
- `reviewed-region.frames.json`: local hand/body landmark cache.

Frame timestamps retain **absolute source milliseconds**, enabling overlap checks.
The source filename stays identical across its repetitions. Never assign a new
source identity to an excerpt or count duplicated encodes of a lesson as new
people/sessions.

Evaluation is **same-signer, same-session held-out repetitions**. It provides no
estimate of unseen-signer performance. Do not tune thresholds on these held-out
repetitions and then report those same repetitions as an untouched test set.

The separate `prepare_sources.py export` command consumes existing landmark
caches and a `sources.json` / `review.json` pair. It requires reviewed labels,
confirmed source permission, isolated clips, adequate hand coverage, and cache
coverage of the full requested interval. Existing legacy caches cover only the
first minute of each video, so later sign demonstrations need fresh extraction.
