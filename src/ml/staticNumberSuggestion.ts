import type { CompiledTemplate, NormalizedSequence } from './sequence';
import type { RecognitionResult } from '../recognition/types';

// This is an optional suggestion, not an automatic classification. Compare the
// visible upper hand against every label so other known handshapes can compete.
function shape(v: number[]): number[] | null {
  const hands = [0, 64].filter((offset) => v[offset] === 1).sort((a, b) => v[a + 2] - v[b + 2]);
  if (!hands.length) return null;
  const o = hands[0], wrist = v.slice(o + 1, o + 4);
  const palm = [5, 9, 17].map((j) => Math.hypot(...wrist.map((w, k) => v[o + 1 + j * 3 + k] - w))).sort((a, b) => a - b)[1];
  if (palm < .04) return null;
  return Array.from({ length: 60 }, (_, j) => (v[o + 4 + j] - wrist[j % 3]) / palm);
}
function distance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
}
export function createStaticNumberSuggestion(templates: readonly CompiledTemplate[]) {
  const references = templates.flatMap((template) => [12, 16, 20].map((i) => ({
    label: template.label, value: shape(template.normalized.vectors[i]),
  })).filter((ref): ref is { label: string; value: number[] } => ref.value !== null));
  return (input: NormalizedSequence): RecognitionResult['alternatives'] => {
    if (input.reference !== 'body' || input.handCoverage < .8 || input.durationMs < 600) return [];
    const samples = input.vectors.slice(10, 22).map(shape).filter((v): v is number[] => v !== null);
    if (samples.length < 10) return [];
    const mean = samples[0].map((_, i) => samples.reduce((sum, v) => sum + v[i], 0) / samples.length);
    if (samples.some((sample) => distance(sample, mean) > .06)) return [];
    const byLabel = new Map<string, number>();
    for (const ref of references) byLabel.set(ref.label, Math.min(byLabel.get(ref.label) ?? Infinity, distance(mean, ref.value)));
    const ranked = [...byLabel].map(([label, d]) => ({ label, d })).sort((a, b) => a.d - b.d);
    const [first, second] = ranked;
    if (!first || !second || !['number_one', 'number_two', 'number_three'].includes(first.label)
      || first.d > .08 || second.d - first.d < .05) return [];
    return [{ label: first.label, confidence: Math.max(0, 1 - first.d / .08) }];
  };
}
