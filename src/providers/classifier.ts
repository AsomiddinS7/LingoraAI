// SignClassifier implementations. The real classifier (MediaPipe, TF.js, thresholds, stability
// filter) is the team's. This file only holds the mock and the loader hook for /model.
import { VOCAB_LABELS } from '../data';
import { startFramePump, type FrameProcessor, type FramePumpOptions } from '../pipeline/framePump';
import { metrics } from '../pipeline/metrics';
import { handTracking, loadHandLandmarker } from '../ml/handTracking';
import { predict } from '../ml/knn';
import { sampleStore } from '../ml/samples';
import { createStabilityFilter } from '../ml/stability';
import type { SignClassifier, SignLabel } from '../types';

export interface MockClassifierOptions {
  shouldFail: () => boolean;
  /** Demo cadence: ms between fake 'stable sign' events. NOT a recognition speed. */
  intervalMs?: () => number;
  random?: () => number;
}

/**
 * Mock (brief section 9): steps through the placeholder vocabulary on a timer with confidences
 * between 0.55 and 0.98 and an occasional 'none', so low-confidence and Not recognized appear.
 * Emits one event per (pretend) stable sign. It never reads the video pixels.
 */
export class MockSignClassifier implements SignClassifier {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  constructor(private opts: MockClassifierOptions) {}

  async load(): Promise<void> {
    await new Promise((r) => setTimeout(r, 700));
    if (this.opts.shouldFail()) throw new Error('Mock classifier failed to load (console switch)');
  }

  attach(_video: HTMLVideoElement, onSign: (r: { label: SignLabel | 'none'; confidence: number }) => void): void {
    this.detach();
    const rand = this.opts.random ?? Math.random;
    const tick = () => {
      const i = this.step++;
      if (i % 5 === 4) {
        onSign({ label: 'none', confidence: 0.55 + rand() * 0.2 });
        return;
      }
      const label = VOCAB_LABELS[i % VOCAB_LABELS.length];
      onSign({ label, confidence: Math.round((0.55 + rand() * 0.43) * 100) / 100 });
    };
    // setTimeout chain so a cadence change in the Console applies on the next event.
    const loop = () => {
      this.timer = setTimeout(() => {
        tick();
        loop();
      }, this.opts.intervalMs?.() ?? 1200);
    };
    loop();
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Loader hook for the team's model. Drop `classifier.js` into public/model/ exporting
 * `createClassifier(): SignClassifier`, set VITE_SIGN_CLASSIFIER=model, and it is used here.
 * If the file is missing or throws, the UI shows the "model failed" state (N2).
 */
export class ModelSignClassifier implements SignClassifier {
  private inner: SignClassifier | null = null;

  async load(): Promise<void> {
    const url = new URL('model/classifier.js', document.baseURI).href;
    const mod = (await import(/* @vite-ignore */ url)) as { createClassifier?: (helpers: ClassifierHelpers) => SignClassifier };
    if (typeof mod.createClassifier !== 'function') throw new Error('model/classifier.js must export createClassifier()');
    this.inner = mod.createClassifier(classifierHelpers);
    await this.inner.load();
  }

  attach(video: HTMLVideoElement, onSign: (r: { label: SignLabel | 'none'; confidence: number }) => void): void {
    this.inner?.attach(video, onSign);
  }

  detach(): void {
    this.inner?.detach();
  }
}

/** Passed to the team's createClassifier(helpers). Using it is optional but gives measured FPS. */
export interface ClassifierHelpers {
  startFramePump: (video: HTMLVideoElement, process: FrameProcessor, opts?: Omit<FramePumpOptions, 'onStats'>) => () => void;
}

export const classifierHelpers: ClassifierHelpers = {
  startFramePump: (video, process, opts) =>
    startFramePump(video, process, {
      ...opts,
      onStats: (s) => metrics.set({ processedFps: s.processedFps, avgProcessMs: s.avgProcessMs, skippedPerSec: s.skippedPerSec }),
    }),
};

/** Convention for onSign: label 'none' with confidence exactly 0 means "no hand in view". */
export const NO_HAND = 0;
/** Unknown hand pose (not close to any recorded sign). */
const UNKNOWN_POSE = 0.01;

/**
 * Real recognition: MediaPipe Hand Landmarker (on-device ML) + k-NN over landmark features,
 * trained on samples recorded in the Console. With no samples it recognises nothing.
 */
export class MediaPipeSignClassifier implements SignClassifier {
  private release: (() => void) | null = null;
  private unsub: (() => void) | null = null;
  private filter = createStabilityFilter(3, 150);
  private hadHand = false;

  async load(): Promise<void> {
    await loadHandLandmarker();
  }

  attach(video: HTMLVideoElement, onSign: (r: { label: SignLabel | 'none'; confidence: number }) => void): void {
    this.detach();
    this.filter.reset();
    this.release = handTracking.acquire(video);
    this.unsub = handTracking.subscribe((frame) => {
      if (!frame) {
        if (this.hadHand) {
          this.hadHand = false;
          this.filter.reset();
          onSign({ label: 'none', confidence: NO_HAND });
        }
        return;
      }
      this.hadHand = true;
      const model = sampleStore.model();
      if (model.samples.length === 0) return;
      const p = predict(model, frame.features);
      const ev = this.filter.feed(p.label, p.confidence, frame.at);
      if (!ev) return;
      if (ev.label !== 'none') metrics.recordRecognition(performance.now() - ev.startedAt);
      onSign(ev.label === 'none' ? { label: 'none', confidence: UNKNOWN_POSE } : { label: ev.label, confidence: ev.confidence });
    });
  }

  detach(): void {
    this.unsub?.();
    this.release?.();
    this.unsub = this.release = null;
    this.hadHand = false;
  }
}
