# Three-sign MVP: test and release gate

The word demo accepts only Salom, Xayr and Iltimos. It still compares the input
against the full model gallery so that other signs can compete with those three;
an out-of-scope winner is rejected, never relabeled. Close Salom/Xayr matches
require the user to select an alternative. All recognized text requires user
confirmation before speech. This is an experiment, not a general Uzbek
sign-language translator. The separate presentation-phrase flow is unchanged
by the three-word output restriction.

## Available evidence

- Local build, 214 Vitest tests, model-pipeline tests, deployment tests, and
  browser smoke checks pass. The browser smoke test uses a synthetic camera and
  stubbed speech; it is not a physical-device or accuracy test.
- One real hosted Hugging Face run completed both synthesis and transcription.
  Generated audio played through a browser. The prerecorded Uzbek audio was
  supplied via a virtual microphone; the transcript contained errors. No
  physical microphone or independent speech-quality benchmark was used.
- One fresh browser replay of the limited demo accepted one of four target
  recordings automatically; two other recordings included their intended sign
  among the choices and the remaining Iltimos variant was rejected. Four
  unrelated/idle clips were rejected. These are previously inspected lesson
  recordings from the same source as references, not new-signer evidence.
- Training and evaluation frames share signers and source sessions. Extracted
  stills and synthetic altered views do not add independent signers. Lesson and
  dictionary footage reuse rights need verification before distributing new
  derived assets; the existing personal video is authorized for local work.

## Presenter check before deployment

On the intended phone or computer, open the public Lingora conversation page.
Start the camera and allow
permission. After the countdown, perform one sign and press the finish button;
check or select the displayed result. Repeat Salom, Xayr and Iltimos five times
each, including at least one attempt with slightly different lighting. Record
automatic result, choices, intended sign, and whether tracking stayed visible.
Also test idle hands and unrelated movements. Do not save or upload camera
recordings unless explicitly authorized.

The proposed demo gate is at least four automatic correct outputs out of five
attempts for each sign on the intended device, with false outputs counted
separately. User-selected choices are useful fallback interactions but are not
automatic recognition successes. Remove a sign from automatic output if it
does not pass; do not loosen a threshold solely to fit these attempts. This is
a presenter-specific demo gate, not a claim about new-signers generally.

Then test the hosted speech service using the actual microphone and speakers:
speak several short Uzbek phrases, confirm text appears after stopping, and
confirm that approved text plays audibly. If hosted speech is unavailable,
use typed input and the available voice fallback. The public version is an
experimental test build; these checks and any necessary rights review remain
required before treating it as a reliable general release.
