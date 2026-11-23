// Experimental censored-observation DTW. Production features and thresholds stay
// fixed. Missing joints are neither fabricated coordinates nor evidence of a match.
export const MASKED_DTW_CONFIG = Object.freeze({
  maxDistance: .22, minMargin: .025, maxRatio: .85, bandFraction: .25,
  visibilityPenalty: .22, noCommonObservationCost: .44, minimumSharedFraction: .6,
});

export function observedFrameDistance(a, b) {
  let geometric = 0, common = 0, opportunities = 0, missing = 0;
  let wrist = 0, localShape = 0;
  for (const offset of [0, 64]) {
    if (!a[offset] && !b[offset]) continue;
    opportunities++;
    if (!a[offset] || !b[offset]) { missing++; continue; }
    common++;
    let squared = 0, wristSquared = 0, localSquared = 0;
    for (let point = 0; point < 21; point++) for (let axis = 0; axis < 3; axis++) {
      const index = offset + 1 + point * 3 + axis;
      squared += (a[index] - b[index]) ** 2;
      if (point === 0) wristSquared += (a[index] - b[index]) ** 2;
      else localSquared += ((a[index] - a[offset + 1 + axis]) - (b[index] - b[offset + 1 + axis])) ** 2;
    }
    geometric += Math.sqrt(squared / 63);
    wrist += Math.sqrt(wristSquared / 3);
    localShape += Math.sqrt(localSquared / 60);
  }
  return { distance: common ? geometric / common + MASKED_DTW_CONFIG.visibilityPenalty * missing / opportunities
    : MASKED_DTW_CONFIG.noCommonObservationCost,
    common, opportunities: Math.max(opportunities, 1),
    wristDiagnostic: common ? wrist / common : null,
    localShapeDiagnostic: common ? localShape / common : null };
}

export function maskedSequenceDistance(a, b) {
  if (a.reference !== b.reference || !a.vectors.length || !b.vectors.length)
    return { distance: Infinity, sharedFraction: 0, reason: 'incompatible_reference' };
  const n = a.vectors.length, m = b.vectors.length;
  const band = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * MASKED_DTW_CONFIG.bandFraction));
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const length = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const common = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const opportunities = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
    const choices = [[i - 1, j - 1], [i - 1, j], [i, j - 1]];
    let [pi, pj] = choices[0];
    for (const [ci, cj] of choices) if (cost[ci][cj] < cost[pi][pj]) [pi, pj] = [ci, cj];
    const frame = observedFrameDistance(a.vectors[i - 1], b.vectors[j - 1]);
    cost[i][j] = cost[pi][pj] + frame.distance;
    length[i][j] = length[pi][pj] + 1;
    common[i][j] = common[pi][pj] + frame.common;
    opportunities[i][j] = opportunities[pi][pj] + frame.opportunities;
  }
  const sharedFraction = common[n][m] / Math.max(1, opportunities[n][m]);
  const durationPenalty = Math.min(.1, Math.abs(Math.log(a.durationMs / b.durationMs)) * .04);
  const observedDistance = cost[n][m] / Math.max(1, length[n][m]) + durationPenalty;
  return { distance: sharedFraction >= MASKED_DTW_CONFIG.minimumSharedFraction ? observedDistance : Infinity,
    observedDistance, sharedFraction, reason: sharedFraction >= MASKED_DTW_CONFIG.minimumSharedFraction ? 'observed' : 'insufficient_shared_observations' };
}

export function createMaskedMatcher(normalizeSequence) {
  return (frames, templates) => {
    const reject = (reason, distance = Infinity, alternatives = [], sharedFraction = 0) =>
      ({ label: 'none', confidence: 0, distance, alternatives, reason, sharedFraction });
    if (!templates.length) return reject('no_templates');
    const query = normalizeSequence(frames);
    if (!query) return reject('insufficient_tracking');
    const byLabel = new Map();
    for (const template of templates) {
      const normalized = template.normalized ?? normalizeSequence(template.frames);
      if (!normalized) continue;
      const result = maskedSequenceDistance(query, normalized);
      if (!Number.isFinite(result.distance)) continue;
      if (result.distance < (byLabel.get(template.label)?.distance ?? Infinity))
        byLabel.set(template.label, { label: template.label, id: template.id, ...result });
    }
    const ranked = [...byLabel.values()].sort((a, b) => a.distance - b.distance);
    if (!ranked.length) return reject('insufficient_shared_observations');
    const [first, second] = ranked;
    const confidence = (distance) => Math.max(0, 1 - distance / MASKED_DTW_CONFIG.maxDistance);
    const alternatives = ranked.slice(1, 3).map((item) => ({ label: item.label, confidence: confidence(item.distance) }));
    if (first.distance > MASKED_DTW_CONFIG.maxDistance)
      return reject('too_distant', first.distance, alternatives, first.sharedFraction);
    if (second && (second.distance - first.distance < MASKED_DTW_CONFIG.minMargin
      || first.distance / Math.max(second.distance, 1e-9) > MASKED_DTW_CONFIG.maxRatio))
      return reject('ambiguous', first.distance, alternatives, first.sharedFraction);
    return { label: first.label, confidence: confidence(first.distance), distance: first.distance,
      alternatives, reason: 'matched', templateId: first.id, sharedFraction: first.sharedFraction };
  };
}
