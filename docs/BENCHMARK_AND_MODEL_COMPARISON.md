# Benchmark and model comparison

This research is not a product accuracy claim. The existing recordings have been
used in previous development; signer identities and semantic equivalence remain
unverified. No release candidate has passed an independent-signer or phone test.

## Inventory and split integrity

`tools/ml/build_sign_benchmark.py` creates a private inventory from existing
annotations and replay manifests. It records source IDs/hashes, source start and
end times, available labels, prior roles and replay links, and keeps augmented
views of the same interval together. It includes the round-video phrases and
three negative/rest examples. The six phrase boundaries were inferred partly
from audio and do not independently verify signed meaning.

The current inventory contains 102 physical word/unknown intervals, six phrase
intervals, 49 word/unknown labels and 33 source recordings. It links 59 prepared
replay clips; `tools/ml/audit_benchmark_media.py` verified the hashes, decoding
and approximate duration of all 59. The remaining inventory entries do not
necessarily have a separately prepared replay file. These checks do not verify
sign meaning or the exact boundaries.

The inventory groups unverified dictionary signers conservatively and reports
four session groups. The two named lesson groups have no shared word labels;
the Salom/Xayr/Iltimos examples originate in the same lesson session. Therefore
there is not enough known, overlapping signer/session data here for an honest
signer-independent trial of those words. The published classifier has already
used material from these sources. No split is assigned as a final test.
`audit_split` rejects session/source cross-split leaks and, by default, unknown
signer identities. A true signer-independent split additionally requires verified
identities and suitable matching labels across independent people.

## Same-video comparison: Lingora and UzSLR

`evaluate_uzslr_stream.py` follows the upstream web backend's 32-consecutive-frame
buffer, both-hands start gate and five-frame disappearance tolerance. It runs
Python MediaPipe Holistic on every decoded frame with the existing 50-class
checkpoint; the real upstream website uses its JavaScript Holistic client and
WebSocket timing. The Lingora result is a previously saved browser replay of
the same clip, with its actual motion recognizer. `compare_sign_replays.py`
checks that paired clip hashes and annotations match. The models use different
landmarks, frame selections, vocabularies and decision rules, so this is a
diagnostic comparison, not a controlled head-to-head accuracy score.

| Source clip | Lingora browser replay | UzSLR offline web-gate replay |
| --- | --- | --- |
| Xayr | **Wrong accepted word: Salom** | oxiri, yomg'ir |
| Salom | Rejected as ambiguous | turish, turish |
| Iltimos, chest | Iltimos | bo'sh, qo'ziqorin |
| Iltimos, palms | Iltimos | iltimos |
| Resting hands | Rejected | bo'sh, bo'sh |
| Unrelated movement 1 | Rejected | bahor, o'ynash, assalomu_alaykum |
| Unrelated movement 2 | Rejected | toza |

Each UzSLR word in a cell is the top result of a separate 32-frame window.
Its vocabulary does not contain Lingora's Xayr class; the relationship between
its greeting class and the lesson's Salom has not been verified. UzSLR's output
is closed-set: scores are not calibrated and no unknown gate was added. In
particular, an unrelated movement produced a greeting label, so do not deploy
this checkpoint as an unrestricted translator. The tested upstream checkout is
`23c8bdcac9fedde497626656d3656e8ff7477208`; licensing was not established.

As a positive control, `evaluate_uzslr_controls.py` also ran the checkpoint on
three 32-frame videos published in its own repository. When each whole clip was
presegmented and fed to the model, the top labels matched the published labels
for Iltimos, Assalomu alaykum, and Yordam berish. The streaming two-hand gate
did not accumulate a 32-frame window on any of those three short clips. The
clips could overlap the checkpoint's training data, and this Python replay is
not its live JavaScript app; these observations are not independent accuracy
or a claim that the authors' complete system fails. They show that capture
behavior must be evaluated separately from classification.

## Capture sensitivity

`scripts/evaluate-capture-cuts.mjs` reuses the exact browser-replay landmarks,
then removes saved frames from the beginning or end. On four known clips and
three negative clips, the original windows gave 3 correct, 1 rejected, 0 wrong,
and 0 negative false accepts. Removing the first 500 ms yielded 4 correct and
0 false accepts on those same clips. This was observed after inspecting these
cases and is not evidence for deploying a new cut or timing threshold. A later
start can omit a real sign. Removing saved landmarks is not a fresh camera run.

A second, broader saved replay has three active-vocabulary examples and 52
out-of-scope inputs (other words, phrase clips and rest; many are related to
training sources). The original frames produced 1 correct and 2 rejections for
the three active words, with no accepted output among those 52 inputs. Simulating
a one-second late start changed a Salom example into the wrong accepted word,
Iltimos. These are previously used clips with correlated sources and cannot
estimate false-accept rates in the wild; the result is a regression warning,
not a statistically representative score.

The saved browser replay's median frame spacing was approximately 77–95 ms
(roughly 10–13 observations/s), depending on clip. Any-hand coverage was high,
while both-hand coverage was as low as 24% on the palms variant. Observed frame
span alone does not identify where the true movement started or stopped.
Phone FPS, live end-to-end latency, actual framing and independent signer
recognition still need direct measurement.

The newly instrumented seven-clip browser replay aligned every retained frame
with the video time sampled before tracking. In this run the first and last
captured frames bracketed the existing annotated interval in every clip, while
Xayr was still accepted incorrectly as Salom and Salom was rejected. Bracketing
does not guarantee sufficient frames within the sign or validate the annotated
boundaries. The replay starts capture immediately and ends with the video; it
does not measure a person's reaction to the app's normal countdown.

An additional experiment starts the replay while the app's one-second countdown
is still running. The current recognizer missed approximately 0.80–0.84 seconds
of the annotated interval in all seven cases. An opt-in `captureCountdown`
candidate kept countdown frames and bracketed the annotation start in all seven.
Both runs produced 2 correct, 2 rejections and no wrong accepted words among
four known examples, and rejected all three negatives. The two runs used the
same videos, not identical tracker observations. Because this is a small,
previously used corpus and results vary between replays, the candidate is
**disabled by default**; it has not passed an independent or physical-phone
release test. Frame bracketing does not establish semantic boundary correctness.

A second synthetic scenario prepended a one-second frozen frame before each
sign, representing a rough approximation of waiting through the countdown. In
separate sequential replays, the current capture returned 3 correct and 1
rejection on the four known cases; the countdown candidate returned 1 correct,
1 wrong accepted word (Xayr→Salom), and 2 rejections. Both rejected all three
negative clips. Tracker observations differ between runs, and the frozen frame
is not a real waiting person, so the test cannot isolate causality. It is a
failed promotion check for this candidate, not proof that a countdown buffer is
intrinsically unsafe. Do not enable it from these results.

## Uni-Sign feasibility

The official [Uni-Sign repository](https://github.com/ZechengLi19/Uni-Sign)
was inspected at `eed438bcb49e30405cd6ccdfcccca330c134e830`. Its online example
uses RTMPose whole-body keypoints, an mT5 model and CUDA; Lingora's current
features are not compatible with that input. The official
[checkpoint repository](https://huggingface.co/ZechengLi19/Uni-Sign) labels the
weights **CC BY-NC 4.0**, so they are research-only and not cleared for a
commercial deployment. The stage-one checkpoint alone is about 1.19 GB.

The installed `hf.exe` is blocked by Windows Application Control, but the public
checkpoint was obtained independently using ordinary HTTP range requests and
verified against the published SHA-256. The official RTM ONNX archives were
downloaded from the URLs specified by the upstream code; their archive integrity
and locally recorded hashes were checked, but no separately published hash was
available for independent verification. The mT5 configuration and tokenizer
were checked against the pinned repository's Git blob IDs. All assets stay in
the ignored private research directory.

The published online script assumes CUDA, while this machine has Intel Iris Xe
graphics and the project's PyTorch reports no CUDA device. A separate CPU-only
research adapter uses the official pose-only network, upstream preprocessing,
pinned tokenizer, strict checkpoint load, four beams and 100 maximum generated
tokens. It ran on the same seven local clips. The ASL-to-English model produced
unrelated English sentences for the Uzbek word clips and nonempty sentences for
all three rest/unrelated clips. One rest example produced “That's why I'm going
to do that.” These outputs are not evidence of Uzbek support and cannot be
treated as safe sign recognition.

On this computer, pose extraction took 6.49–13.61 seconds per 2.6–4.4-second
clip; model generation took another 1.75–2.92 seconds, excluding model startup.
This is an offline CPU measurement, not live-camera or phone latency. The
seven clips are development material, not an independent-signer benchmark.
Fine-tuning was **not performed**: verified Uzbek sign annotations and a
separately held-out signer/session set are missing. The checkpoint's
non-commercial license also prevents treating it as a commercial release.
`compare_three_sign_models.py` verifies that the three saved runs use the same
seven source-video hashes before producing a private paired report. The three
systems use different input preprocessing and tasks, so the report keeps their
raw outputs rather than presenting their scores as directly comparable.

## Reproduction

Run from the project root, keeping outputs and source video private:

```powershell
.\.venv-hf\Scripts\python.exe tools/ml/build_sign_benchmark.py
.\.venv-hf\Scripts\python.exe -m unittest discover -s tools/ml -p test_sign_benchmark.py
.\private-video-work\uzslr-test-env\Scripts\python.exe tools/ml/audit_benchmark_media.py
.\private-video-work\uzslr-test-env\Scripts\python.exe tools/ml/evaluate_uzslr_stream.py
.\private-video-work\uzslr-test-env\Scripts\python.exe tools/ml/evaluate_uzslr_controls.py
.\.venv-hf\Scripts\python.exe tools/ml/compare_sign_replays.py
node scripts/evaluate-capture-cuts.mjs
.\.venv-hf\Scripts\python.exe tools/ml/check_unisign_readiness.py
.\.venv-hf\Scripts\python.exe -m pip install --no-deps --target private-video-work/unisign-deps transformers==4.40.0 huggingface-hub==0.24.7 tokenizers==0.19.1 einops==0.6.1
.\.venv-hf\Scripts\python.exe tools/ml/download_unisign_research.py
.\.venv-hf\Scripts\python.exe tools/ml/download_unisign_pose_models.py
.\.venv-hf\Scripts\python.exe tools/ml/download_unisign_mt5_metadata.py
.\.venv-hf\Scripts\python.exe tools/ml/extract_unisign_pose_cpu.py
.\.venv-hf\Scripts\python.exe tools/ml/evaluate_unisign_cpu.py --max-new-tokens=100 --num-beams=4
.\.venv-hf\Scripts\python.exe tools/ml/compare_three_sign_models.py
```

The CPU path also requires PyTorch, torchvision, NumPy, OpenCV, ONNX Runtime,
SentencePiece and httpx in `.venv-hf`, plus a clean checkout of the inspected
Uni-Sign revision at `private-video-work/unisign-research`. The default pose and
model commands above run only the Salom clip. Pass `--ids=` with the seven IDs
listed in the private results to reproduce the full comparison; no source videos
or generated landmarks are uploaded.

For the countdown experiment, start the local research server and set
`LINGORA_SIMULATION_MEDIA` to `private-video-work/training-expanded-v3/live-media`
and `LINGORA_SIMULATION_OUTPUT` to an isolated private results directory. Run
`node scripts/simulate-sign-camera.mjs --live-only --production --all-live-cases --labels=hello,goodbye,please,none --countdown-ms=1000 --start-during-countdown`
once without and once with `--capture-countdown`. The candidate only exists as an
explicit constructor option; the website does not set it. Generate the synthetic
waiting clips with `tools/video/prepare_capture_wait.py` and repeat using its
`waited-media` directory to inspect the failure case.

Outputs are under `private-video-work/benchmark-v1/`, excluded from Git. The
Uni-Sign code checkout and external checkpoint must stay private until their
separate distribution and usage terms have been checked. Future model promotion
requires a separately defined locked test with verified signers, unknown/rest
movements, phone capture and no shared training sessions.

## Additional classifier training

Two ridge classifiers were trained on the existing 101 training views of 51
performances (48-word vocabulary). The activity-descriptor candidate used six
augmented views and ridge 10; the body-descriptor candidate used twelve and
ridge 10. On the existing 48 same-source development repetitions, the current
classifier correctly classified 40, the activity candidate 32, and the body
candidate 40; each produced zero wrong accepted words on these examples and
zero false accepts on three unknown development examples. These are classifier
diagnostics, not live end-to-end results or independent accuracy estimates.
The development repetitions have already influenced previous work and some
share sessions with training. Neither candidate demonstrates an improvement
that justifies replacing the current production bundle. The pretrained
Uni-Sign checkpoint was not fine-tuned in these experiments.
