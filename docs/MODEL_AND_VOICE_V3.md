# Dictionary and voice update

The selected sign model now covers 48 lexical labels. Eight additional dictionary
videos supply reviewed first/second movement windows for **Bermoq, Bilmoq,
Chaqirmoq, Javob bermoq, Qo‘ng‘iroq qilmoq, Tushuntirmoq, Bemor and Manzil**.
Visible Uzbek captions and exact source headings were checked. These infinitive
and noun labels are preserved; they are not rewritten as request sentences.

The fitted classifier uses 101 camera views of 51 physical training performances.
All camera variants of a performance remain in the same split. Second repetitions
stay outside fitting, feature statistics and calibration. An actual refit after
altering all 51 evaluation vectors/labels produced identical fitted weights,
statistics, thresholds and movement gate. Specialist semantic validation and
new-signer accuracy remain unestablished. Raw videos, audit records and landmarks
remain private; source reuse permission has not been independently established.

## Paired sign comparison

| Recorded-video condition | Previous 40-word model | Selected 48-word model |
| --- | --- | --- |
| Existing normal cases | 34/40 correct, 0 wrong | 34/40 correct, 0 wrong |
| Existing adverse cases | 30/38 correct, 0 wrong | 32/38 correct, 0 wrong |
| New normal cases | 0/8 correct, 1 wrong | 8/8 correct, 0 wrong |
| New adverse cases | 0/8 correct, 1 wrong | 8/8 correct, 0 wrong |
| Existing unknown/idle | 3/3 rejected | 3/3 rejected |

Adverse pixels combine dimming, blur, reframing and faster playback. These are
correlated source recordings, not independent participants or real camera trials.
The real-time frame-pump replay then saved its actual captured frames, allowing
both models to be compared on **identical observations**:

| Real-time word cohort | Previous model | Selected model |
| --- | --- | --- |
| Existing38 reserved repetitions | 31 correct, 1 wrong, 6 rejected | 33 correct, 1 wrong, 4 rejected |
| Eight added reserved repetitions | 0 correct, 1 wrong, 7 rejected | 7 correct, 0 wrong, 1 rejected |
| One idle turn | rejected | rejected |

The selected model totals40/46 correct words, one wrong word and five rejections.
The remaining error is Goodbye matching Hello; Bermoq was the added-word rejection.
Replay extraction varies with real-time frame scheduling. Compare models using
the saved identical frames, rather than treating an earlier replay's33/38 as a
paired control. The six presentation phrases use a separate unchanged model;
their replay checks are not evidence of continuous sign-language translation.

Private inspection artifacts:

- `private-video-work/dataset-v3/sources.json`: hashes, headings and source paths.
- `private-video-work/dataset-v3/reviewed-windows.json`: disjoint movement windows.
- `private-video-work/training-expanded-v3/pixel-comparison.json`: all pixel cases.
- `private-video-work/training-expanded-v3/live/tracked-live.json`: actual observations.
- `private-video-work/training-expanded-v3/release-comparison.json`: paired release gate.
- `private-video-work/training-expanded-v3/leakage-check/report.json`: actual refit audit.

Reproduction tools: `tools/video/collect_dictionary_v3.py`,
`tools/video/prepare_dictionary_v3.py`, `scripts/export-dictionary-v3.mjs`,
`tools/ml/train_skeletal.py`, `scripts/evaluate-dictionary-v3.mjs` and
`scripts/report-dictionary-v3.mjs`. The original public40-word baseline is frozen
privately before publication so reruns cannot accidentally compare a model to itself.
`scripts/publish-trained-model.mjs` strips the selected private bundle down to
inference data and Uzbek vocabulary; the public parser and CI check its contract.

## Free voice and STT improvements

The optional local neural TTS provider uses
[Inomjonov's Uzbek tiny-voca](https://huggingface.co/Inomjonov/tiny-voca-uzbek-navoiy),
a pinned18 MB Apache-licensed, single synthetic voice checkpoint. It runs on CPU
and does not require a paid API or an installed Uzbek browser voice. Eight fixed
phrases passed an independent ASR round-trip diagnostic with 0 word errors. Real
website confirmation, synthesis HTTP and native browser playback passed using a
2.848-second utterance. This is not a human pronunciation, MOS or speaker assessment.

The NVIDIA STT service now bounds quiet-audio gain, removes DC and keeps a padded,
contiguous speech interval. Its model weights are unchanged. On16 reserved FLEURS
recordings, mean WER over clean/quiet/noisy conditions fell from 23.62% to 20.91%.
Silence/noise-only rejection and the existing presentation regression passed.
This recorded-audio holdout is disjoint from Lingora's profile selection, but
upstream pretraining overlap and real microphone accuracy are not established.

See [the speech guide](../tools/speech/README.md) for installation, individual
condition scores, source attribution and the slight noisy-character-error tradeoff.
The public static site keeps browser speech as its default. Local neural TTS/STT
need their Python services running on the same computer as the browser; the
weights and private evaluation corpus are not published with GitHub Pages.
