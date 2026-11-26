"""Read-only local readiness check for the Uni-Sign research experiment."""
import importlib.util
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT / 'private-video-work/unisign-research'
CHECKPOINTS = ROOT / 'private-video-work/unisign-checkpoints'
DEPS = ROOT / 'private-video-work/unisign-deps'
MT5 = ROOT / 'private-video-work/unisign-assets/mt5'
POSE_MODELS = ROOT / 'private-video-work/unisign-pose-models'
packages = ['torch', 'torchvision', 'transformers', 'sentencepiece', 'einops',
            'deepspeed', 'decord', 'onnxruntime', 'rtmlib']
available = {name: importlib.util.find_spec(name) is not None for name in packages}
cuda = False
if available['torch']:
    import torch
    cuda = torch.cuda.is_available()
print(json.dumps({
    'code_present': (REPO / 'demo/online_inference.py').is_file(),
    'checkpoint_present': any(CHECKPOINTS.glob('*.pth')) if CHECKPOINTS.is_dir() else False,
    'mt5_base_present': (REPO / 'pretrained_weight/mt5-base/config.json').is_file(),
    'research_mt5_config_and_tokenizer_present': (MT5 / 'config.json').is_file() and (MT5 / 'spiece.model').is_file(),
    'research_dependencies_present': all((DEPS / name).is_dir() for name in ('transformers', 'tokenizers', 'huggingface_hub', 'einops')),
    'research_pose_models_present': all((POSE_MODELS / f'{name}.onnx').is_file() for name in ('detector', 'wholebody')),
    'dependencies_present': available,
    'cuda_available_to_current_python': cuda,
    'free_disk_bytes': shutil.disk_usage(ROOT).free,
    'official_online_inference': 'Requires CUDA as written; pose topology is 133-point whole-body, not Lingora MediaPipe features. A separate offline CPU adapter is available.',
    'weights_license': 'CC BY-NC 4.0 as listed by the checkpoint repository; research only.',
    'ready_for_unmodified_online_inference': bool(cuda and all(available.values()) and (REPO / 'pretrained_weight/mt5-base/config.json').is_file()
                                                   and CHECKPOINTS.is_dir() and any(CHECKPOINTS.glob('*.pth'))),
}, indent=2))
