/** MediaPipe VIDEO timestamps stay increasing even after a seek or camera restart. */
export function createTrackingClock() {
  let last = -1;
  let previousSource: number | null = null;
  return {
    restart() { previousSource = null; },
    next(sourceMs: number): number {
      if (!Number.isFinite(sourceMs)) throw new Error('Invalid tracking timestamp');
      const delta = previousSource === null ? 1 : Math.max(1, sourceMs - previousSource);
      previousSource = sourceMs;
      last += delta;
      return last;
    },
  };
}
