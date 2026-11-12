// Live performance numbers for the camera and recognition pipeline. Measured, never estimated.
import { useSyncExternalStore } from 'react';

export interface PipelineMetrics {
  /** Frames the camera actually delivered per second (requestVideoFrameCallback). */
  cameraFps: number | null;
  /** Frames the classifier processed per second (only when the classifier uses the frame pump). */
  processedFps: number | null;
  /** Average per-frame processing time of the classifier, ms. */
  avgProcessMs: number | null;
  /** Frames skipped per second because the previous frame was still being processed. */
  skippedPerSec: number | null;
  /** Gesture events received from the classifier. */
  events: number;
  /** Repeated gestures suppressed by the gesture gate. */
  suppressed: number;
  /** Detection -> on screen: classifier event until the next painted frame, ms. */
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  /** Time between consecutive gesture events, ms (for the mock this is its demo cadence). */
  avgEventIntervalMs: number | null;
  classifier: 'mock' | 'model' | null;
}

const empty: PipelineMetrics = {
  cameraFps: null,
  processedFps: null,
  avgProcessMs: null,
  skippedPerSec: null,
  events: 0,
  suppressed: 0,
  lastLatencyMs: null,
  avgLatencyMs: null,
  avgEventIntervalMs: null,
  classifier: null,
};

let state: PipelineMetrics = { ...empty };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const latencies: number[] = [];
const intervals: number[] = [];
let lastEventAt: number | null = null;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pushWindow = (xs: number[], v: number, n = 50) => {
  xs.push(v);
  if (xs.length > n) xs.shift();
};

export const metrics = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set(patch: Partial<PipelineMetrics>) {
    state = { ...state, ...patch };
    emit();
  },
  recordEvent(now: number) {
    if (lastEventAt !== null) pushWindow(intervals, now - lastEventAt);
    lastEventAt = now;
    state = { ...state, events: state.events + 1, avgEventIntervalMs: avg(intervals) };
    emit();
  },
  recordSuppressed() {
    state = { ...state, suppressed: state.suppressed + 1 };
    emit();
  },
  recordLatency(ms: number) {
    pushWindow(latencies, ms);
    state = { ...state, lastLatencyMs: ms, avgLatencyMs: avg(latencies) };
    emit();
  },
  /** Called when listening (re)starts so intervals do not include pauses. */
  resetCadence() {
    lastEventAt = null;
  },
  reset() {
    latencies.length = 0;
    intervals.length = 0;
    lastEventAt = null;
    state = { ...empty, cameraFps: state.cameraFps, classifier: state.classifier };
    emit();
  },
};

export function useMetrics(): PipelineMetrics {
  return useSyncExternalStore(metrics.subscribe, metrics.get);
}
