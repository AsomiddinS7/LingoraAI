import type { SequenceFrame, SequenceMatch } from './sequence';

/** Find the observed movement, keeping the hold around it and all internal gaps. */
export function trimRestingEdges(frames: readonly SequenceFrame[], paddingMs: number): SequenceFrame[] {
  const motion = frames.map((frame, i) => {
    if (!i) return 0;
    const previous = frames[i - 1];
    let sum = 0, count = 0;
    for (const hand of ['left', 'right'] as const) {
      const a = frame[hand], b = previous[hand];
      if (!a || !b) continue;
      for (let j = 0; j < Math.min(a.length, b.length); j++) {
        sum += Math.hypot(a[j].x - b[j].x, a[j].y - b[j].y);
        count++;
      }
    }
    return count ? sum / count : 0;
  });
  const peak = Math.max(0, ...motion);
  const indices = motion.map((value, i) => value >= Math.max(.002, peak * .12) ? i : -1).filter((i) => i >= 0);
  if (!indices.length) return [...frames];
  const first = frames[indices[0]].t - paddingMs, last = frames[indices[indices.length - 1]].t + paddingMs;
  const cropped = frames.filter((frame) => frame.t >= first && frame.t <= last);
  return cropped.length >= 5 ? cropped : [...frames];
}

/** Two independently padded windows must agree; keep the outcome unconfirmed. */
export function windowSuggestion(original: SequenceMatch, a: SequenceMatch, b: SequenceMatch): SequenceMatch {
  if (original.label !== 'none' || !['too_distant', 'ambiguous'].includes(original.reason)
    || a.label === 'none' || a.label !== b.label) return original;
  return { ...original, reason: 'trimmed_suggestion', alternatives: [{ label: a.label, confidence: Math.min(a.confidence, b.confidence) }] };
}
