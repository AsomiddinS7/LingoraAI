# Third-party notices

## MediaPipe

Hand and body estimation uses `@mediapipe/tasks-vision` 0.10.14, the Google MediaPipe hand-landmarker model and pose-landmarker model, and the package's WebAssembly runtime.

- Project and copyright notices: https://github.com/google-ai-edge/mediapipe
- Package metadata: https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.14
- Models and documentation: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker and https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- Apache License 2.0: [license text](licenses/Apache-2.0.txt)

MediaPipe assets are pretrained estimators. Lingora's reference-matching code, normalized sign-reference assets, and speech-provider adapters are separate components.

## Speech models

Speech weights are optional downloads and are not bundled into the website. See [speech model notices](https://github.com/AsomiddinS7/LingoraAI/blob/main/tools/speech/MODEL_NOTICES.md) for NVIDIA CC BY 4.0 attribution, the community ONNX conversion and Ovozify's declared Apache 2.0 license.

The prepared introduction and three Uzbek trial-word audio clips were generated using [Inomjonov/tiny-voca-uzbek-navoiy](https://huggingface.co/Inomjonov/tiny-voca-uzbek-navoiy), based on tiny-voca by Muhammed Nazeem and Uzbek normalization from Aisha AI Navoiy TTS. The model is distributed under Apache 2.0; [license text](licenses/Apache-2.0.txt).

## Sign-reference sources

See [model provenance](model/README.md). Source footage, raw landmark datasets and personal source filenames are excluded from the public artifact. Public visibility of a lesson does not by itself establish a redistribution license; this notice does not grant rights to source videos or certify general sign-language translation accuracy.

Other npm dependencies retain their package-level licenses in the source dependency graph.
