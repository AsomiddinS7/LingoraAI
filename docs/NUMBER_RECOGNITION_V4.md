# Number recognition experiment

The previous public model had no number-three label. It also required enough
movement for every label, so a stationary number handshape could be rejected.
This release adds an experimental number fallback for 1, 2 and 3. The original
48-label matcher runs first; the additional matcher is used only when the original
rejects and the additional result is one of those three numbers. It still requires
movement and confirmation before text is spoken.

The added training material consists of two different number-three variants
from the existing captioned lesson, plus the first repetition of each number
from the [UzSL number dictionary](https://imo-ishora.uz/dictionary/2-sonlar).
The second repetition from each dictionary clip was reserved for evaluation.
Both repetitions in each dictionary clip are from the same signer and recording.

Using the actual published parser and matcher, the three reserved dictionary
repetitions were recognized as 1, 2 and 3. On 46 previously inspected saved
live replays, the result remained 40 correct, one wrong and five rejected; the
one saved idle replay and three separately captured unknown clips were rejected.
These are development checks with few people and cannot estimate accuracy for a
new signer. The lesson's two number-three variants were used in training and
their replay is not a held-out test. No general Uzbek sign-language translation
claim is made.

The motion gate still prevents a stationary handshape from becoming an
automatic result. A conservative handshape comparison can offer a number 1, 2
or 3 as a tentative suggestion, which requires explicit selection and later
confirmation. In a small development check using artificially held frames,
it suggested the expected numbers for two lesson examples and three dictionary
repetitions, and did not suggest a number for the available unknown examples.
The thresholds were examined on those same examples; this is not an independent
accuracy measurement. One real held dictionary clip produced a correct tentative
suggestion; two other held segments were recognized by the moving matcher. More
signers and physical-camera testing are needed.

A separate full browser flow used a virtual camera showing one repeated frame
from each dictionary clip. All three were tracked, rejected as moving signs, and
offered the corresponding number for explicit review. This checks the full UI
path with frozen video frames; it is not a physical-camera or new-signer trial.

The original video files, extracted landmarks, source metadata and experimental
training reports remain outside the public distribution. The public model has
only the sanitized inference features and weights.
