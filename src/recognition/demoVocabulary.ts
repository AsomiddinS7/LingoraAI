import type { SequenceMatch } from '../ml/sequence';

/** Candidate signs for the limited camera demo; not a claim of validated accuracy. */
export const DEMO_SIGN_LABELS = ['hello', 'goodbye', 'please'] as const;

/** Restrict outputs after full-gallery inference so other labels remain competitors. */
export function limitDemoSign(result: SequenceMatch, allowed: readonly string[]): SequenceMatch {
  const labels = new Set(allowed);
  if (result.label !== 'none' && !labels.has(result.label)) {
    return { label: 'none', confidence: 0, distance: result.distance, reason: 'too_distant', alternatives: [] };
  }
  return { ...result, alternatives: result.alternatives.filter(candidate => labels.has(candidate.label)) };
}
