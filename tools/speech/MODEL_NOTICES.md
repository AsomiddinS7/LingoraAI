# Optional Uzbek speech checkpoints

The application does not bundle these weights. The download helper retrieves pinned public checkpoints, with no audio upload. Keep the relevant notices when redistributing model files.

- **NVIDIA Uzbek FastConformer**, `nvidia/stt_uz_fastconformer_hybrid_large_pc`, revision `cd32f63d620a7b0cb461ed00ecfc45c852eb0bef`: NVIDIA Corporation, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Original model](https://huggingface.co/nvidia/stt_uz_fastconformer_hybrid_large_pc).
- **CPU ONNX conversion**, `algorithco/stt_uz_fastconformer_hybrid_large_pc`, revision `1786554e0cdfacb8bf9076b4d9739cb81d2fbb2d`: the NVIDIA checkpoint's CTC branch exported by OpenVoiceOS, with sherpa-onnx metadata and MatMul int8 quantization added by Algorithco. Convolutions remain float32. This is a community conversion, not the original default Transducer decoder. No further training was performed. [Conversion and NOTICE](https://huggingface.co/algorithco/stt_uz_fastconformer_hybrid_large_pc/blob/main/NOTICE).
- **Ovozify Whisper Small**, `OvozifyLabs/whisper-small-uz-v1`, revision `863efed858ab6ed7eda7c72119fff5af4665e0a2`: Ovozify Labs, model card declares [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0). [Original model](https://huggingface.co/OvozifyLabs/whisper-small-uz-v1). Lingora's optional conversion uses CTranslate2 int8 quantization with no additional training.

Model licensing is separate from the rights associated with the user's sign-language footage. These ASR checkpoints process spoken audio and do not recognize signs or generate speech.
