"""Archive only delivery assets; exclude server credentials and private experiments."""
from pathlib import Path
import zipfile

FILES = {
    'README.txt', 'MVP.md', 'SPEECH_SETUP.md', 'Start-Lingora.ps1', '.env.speech.example',
    'docs/SIGN_MODEL_RESEARCH.md',
    'scripts/speech-server.mjs', 'scripts/start-local.mjs', 'scripts/check-speech-readiness.mjs',
    'tools/speech/server.py', 'tools/speech/requirements.txt', 'tools/speech/README.md',
    'tools/speech/nvidia_ctc.py', 'tools/speech/download_candidates.py',
    'tools/speech/requirements-candidates.txt', 'tools/speech/MODEL_NOTICES.md',
}


def deliverable(relative):
    path = Path(relative)
    if path.name.startswith('.env'):
        return path.as_posix() == '.env.speech.example'
    if path.suffix.lower() in {'.wav', '.mp4', '.webm', '.npz', '.pt', '.pth', '.pem', '.key', '.log'}:
        return False
    return path.as_posix() in FILES or path.as_posix().startswith('dist/')


def main():
    workspace = Path(__file__).resolve().parents[1]
    root = workspace / 'output/lingora-mvp-local'
    target = workspace / 'output/lingora-mvp-local.zip'
    if not (root / 'dist/index.html').is_file():
        raise RuntimeError('Run npm run package:local first')
    files = [path for path in root.rglob('*') if path.is_file() and deliverable(path.relative_to(root))]
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, Path(root.name) / path.relative_to(root))
    print(f'Archived {len(files)} delivery files; private configuration and model experiments excluded.')


if __name__ == '__main__':
    main()
