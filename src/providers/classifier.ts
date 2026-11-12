// SignClassifier implementations. The real classifier (MediaPipe, TF.js, thresholds, stability
// filter) is the team's. This file only holds the mock and the loader hook for /model.
import { VOCAB_LABELS } from '../data';
import type { SignClassifier, SignLabel } from '../types';

export interface MockClassifierOptions {
  shouldFail: () => boolean;
  intervalMs?: number;
  random?: () => number;
}

/**
 * Mock (brief section 9): steps through the placeholder vocabulary on a timer with confidences
 * between 0.55 and 0.98 and an occasional 'none', so low-confidence and Not recognized appear.
 * Emits one event per (pretend) stable sign. It never reads the video pixels.
 */
export class MockSignClassifier implements SignClassifier {
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  constructor(private opts: MockClassifierOptions) {}

  async load(): Promise<void> {
    await new Promise((r) => setTimeout(r, 700));
    if (this.opts.shouldFail()) throw new Error('Mock classifier failed to load (console switch)');
  }

  attach(_video: HTMLVideoElement, onSign: (r: { label: SignLabel | 'none'; confidence: number }) => void): void {
    this.detach();
    const rand = this.opts.random ?? Math.random;
    this.timer = setInterval(() => {
      const i = this.step++;
      if (i % 5 === 4) {
        onSign({ label: 'none', confidence: 0.55 + rand() * 0.2 });
        return;
      }
      const label = VOCAB_LABELS[i % VOCAB_LABELS.length];
      onSign({ label, confidence: Math.round((0.55 + rand() * 0.43) * 100) / 100 });
    }, this.opts.intervalMs ?? 2600);
  }

  detach(): void {
    if (this.timer) clearInterval(this.timer);
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
    const mod = (await import(/* @vite-ignore */ url)) as { createClassifier?: () => SignClassifier };
    if (typeof mod.createClassifier !== 'function') throw new Error('model/classifier.js must export createClassifier()');
    this.inner = mod.createClassifier();
    await this.inner.load();
  }

  attach(video: HTMLVideoElement, onSign: (r: { label: SignLabel | 'none'; confidence: number }) => void): void {
    this.inner?.attach(video, onSign);
  }

  detach(): void {
    this.inner?.detach();
  }
}
