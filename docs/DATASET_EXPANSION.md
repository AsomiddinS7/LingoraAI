# Uzbek sign dataset expansion

This document records the initial corpus assembly and rejected first gallery.
The subsequent camera-trained 40-word model is now selected for publication;
see [the tracking/model update](TRACKING_AND_MODEL_V2.md) for its final results.
Raw source footage and landmark datasets remain private.

The working corpus is local at `private-video-work/dataset-expansion/combined/`.
It separates lexical signs, whole presentation phrases, regression repetitions
and unknown/idle evaluation clips. Dataset growth does not automatically enable
new words in the deployed recognizer.

## Completed expansion: 24 November 2026

The assembled corpus contains **92 samples: 72 training references, 17 regression
repetitions and 3 negative evaluation clips**, across 40 lexical labels and six
existing presentation phrases. There are 3,313 observed frames and 26 canonical
recordings; recording count does not establish signer count.

This pass adds **68 reviewed references**: 22 lesson performances and 46
individual dictionary demonstrations from 23 downloaded recordings. The six
round-video phrases were already present. The merged audit quarantines no final
samples and reports four same-training-group phrase boundary overlaps. A shared
neutral endpoint between the number-four regression clip and number-five
training clip was removed after frame-level visual review; source identities
and correction lineage remain preserved.

At unchanged production thresholds, the private enlarged gallery recognized
4/10 new lesson regression examples, compared with no independent dictionary
test examples. Existing-word recognition fell from 4/7 to 3/7, and unknown
rejection fell from 3/3 to 2/3: an idle clip matched the Non reference. These are
small same-session checks, not a general accuracy estimate. The enlarged model
**fails the existing-vocabulary regression check and remains private**. The
dataset is available for further training and curation; new labels have not
been enabled in the website by this expansion.

## Sources and label evidence

- Existing instructor lessons: visible Uzbek captions plus reviewed movement
  windows. The two encodes of the Tanishuv lesson share one canonical recording
  identity. They never count as separate sessions or participants.
- [UzSL dictionary](https://imo-ishora.uz/): 23 downloaded lexical videos with
  matching visible Uzbek captions. These include Yordam bermoq, Ichmoq, Yemoq,
  Takrorlamoq, Tushunmoq, Dori, Shifoxona and Tez yordam. Original lexical labels
  are retained; a verb such as Yordam bermoq is not relabeled as a full sentence
  such as “I need help.” A source video for Og‘riq was unavailable.
- Existing circular presentation video: six previously extracted whole-script
  references from one recording. These are not six new recordings. Script/audio
  alignment does not independently verify signed meanings or word boundaries.

The dictionary has static contextual photographs beside its signer. Physical
left-side crops exclude those photographs before tracking. Original and derived
video SHA-256 hashes, crop coordinates, exact source URLs and frame rates remain
in the private catalog. Dictionary repetitions stay in training as one source
group; none becomes an independent test example.

The active extraction profile is the application's `hands-pose-video-v1`, at
12.5 Hz. Every observed missing hand is retained. No interpolated hands, synthetic
recordings, foreign-language label substitutions or duplicated encodes are
counted as new data. CPU/GPU delegate provenance is recorded per extraction.
Dictionary boundaries were visually reviewed at 0.25-second resolution. Their
individual demonstrations replace whole-clip references in the assembled
training partition; repeated motion and intervening rest are not concatenated
into one sign example. Numbers five and six still have only one clean lesson
example each. Some second-hand detections are missing, and the number-four
lesson includes an editorial cut back to rest; these limits remain documented.
Specialist semantic validation remains pending. Source reuse permissions remain
unverified; source footage and landmark datasets remain private and gitignored.

## Reproduce and inspect

With the private source packages present, run from the repository root:

```powershell
npm run dataset:assemble
node scripts/evaluate-expanded-dataset.mjs
npm run test:model-pipeline
```

`prepare-expanded-dataset.mjs` adapts the reviewed source packages and verifies
original videos and signer crops. It writes a hash-pinned assembly plan.
`build-sign-dataset.mjs` applies the actual browser parser and normalizer, checks
reviewed labels and absolute timestamps, rejects duplicate geometry and
overlapping train/regression intervals, and verifies browser import limits.
The generic assembler also accepts another reviewed plan:

```powershell
node scripts/build-sign-dataset.mjs --plan PRIVATE_PLAN.json --out PRIVATE_DIRECTORY
```

Output files:

| File | Purpose |
| --- | --- |
| `catalog.json` | Counts, original glosses, source/session identity, quality, hashes, quarantine reasons and overlap warnings |
| `word-train.json` | Lexical training references |
| `word-regression.json` | Separate, non-overlapping lesson repetitions |
| `word-negative.json` | Idle/unsupported clips for rejection evaluation only |
| `phrase-train.json` | Six existing script references, kept separate from word recognition |
| `evaluation.json` | Existing and enlarged word galleries at unchanged matching thresholds |
| `candidate-word-model.json` | Private research gallery; never copied into the public build automatically |

Disjoint repetitions from one instructor/session are regression examples, not
evidence of unseen-signer accuracy. The circular phrases have overlapping
adjacent boundary padding; the catalog reports it and keeps all six in training.
The dictionary has no independent regression set. Similarity and accepted-result
precision must not be presented as overall translation accuracy.

The evaluator compares the enlarged gallery with the current working model,
including any locally promoted vocabulary, and records whether it preserves
existing-word recognition and unknown rejection. A passing comparison alone
would still not validate all newly added lexical labels.
