// Stability filter: per-frame predictions jitter, so a sign is reported only after the same
// label has been seen for at least `minFrames` consecutive frames AND `minMs` milliseconds,
// and only ONCE per hold. Time-based, so slow devices do not wait for extra frames:
// 30 fps -> ~5 frames (150 ms); 10 fps -> 3 frames (200 ms) instead of 5 frames (500 ms).

export interface StableEvent {
  label: string;
  confidence: number;
  /** Frame time when this label's run started: event time minus this = recognition latency. */
  startedAt: number;
}

export function createStabilityFilter(minFrames = 3, minMs = 150) {
  let current = '';
  let run = 0;
  let confSum = 0;
  let emitted = false;
  let startedAt = 0;

  return {
    /** Feed one frame's prediction; returns an event the moment the sign becomes stable. */
    feed(label: string, confidence: number, at = 0): StableEvent | null {
      if (label !== current) {
        current = label;
        startedAt = at;
        run = 0;
        confSum = 0;
        emitted = false;
      }
      run++;
      confSum += confidence;
      if (!emitted && run >= minFrames && at - startedAt >= minMs) {
        emitted = true;
        return { label, confidence: confSum / run, startedAt };
      }
      return null;
    },
    reset() {
      current = '';
      run = 0;
      confSum = 0;
      emitted = false;
    },
  };
}
