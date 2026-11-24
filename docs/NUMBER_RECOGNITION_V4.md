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
their replay is not a held-out test. A held, stationary handshape is still not
supported reliably: the motion gate remains active to avoid translating idle
hands. No general Uzbek sign-language translation claim is made.

The original video files, extracted landmarks, source metadata and experimental
training reports remain outside the public distribution. The public model has
only the sanitized inference features and weights.
