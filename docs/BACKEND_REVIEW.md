# Platform backend and speech hosting review

The repository contains two distinct backends:

- `backend/`: FastAPI/PostgreSQL accounts, sessions, roles, consent, catalog and
  feedback. Its existing tests use real PostgreSQL constraints and migrations.
- `tools/speech/` and `deploy/huggingface/`: model inference. A Hugging Face Space
  can provide Uzbek STT/TTS without becoming a persistent account database.

## Verified locally

The final backend suite passes 79 tests, including the new model-cache regression.

A new PostgreSQL cluster was initialized inside this project's ignored test
directory, on loopback port 54331. Only the dedicated `lingora_test_hf_deploy`
database was reset. Application data and the other project's PostgreSQL data
were not used. The original 78 backend tests passed: migrations, password/session
authentication, CSRF/origin checks, roles, Google/Telegram validation, consents,
export/deletion, feedback, admin audit and PostgreSQL constraints.

Two fixes accompany this review:

1. Tests now refuse schema resets outside a dedicated test database name.
2. Model files served at stable `/model/` filenames use `no-cache`, so replacing
   a model does not advertise a week of immutable caching. Hashed frontend assets
   retain their cache policy. A regression test checks an actual model replacement.

GitHub CI now runs the backend suite against its own PostgreSQL 16 service.

## Current deployment limits

The GitHub Pages build uses the bundled catalog and real local sign inference.
Mock API transport is disabled in production. Account, registration, contribution
and feedback controls are unavailable until a persistent platform API is deployed;
the speech Space does not provide an account database. Confirmed labels are
composed locally. This is not yet a deployed account/admin platform.

The database's existing seed vocabulary also remains the original 12 signs. The
website supplements it with its compiled 48-word model vocabulary at runtime;
the API's database-validated sentence route would need a reviewed vocabulary
sync before accepting every newly trained label.

The platform API's default sentence/simplify provider marks responses
`[PLACEHOLDER]`; the current website instead uses its deterministic local word
composition. The API's Azure speech-token route is also a stub. The Hugging Face
integration does not depend on that paid-service stub.

`/api/model/active` exposes registry metadata, but the associated model-file
delivery routes are unfinished. The current 48-word motion model is loaded from
the frontend's checked compiled assets, not this registry endpoint.

Authentication uses HttpOnly `SameSite=Lax` cookies. Simply pointing GitHub Pages
at a different-domain FastAPI server cannot make that authenticated flow work.
Host the platform frontend/API on the same site, or implement and test another
authentication design before enabling real account features.

Persistent accounts also need an external PostgreSQL service and its credentials.
Hugging Face's ephemeral Space filesystem is not a substitute for that database.
No production database credentials were configured or production migrations run
as part of this review.

## Hugging Face speech deployment

The package targets `asomiddinsaidov07/lingora-speech` using the Gradio SDK and
explicit free `zero-a10g` hardware. It never falls back to a paid instance.
The upload contains only allowlisted runtime source, configuration and notices;
weights are fetched from pinned public model revisions. Videos, raw landmarks,
environment files, login credentials and private benchmark reports are excluded.

Public calls use Gradio's queued API. The website sends microphone audio and
confirmed text to the Space; Gradio temporarily handles queue inputs/results.
TTS uses `@spaces.GPU` on ZeroGPU and CPU during local checks. Local success cannot
establish cloud CUDA compatibility. Actual hosted transcription, synthesis and
website checks must pass before setting `LINGORA_SPEECH_SPACE_URL` in GitHub.
