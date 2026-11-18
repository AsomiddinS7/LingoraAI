// The app's recognizers behind the SequenceRecognizer interface:
// - MockRecognizer: no model; returns demo results so the whole app runs (spec: mock mode).
// - StaticRecognizer (v0): real MediaPipe hand tracking + k-NN over held hand shapes.
// - loadSequenceRecognizer: the ML team's model, found via GET /api/model/active.
import { vocabLabels } from '../data';
import { handTracking, loadHandLandmarker } from '../ml/handTracking';
import { predict } from '../ml/knn';
import { sampleStore } from '../ml/samples';
import { metrics } from '../pipeline/metrics';
import { runtime } from '../runtime';
import { Emitter, type ModelManifest, type RecognitionResult, type SequenceRecognizer } from './types';
import { aggregate, createWindowRunner, landmarkMotion, type MotionSample } from './windowRunner';

const timing = () => runtime.get().config.signWindow;
const recordProcessing = (ms: number) => metrics.set({ lastProcessingMs: ms });

export class MockRecognizer extends Emitter implements SequenceRecognizer {
  private step = 0;
  private runner = createWindowRunner({
    emitter: this,
    timing,
    simulatedRestAfterMs: () => 1200 + Math.random() * 1000,
    onProcessed: recordProcessing,
    classify: () => this.fake(),
  });

  async load(): Promise<void> {
    await new Promise((r) => setTimeout(r, 400));
    if (runtime.get().demo.simClassifierFail) throw new Error('Mock recognizer failed to load (console switch)');
  }
  attach(): void {}
  detach(): void {
    this.runner.cancel();
  }
  startWindow(): void {
    this.runner.start();
  }
  cancelWindow(): void {
    this.runner.cancel();
  }

  /** Demo results: steps through the sign list, sometimes unsure, sometimes nothing. */
  private async fake(): Promise<RecognitionResult> {
    await new Promise((r) => setTimeout(r, 250));
    const labels = vocabLabels();
    const i = this.step++;
    if (i % 6 === 5) return { label: 'none', confidence: 0.3, alternatives: [], reason: 'mock' };
    const pick = (n: number) => labels[n % labels.length];
    const top = i % 6 === 3 ? 0.62 : 0.86 + Math.random() * 0.12;
    return {
      label: pick(i),
      confidence: Math.round(top * 100) / 100,
      alternatives: [
        { label: pick(i + 3), confidence: Math.round(top * 0.35 * 100) / 100 },
        { label: pick(i + 7), confidence: Math.round(top * 0.15 * 100) / 100 },
      ],
      reason: 'mock',
    };
  }
}

export class StaticRecognizer extends Emitter implements SequenceRecognizer {
  private release: (() => void) | null = null;
  private frames: { label: string; confidence: number }[] = [];
  private collecting = false;
  private unsubCollect: (() => void) | null = null;
  private runner = createWindowRunner({
    emitter: this,
    timing,
    subscribeMotion: (cb) => {
      let prev: { x: number; y: number }[] | null = null;
      return handTracking.subscribe((f) => {
        const s: MotionSample = { at: performance.now(), motion: null };
        if (f) {
          s.motion = prev ? landmarkMotion(prev, f.landmarks) : 1;
          prev = f.landmarks;
        } else prev = null;
        cb(s);
      });
    },
    onRecordingStart: () => {
      this.frames = [];
      this.collecting = true;
    },
    onRecordingEnd: () => {
      this.collecting = false;
    },
    onProcessed: recordProcessing,
    classify: () => this.classify(),
  });

  async load(): Promise<void> {
    await loadHandLandmarker();
  }

  attach(video: HTMLVideoElement): void {
    this.detach();
    this.release = handTracking.acquire(video);
    this.unsubCollect = handTracking.subscribe((f) => {
      if (!this.collecting || !f) return;
      const model = sampleStore.model();
      if (model.samples.length) this.frames.push(predict(model, f.features));
    });
  }

  detach(): void {
    this.runner.cancel();
    this.unsubCollect?.();
    this.release?.();
    this.unsubCollect = this.release = null;
  }

  startWindow(): void {
    if (sampleStore.all().length === 0) {
      this.emit('error', { message: 'not_trained' });
      return;
    }
    this.runner.start();
  }

  cancelWindow(): void {
    this.runner.cancel();
    this.collecting = false;
  }

  private classify(): RecognitionResult {
    // Use the settled part of the window: the first 30% is usually the hand moving into place.
    const settled = this.frames.slice(Math.floor(this.frames.length * 0.3));
    return aggregate(settled);
  }
}

// ---------------- ML team's sequence model via the model registry ----------------

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ActiveModel {
  manifest_url: string;
  version: string;
  sha256: string;
}

/**
 * GET /api/model/active -> manifest URL, version, sha256. The manifest bytes are verified
 * against that sha256; files are cached by the browser per version (versioned URLs).
 * The entry module must export createSequenceRecognizer(): SequenceRecognizer.
 */
export async function loadSequenceRecognizer(getActive: () => Promise<ActiveModel>): Promise<SequenceRecognizer> {
  const active = await getActive();
  const res = await fetch(active.manifest_url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const bytes = await res.arrayBuffer();
  const hash = await sha256Hex(bytes);
  if (hash !== active.sha256.toLowerCase()) throw new Error('Model manifest checksum does not match');
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as ModelManifest;
  const entry = manifest.entry ?? manifest.files.find((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  if (!entry) throw new Error('Model manifest has no JavaScript entry');
  const mod = (await import(/* @vite-ignore */ new URL(entry, new URL(active.manifest_url, document.baseURI)).href)) as {
    createSequenceRecognizer?: () => SequenceRecognizer;
  };
  if (typeof mod.createSequenceRecognizer !== 'function') throw new Error('Model entry must export createSequenceRecognizer()');
  const rec = mod.createSequenceRecognizer();
  await rec.load(manifest);
  return rec;
}
