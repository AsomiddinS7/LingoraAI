import type { NormalizedSequence } from '../src/ml/sequence';
export interface SkeletalModel {
  format: string; feature_version: string; descriptor: string; classes: string[];
  mean: number[]; scale: number[]; weight: number[][]; bias: number[];
  minimum_score: number; minimum_margin: number;
  motion_gate?: { profile: string; minimum_span: number };
}
export interface SkeletalPrediction {
  label: string; nearest_label: string | null; accepted: boolean;
  score: number; margin: number; distance?: number; reason: string;
}
export function parseSkeletalCandidate(text: string): SkeletalModel;
export function inferSkeletalCandidate(input: NormalizedSequence, model: SkeletalModel): SkeletalPrediction;
export function skeletalDescriptor(input: NormalizedSequence, active?: boolean): number[];
export function skeletalMotionSpan(input: NormalizedSequence): number;
