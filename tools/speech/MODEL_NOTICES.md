# Optional Uzbek speech checkpoints

The application does not bundle these weights. The download helper retrieves pinned public checkpoints, with no audio upload. Keep the relevant notices when redistributing model files.

- **NVIDIA Uzbek FastConformer**, `nvidia/stt_uz_fastconformer_hybrid_large_pc`, revision `cd32f63d620a7b0cb461ed00ecfc45c852eb0bef`: NVIDIA Corporation, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Original model](https://huggingface.co/nvidia/stt_uz_fastconformer_hybrid_large_pc).
- **CPU ONNX conversion**, `algorithco/stt_uz_fastconformer_hybrid_large_pc`, revision `1786554e0cdfacb8bf9076b4d9739cb81d2fbb2d`: the NVIDIA checkpoint's CTC branch exported by OpenVoiceOS, with sherpa-onnx metadata and MatMul int8 quantization added by Algorithco. Convolutions remain float32. This is a community conversion, not the original default Transducer decoder. No further training was performed. [Conversion and NOTICE](https://huggingface.co/algorithco/stt_uz_fastconformer_hybrid_large_pc/blob/main/NOTICE).
- **Ovozify Whisper Small**, `OvozifyLabs/whisper-small-uz-v1`, revision `863efed858ab6ed7eda7c72119fff5af4665e0a2`: Ovozify Labs, model card declares [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0). [Original model](https://huggingface.co/OvozifyLabs/whisper-small-uz-v1). Lingora's optional conversion uses CTranslate2 int8 quantization with no additional training.

Model licensing is separate from the rights associated with the user's sign-language footage. These ASR checkpoints process spoken audio and do not recognize signs or generate speech.

## Optional local neural Uzbek voice

**Inomjonov Uzbek tiny-voca**, `Inomjonov/tiny-voca-uzbek-navoiy`, revision
`3d960bd05c728b21fff4ec5154cada7f6b082df1`, declares Apache-2.0 for its weights
and bundled runtime. It is a 4.53M-parameter, single synthetic male voice (M2),
trained on synthetic output from Aisha AI's Navoiy TTS. Retain its `LICENSE`,
`NOTICE`, `UPSTREAM.json` and `licenses/` files. Credit Muhammed Nazeem for
tiny-voca and Aisha AI for the teacher/text normalization. The downloader verifies
all runtime files against the pinned upstream SHA256SUMS and records a manifest.
The local loader uses the reviewed upstream `weights_only=True` checkpoint loader.

- [Model card and limitations](https://huggingface.co/Inomjonov/tiny-voca-uzbek-navoiy).
- [Upstream tiny-voca](https://github.com/n4ze3m/tiny-voca).
- [Navoiy teacher model](https://huggingface.co/aisha-org/navoiy-tts).

Weights and runtime are downloaded separately into the ignored private directory;
they are not bundled with GitHub Pages. Output is synthetic speech. No voice
cloning or participant voice recording is used by this integration.

## Optional speech evaluation corpus

The bounded public evaluation uses [Google FLEURS](https://huggingface.co/datasets/google/fleurs),
Uzbek (`uz_uz`) validation recordings, under CC BY 4.0. Attribution: Google FLEURS,
*Few-shot Learning Evaluation of Universal Representations of Speech*.
Sentence hashes define disjoint Lingora development/holdout groups before inference.
This split does not certify absence from an upstream checkpoint's pretraining.
Audio/transcripts are stored only in ignored private evaluation artifacts.
