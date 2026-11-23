// Build first. Packages the local preview, never source videos, credentials or raw datasets.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve('output/lingora-mvp-local');
await readFile('dist/index.html');
await mkdir(resolve(root, 'scripts'), { recursive: true });
const builtTarget = resolve(root, 'dist');
if (relative(root, builtTarget) !== 'dist' || root !== resolve('output/lingora-mvp-local'))
  throw new Error('Refusing to replace an unexpected generated build path');
// Only the verified generated dist directory is replaced; private server
// configuration elsewhere in the delivery folder is preserved.
await rm(builtTarget, { recursive: true, force: true });
await cp('dist', builtTarget, { recursive: true });
await cp('scripts/speech-server.mjs', resolve(root, 'scripts/speech-server.mjs'));
await cp('scripts/start-local.mjs', resolve(root, 'scripts/start-local.mjs'));
await cp('scripts/check-speech-readiness.mjs', resolve(root, 'scripts/check-speech-readiness.mjs'));
await cp('Start-Lingora.ps1', resolve(root, 'Start-Lingora.ps1'));
await cp('.env.speech.example', resolve(root, '.env.speech.example'));
await cp('MVP.md', resolve(root, 'MVP.md'));
await cp('SPEECH_SETUP.md', resolve(root, 'SPEECH_SETUP.md'));
await mkdir(resolve(root, 'docs'), { recursive: true });
await cp('docs/SIGN_MODEL_RESEARCH.md', resolve(root, 'docs/SIGN_MODEL_RESEARCH.md'));
await mkdir(resolve(root, 'tools/speech'), { recursive: true });
for (const file of ['server.py', 'requirements.txt', 'requirements-candidates.txt', 'README.md', 'nvidia_ctc.py', 'download_candidates.py', 'MODEL_NOTICES.md'])
  await cp(`tools/speech/${file}`, resolve(root, `tools/speech/${file}`));
await writeFile(resolve(root, 'README.txt'), `LINGORA LOCAL MVP

Requires Node.js 22.12 or newer. Local STT also requires Python and model setup.

Open a terminal in this folder and run:
  node scripts/start-local.mjs
Then open http://localhost:8787/#/conversation
Signed speech: http://localhost:8787/#/presentation

This build selects the free NVIDIA Uzbek STT service on localhost:8791.
Follow tools/speech/README.md to install Python dependencies and download the
pinned CPU checkpoint once, then leave this running in another terminal:
  .venv-stt/Scripts/python.exe tools/speech/server.py --engine nvidia-ctc --port 8791 --warmup
No paid API key is needed. Weights are downloaded separately, not bundled.
Select browser-speech in Console to use the browser vendor's service instead.
Browser STT needs internet and may send audio to its vendor.

Includes four lesson-sign labels and six references from the existing speech recording.
Sign one phrase per turn and press Finish. Confirm a matched sentence to request audio.
These are reference-matching demos; new-signer accuracy has not been established.
Raw footage, source landmark datasets, transcripts and credentials are not included.
Do not publicly distribute source-derived sign models without cleared reuse rights.

Actual Uzbek STT passed the production website microphone-to-Chat flow using
an existing recording through a Chromium virtual microphone, without mocked
recognition. Physical microphones remain untested and spelling is imperfect.
NVIDIA's provisional single-recording word error was 20.63%, Ovozify's 23.81%,
and the prior Chrome run's 30.16%; the reference was the intended script.
See tools/speech/MODEL_NOTICES.md for speech model attribution and licensing.
Uzbek TTS requires an installed Uzbek voice or configured Azure credentials;
live TTS has not been verified. See MVP.md and SPEECH_SETUP.md for details.
`, 'utf8');
console.log(`Prepared local package: ${root}`);
