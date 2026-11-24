import { handTracking, loadHandLandmarker } from '../ml/handTracking';
import { sequenceStore, type SequenceStore } from '../ml/sequenceStore';
import type { SequenceFrame } from '../ml/sequence';
import { metrics } from '../pipeline/metrics';
import { runtime } from '../runtime';
import { Emitter, type SequenceRecognizer } from './types';
import { createWindowRunner } from './windowRunner';
import { registerModelWords } from '../data';

/** A bounded signing turn matched against labeled examples from existing videos. */
export class MotionRecognizer extends Emitter implements SequenceRecognizer {
  constructor(private options: { store?: SequenceStore; modelUrl?: string; maxRecordingMs?: number } = {}) { super(); }
  private get store() { return this.options.store ?? sequenceStore; }
  private timing = () => ({ ...runtime.get().config.signWindow,
    ...(this.options.maxRecordingMs ? { maxRecordingMs: this.options.maxRecordingMs } : {}) });
  private release: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private collecting = false;
  private frames: SequenceFrame[] = [];
  // A fixed window avoids treating the pause inside a moving sign as its endpoint.
  private runner = createWindowRunner({
    emitter: this,
    timing: () => this.timing(),
    simulatedRestAfterMs: () => this.timing().maxRecordingMs,
    onRecordingStart: () => { this.frames = []; this.collecting = true; },
    onRecordingEnd: () => { this.collecting = false; },
    onProcessed: (ms) => metrics.set({ lastProcessingMs: ms }),
    classify: () => this.store.match(this.trim(this.frames)),
  });

  async load(): Promise<void> {
    await loadHandLandmarker();
    const url = this.options.modelUrl ?? runtime.get().config.motionModelUrl;
    if (url && this.store.all().length === 0) {
      const response = await fetch(new URL(url, document.baseURI), { cache: 'no-store' });
      if (!response.ok) throw new Error('Motion examples could not be loaded');
      const text = await response.text();
      this.store.importJson(text);
      if (!this.options.store) registerModelWords(this.store.vocabulary());
    }
  }

  attach(video: HTMLVideoElement): void {
    this.detach();
    this.release = handTracking.acquire(video);
    this.unsubscribe = handTracking.subscribe((frame) => {
      if (!this.collecting) return;
      const t = performance.now();
      if (this.frames.length && t - this.frames[this.frames.length - 1].t < 50) return;
      this.frames.push(frame
        ? { t, left: frame.left, right: frame.right, pose: frame.pose, aspect: frame.aspect }
        : { t, left: null, right: null });
    });
  }
  detach(): void {
    this.runner.cancel(); this.collecting = false;
    this.unsubscribe?.(); this.release?.();
    this.unsubscribe = this.release = null;
  }
  startWindow(): void {
    if (!this.store.all().length) { this.emit('error', { message: 'no_templates' }); return; }
    this.runner.start();
  }
  cancelWindow(): void { this.collecting = false; this.runner.cancel(); }
  finishWindow(): void { this.runner.finish(); }

  private trim(frames: SequenceFrame[]): SequenceFrame[] {
    // Only remove empty endpoints; never concatenate through a tracking dropout.
    const first = frames.findIndex((f) => f.left || f.right);
    if (first < 0) return frames;
    let last = frames.length - 1;
    while (last > first && !frames[last].left && !frames[last].right) last--;
    return frames.slice(first, last + 1);
  }
}
