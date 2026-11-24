// Browser-portable research inference. Scores are similarities, not probabilities.
import { inferTemporalCandidate } from './temporal-inference.mjs';

export function hybridDecision(baseline, neural, nearestDtwLabel) {
  if (neural.reason === 'insufficient_motion') return { label: 'none', confidence: 0, alternatives: [], reason: 'insufficient_motion', method: 'rejected', distance: baseline.distance };
  if (baseline.label !== 'none') return { ...baseline, method: 'dtw' };
  if (baseline.reason === 'ambiguous' && neural.accepted && neural.label === nearestDtwLabel)
    return { label: neural.label, confidence: Math.min(1, Math.max(0, 1 - neural.distance)), alternatives: baseline.alternatives,
      reason: 'trained_dtw_agreement', method: 'hybrid', distance: baseline.distance };
  return { ...baseline, method: 'rejected' };
}

export function createHybridClassifier(matcher, gallery, neuralModel, infer = inferTemporalCandidate) {
  return frames => {
    const baseline = matcher.matchSequence(frames, gallery.templates, { matching: gallery.matching });
    const normalized = matcher.normalizeSequence(frames);
    const neural = normalized ? infer(normalized, neuralModel)
      : { label: 'none', accepted: false, reason: 'insufficient_tracking' };
    let nearest = null;
    if (baseline.reason === 'ambiguous' && normalized) {
      const ranked = gallery.templates.map(t => ({ label: t.label,
        distance: matcher.visibilityAwareSequenceDistance(normalized, t.normalized) })).sort((a, b) => a.distance - b.distance);
      nearest = ranked[0]?.label;
    }
    return { result: hybridDecision(baseline, neural, nearest), baseline, neural,
      tracking: normalized ? { handCoverage: normalized.handCoverage, reference: normalized.reference, durationMs: normalized.durationMs } : null };
  };
}
