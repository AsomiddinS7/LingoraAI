// Sign window timing shared by the app's own recognizers (mock and static):
// countdown -> recording (until the hands rest, or a maximum) -> processing -> result.
import type { SignWindowConfig } from '../config';
import type { Emitter, RecognitionResult } from './types';

export interface MotionSample {
  at: number;
  /** Mean landmark movement since the previous frame (image units); null = no hand in view. */
  motion: number | null;
}

/** Below this per-frame movement the hands count as resting. Starting value; tune from tests. */
export const REST_MOTION = 0.006;

export interface RunnerOptions {
  emitter: Emitter;
  timing: () => SignWindowConfig;
  /** Live motion samples. Without one (mock) the recording ends after `simulatedRestAfterMs`. */
  subscribeMotion?: (cb: (s: MotionSample) => void) => () => void;
  simulatedRestAfterMs?: () => number;
  onRecordingStart?: () => void;
  onRecordingEnd?: () => void;
  classify: () => RecognitionResult | Promise<RecognitionResult>;
  /** Called with ms from end of recording to result (for the performance panel). */
  onProcessed?: (ms: number) => void;
  tickMs?: number;
}

export function createWindowRunner(o: RunnerOptions) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;
  let run = 0; // invalidates late callbacks after cancel
  const tick = o.tickMs ?? 50;

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
    unsub?.();
    unsub = null;
  };

  function processing(id: number) {
    clear();
    o.onRecordingEnd?.();
    const t0 = performance.now();
    o.emitter.emit('progress', { phase: 'processing', ms: 0 });
    Promise.resolve()
      .then(o.classify)
      .then(
        (r) => {
          if (id !== run) return;
          o.onProcessed?.(performance.now() - t0);
          o.emitter.emit('result', r);
        },
        (err: unknown) => id === run && o.emitter.emit('error', { message: err instanceof Error ? err.message : String(err) }),
      );
  }

  function recording(id: number) {
    const cfg = o.timing();
    const start = performance.now();
    let seenHand = false;
    let restSince: number | null = null;
    const simulatedEnd = o.subscribeMotion ? null : start + (o.simulatedRestAfterMs?.() ?? 1500);
    o.onRecordingStart?.();

    if (o.subscribeMotion) {
      unsub = o.subscribeMotion((s) => {
        if (s.motion !== null) seenHand = true;
        const resting = s.motion === null || s.motion < REST_MOTION;
        if (!resting) restSince = null;
        else restSince ??= s.at;
      });
    }

    timer = setInterval(() => {
      if (id !== run) return;
      const now = performance.now();
      const ms = now - start;
      o.emitter.emit('progress', { phase: 'recording', ms, totalMs: cfg.maxRecordingMs });
      const rested = seenHand && restSince !== null && now - restSince >= cfg.restMs && ms >= cfg.minRecordingMs;
      if (ms >= cfg.maxRecordingMs || rested || (simulatedEnd !== null && now >= simulatedEnd)) processing(id);
    }, tick);
  }

  return {
    start() {
      clear();
      const id = ++run;
      const cfg = o.timing();
      const start = performance.now();
      o.emitter.emit('progress', { phase: 'countdown', ms: 0, totalMs: cfg.countdownMs });
      timer = setInterval(() => {
        if (id !== run) return;
        const ms = performance.now() - start;
        if (ms >= cfg.countdownMs) {
          clear();
          recording(id);
        } else o.emitter.emit('progress', { phase: 'countdown', ms, totalMs: cfg.countdownMs });
      }, tick);
    },
    cancel() {
      run++;
      clear();
    },
  };
}

/** Mean per-landmark displacement between two frames of 21 landmarks. */
export function landmarkMotion(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return s / Math.max(1, Math.min(a.length, b.length));
}

/** Combines per-frame predictions of a window into one result with up to 2 alternatives. */
export function aggregate(preds: { label: string; confidence: number }[], k = 3): RecognitionResult {
  if (preds.length === 0) return { label: 'none', confidence: 0, alternatives: [], reason: 'no_hands' };
  const score = new Map<string, number>();
  for (const p of preds) if (p.label !== 'none') score.set(p.label, (score.get(p.label) ?? 0) + p.confidence);
  const ranked = [...score].map(([label, s]) => ({ label, confidence: s / preds.length })).sort((a, b) => b.confidence - a.confidence);
  if (ranked.length === 0) return { label: 'none', confidence: 0, alternatives: [], reason: 'unknown_sign' };
  return { label: ranked[0].label, confidence: ranked[0].confidence, alternatives: ranked.slice(1, k) };
}
