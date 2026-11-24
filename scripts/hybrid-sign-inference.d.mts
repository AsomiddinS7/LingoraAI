import type * as Matcher from '../src/ml/sequence';
import type { SkeletalModel, SkeletalPrediction } from './skeletal-inference.mjs';
export function createHybridClassifier(matcher: typeof Matcher, gallery: Matcher.MotionModel,
  model: SkeletalModel, infer: (input: Matcher.NormalizedSequence, model: SkeletalModel) => SkeletalPrediction):
  (frames: Matcher.SequenceFrame[]) => { result: Matcher.SequenceMatch };
