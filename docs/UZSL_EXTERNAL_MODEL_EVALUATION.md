# External Uzbek model investigation

This is a development investigation, not a measure of accuracy with new signers.
It does not change the recognition model served by Lingora.

## Candidate and comparison

[akkomron/uzslr-isolated-dynamic](https://github.com/akkomron/uzslr-isolated-dynamic)
provides a trained 50-class Uzbek isolated-sign model. The repository includes
`assalomu_alaykum` and `iltimos`, but no `xayr` or `rahmat` class. Its output
is closed-set: it always selects one of its classes, even for an unknown sign.
The checkout evaluated was `23c8bdcac9fedde497626656d3656e8ff7477208`.

We ran the checkpoint locally on five previously inspected Lingora source
replays, and a [dictionary greeting](https://imo-ishora.uz/dictionary/7-tanisuv/229-salomlashish-229).
The two greeting labels have not been verified as precisely the same sign.

| Video / expected label | Top prediction | Model score |
| --- | --- | ---: |
| Lingora goodbye | yomg'ir | 0.364 |
| Lingora hello | turish | 0.942 |
| Lingora please, chest variant | qo'ziqorin | 0.371 |
| Lingora please, palms variant | iltimos | 0.449 |
| Lingora thank you | metro | 0.260 |
| Dictionary Salomlashish | toza | 0.768 |

Scores are softmax outputs, **not calibrated probabilities**. Goodbye and
thank you are outside this model's vocabulary, so these are unknown-sign
checks, not recognition failures on supported classes. These clips are few,
some share sources, and semantic equivalence and signer independence have not
been established. The offline test samples 32 evenly spaced frames across each
clip; the upstream live app takes consecutive frames after its own hand gate.
Consequently this comparison does not establish its performance in its own
live application. Face coverage was 100% in these clips; hand coverage was
84–100%, so a total failure to see hands does not explain these outputs.

The checkpoint requires face, pose and both hand landmarks; Lingora's existing
recognizer does not retain the full required face and pose features. No license
file was found in the upstream repository at the checked commit. Verify use and
distribution rights before integrating or publishing the checkpoint. Dictionary
footage is separately marked all rights reserved; keep it in private research
unless reuse is authorized.

## Repeat locally

The comparison harness is `tools/ml/evaluate_external_uzslr.py`. Place the
upstream checkout at `private-video-work/uzslr-external`, create a separate
Python environment with compatible PyTorch, OpenCV, MediaPipe Holistic and
NumPy versions, and run:

```powershell
python tools/ml/evaluate_external_uzslr.py --video path/to/video.mp4 --expected Salom --output private-video-work/uzslr-inspect/my-result.json
```

Without `--video`, it uses the private replay manifest if present. It writes
labels, scores, detection coverage and timings, not video or landmarks. These
are local inputs and outputs, and should not be committed or uploaded. Run
third-party code and load weights only from sources you trust. The harness uses
PyTorch's `weights_only=True` for the checkpoint.

## Other directions

[SignSeek](https://arxiv.org/abs/2609.03695) is a pretrained cross-language
retrieval approach, which could compare a query with Uzbek reference videos
instead of predicting foreign-language labels. The paper does not establish
Uzbek performance. Its [project page](https://cogvis-cvssp.github.io/papers/signseek/)
currently says code is coming soon, so we could not run it. Obtain its actual weights, verify their license, match its
pose extraction pipeline, and compare it with Lingora on separate recordings
before deployment. The [Uzbek fingerspelling dataset](https://github.com/Mrkomiljon/uzbek-sign-language)
contains letter images and is not a dataset for these word signs.

The next meaningful test is a properly labeled, independent video of the
specific signs used in the demo, including no-sign and unrelated movements.
Existing team recordings can be used if their labels and recording intervals
are known; do not report a result as new-signer accuracy when the same person
appears in reference and test data.

## SignRep retrieval experiment

We ran the official [SignRep v0.0.1 checkpoint](https://github.com/ryanwongsa/SignRep/releases/tag/v0.0.1)
(SHA-256 `f8be8ca44aec4d7066175dccc681338f376ec86de6ba72bc79223a6bbd3c766b`)
locally using signlangtk 0.3.4 on CPU. Its license allows research and education
but prohibits commercial exploitation, so it is not cleared for a commercial
Lingora deployment. Six reference performances covered four labels (hello,
goodbye, please and thank you). Queries were disjoint time intervals, using
the middle 16 consecutive frames of each clip, compared by cosine similarity;
the highest-scoring reference per label determined the ranking. No rejection
threshold was applied. The gallery and the five positive examples came from
the same source recording and signer; they are not independent-signer tests.

| Query | Top-ranked label | Similarity |
| --- | --- | ---: |
| Xayr | goodbye | 0.7272 |
| Salom | hello | 0.8400 |
| Iltimos, chest | please | 0.9063 |
| Iltimos, palms | please | 0.9496 |
| Rahmat | thank_you | 0.9640 |
| Number four, outside gallery | hello | 0.8419 |
| Menga, outside gallery | thank_you | 0.7672 |
| Idle | please | 0.1251 |

All five positive examples had the expected label ranked first. All eleven
out-of-gallery examples received a label because this experiment is a retrieval
ranking, not an unknown-sign detector. The number-four similarity exceeded the
Salom score, and Menga exceeded Xayr's score: no single global cutoff can reject
both while retaining all five positives. Similarity is not a probability.

Earlier Lingora live replay output for the same Xayr and Salom clips was,
respectively, the wrong label `hello` and rejection as ambiguous; it recognized
the chest-Iltimos and Rahmat replays. That is not a controlled full-system
comparison: Lingora used a larger gallery and its real-time gating, while this
experiment used four classes and presegmented central windows. CPU processing
averaged roughly two seconds per clip in this batch, excluding initial model
loading; this has not been measured as a real-time camera pipeline.

Re-run with `tools/ml/evaluate_signrep_retrieval.py --checkpoint PATH`, using
the private manifests and videos. Output stays under `private-video-work` and
does not include frames or embeddings. A stronger test needs verified cross-signer
examples, more negatives, a validation-only rejection rule and a separate held-out
test. Do not deploy these weights or claim live improvement on the basis of this
experiment.

## Follow-up: lesson images, text leakage and camera changes

Visual inspection of the lesson contact sheets found the target demonstrator
and matching on-screen words at the selected intervals. The slides also show
the word during rest periods, subtitles, multiple variants, and transitions
between signs. In particular, wave-style Salom and Xayr look similar in the
review images, and the displayed number changes from 4 to 5 around the end of
the held-out number-four clip. These observations do not establish sign-language
semantics; the boundaries and variants need expert review. The existing Lingora
model consumes landmarks extracted from video, not these contact-sheet images.

The V3 normalized dataset has 152 rows: 101 training, 48 regression, and three
unknown regression. Fifty rows are dim/blur/reframed variants, not independent
performances. The five nominal Salom/Xayr/Iltimos reference clips and four
held-out clips in that dataset all came from `source_04`; the split audit reports
no overlapping retained windows or identical geometry across splits. Disjoint
intervals are still the same signer and session.

The previous SignRep comparison used full frames containing written labels, so
its result could have benefited from irrelevant visual cues. Two controlled
follow-ups on the same videos (not independent tests) produced:

| Input | Positive top-1 | Important negative |
| --- | ---: | --- |
| Full frame | 5/5 | number four ranked hello, 0.8419 |
| Left 43% crop | 4/5; Xayr ranked hello | my ranked hello, 0.8042 |
| Right 57% blacked out, frame size retained | 5/5 | number four ranked hello, 0.8514 |

The masked result does not establish that on-screen text caused the full-frame
result. Cropping also changes the signer's apparent scale, which can affect the
model. Both treatments still share clothing, signer and background. With the
mask, number four's score (0.8514) exceeded the Salom score (0.8223), so a
single global threshold cannot keep that Salom and reject that number four.

We also tested a lightweight ImageNet-pretrained MobileNetV3 Small as a generic
frame-feature baseline, using the same left-side crop, one central 16-frame
window and mean-pooled cosine similarity. It is not pretrained on sign language.
It ranked five nominal positives correctly, but idle and other signs also had
high similarities (up to 0.9712). For dimmed, blurred, reframed and sped-up
versions of the same source clips, it ranked Xayr as Salom; unrelated signs
overlapped the known-sign score range. The whole 20-plus-clip CPU batch took
2.87 seconds after model construction, but this is not live-camera latency.
These synthetic views are not new recordings, and these results do not support
deploying a classifier or setting a threshold from the evaluation set.

`tools/ml/evaluate_signrep_retrieval.py` supports `--crop-left-fraction 0.43`
and `--mask-right` for these ablations. `tools/ml/evaluate_mobilenet_retrieval.py`
repeats the baseline, with `--adverse` for the synthetic query videos. Research
weights, recordings and output reports remain local under `private-video-work`.
The TorchVision source has a BSD license; check the pretrained weights, lesson
data rights and all distribution terms separately before any product use.

## Replay of the actual application recognizer

The earlier replay used a research hybrid classifier directly, omitting parts
of the bundled recognizer. `scripts/simulate-sign-camera.mjs --production`
now loads `public/model/trained-sign-model.json` through the application's
actual `createSequenceStore` and `MotionRecognizer`; `--all-live-cases` keeps
all variants instead of selecting the first clip for each label. `--labels`
can restrict the replay. The report records the bundle SHA-256 and includes
live unknown-sign results. This is playback of local videos in a browser, not
a new signer, an actual webcam, or a general accuracy benchmark.

Two runs of the corrected replay on the existing lesson clips yielded the same
top-level outcomes: Salom and both Iltimos variants were accepted, Xayr was
rejected as ambiguous, and three unknown/rest clips were rejected. One run's
Xayr alternatives included Salom, Yo'q and Xayr. This demonstrates an actual
app-path failure on that recording; it does not establish why a user's live
sign was missed. The lesson's wave Salom and Xayr are visually similar, and
choosing Xayr automatically on this evidence could introduce wrong text.

In a broader check against saved landmarks using the actual word store, one
real-time source replay of Xayr was accepted as Salom, with Xayr as a nearby
alternative. The app now treats a Salom/Xayr pair within 0.15 similarity as
ambiguous and offers both for the signer to select; it does not automatically
resolve them. On the two saved replay sets, this changed that one wrong result
to an ambiguous result without changing the other aggregate outcomes: 34/40
nominal and 32/38 altered source clips matched in one set, and 40/46 nominal
clips matched in the other. These include repeated clips from the same source,
are not independent tests, and are not population accuracy estimates. The
selection threshold is a pragmatic safeguard derived from this small sample,
not a calibrated measure of sign-language meaning.

In a fresh browser replay, Xayr was again ambiguous with Xayr available among
the choices; Salom and both Iltimos variants matched and two unrelated clips
were rejected. The simulated input is still a video replay. Actual webcam
behavior and new-signer accuracy remain untested.

Example from the repository root, with the local development server running:

```powershell
$env:LINGORA_SIMULATION_MEDIA='private-video-work/training-expanded-v3/live-media'
$env:LINGORA_SIMULATION_OUTPUT='private-video-work/uzslr-inspect/production-replay'
node scripts/simulate-sign-camera.mjs --live-only --production --all-live-cases --labels=hello,goodbye,please,none
```

## Presentation-phrase flow: source replay calibration

The private round video has six whole-phrase references from one recording;
audio alignment does not independently verify word-level sign meanings, so its
greeting has not been relabeled as the lesson's Salom. In a browser replay
using the actual phrase store and tracker, only the opening phrase matched its
own saved reference. The other five were rejected for distance despite their
own reference having the closest strict distance. The replayed video is
letterboxed and tracked afresh; this tests sensitivity to that change, not
performance on a different signer or recording.

As an exploratory comparison, increasing the phrase-specific distance limit
from 0.22 to 0.27 on those captured landmarks matched 6/6 source replays and
accepted 0/49 stored word-clip negatives. The limit was selected after looking
at these same examples, so those figures do not estimate general accuracy.
In a separate browser playback after the change, tracking varied: 5/6 phrase
replays matched and the fifth phrase was rejected; four other live-replayed
word/idle clips were rejected. The comparison was against the same physical
performances used for the references; no independent phrase takes exist here.

The 0.27 limit is applied only to `signedSpeechStore`. It leaves the word model
and its gates unchanged. The existing phrase UI requires a user to confirm a
matched phrase before it is spoken. Loosening this limit can increase false
matches in circumstances not represented by these clips. An actual webcam
test and independent signing samples remain necessary before stronger claims.
`scripts/diagnose-phrase-replay.mjs` and `scripts/evaluate-phrase-distance.mjs`
allow the saved local landmarks to be examined without exporting them.
