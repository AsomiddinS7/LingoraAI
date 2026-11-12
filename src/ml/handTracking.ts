// Real hand tracking with MediaPipe Hand Landmarker, on device. WASM runtime and model are
// served from this site (public/mediapipe, public/model) and loaded lazily: the first screen
// does not pay for them (N1). Frames never leave the browser.
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { startFramePump } from '../pipeline/framePump';
import { metrics } from '../pipeline/metrics';
import { landmarksToFeatures, type Landmark } from './features';

export interface HandFrame {
  landmarks: Landmark[];
  handedness: string;
  features: number[];
  /** frame time (ms, performance clock) */
  at: number;
}

let landmarker: HandLandmarker | null = null;
let loading: Promise<HandLandmarker> | null = null;
export let delegate: 'GPU' | 'CPU' | null = null;

export function loadHandLandmarker(): Promise<HandLandmarker> {
  if (landmarker) return Promise.resolve(landmarker);
  loading ??= (async () => {
    const t0 = performance.now();
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const base = document.baseURI;
    const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', base).href);
    const make = (d: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL('model/hand_landmarker.task', base).href, delegate: d },
        runningMode: 'VIDEO',
        numHands: 1, // placeholder vocabulary is one-handed; 1 hand is ~2x faster than 2
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      landmarker = await make('GPU');
      delegate = 'GPU';
    } catch (err) {
      console.warn('[SignConnect] GPU delegate unavailable, using CPU', err);
      landmarker = await make('CPU');
      delegate = 'CPU';
    }
    // Warm-up: the first inference compiles GPU shaders / allocates buffers and can take seconds.
    // Pay that cost here (behind "Loading sign recognition…"), not on the signer's first frame.
    const warm = document.createElement('canvas');
    warm.width = 256;
    warm.height = 256;
    warm.getContext('2d')!.fillRect(0, 0, 256, 256);
    landmarker.detectForVideo(warm, performance.now());
    lastTs = performance.now();
    metrics.set({ modelLoadMs: performance.now() - t0 });
    return landmarker;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

// ---------- shared tracking loop (one video at a time, reference counted) ----------
type Listener = (f: HandFrame | null) => void;
const listeners = new Set<Listener>();
let latest: HandFrame | null = null;
let current: { video: HTMLVideoElement; stop: () => void; users: number } | null = null;
let lastTs = 0;

export const handTracking = {
  latest: () => latest,
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Starts tracking on this video (needs loadHandLandmarker() first). Returns a release function. */
  acquire(video: HTMLVideoElement): () => void {
    if (!landmarker) throw new Error('Hand landmarker not loaded');
    if (current && current.video !== video) {
      current.stop();
      current = null;
    }
    if (!current) {
      const lmk = landmarker;
      const stop = startFramePump(
        video,
        (v, frameTime) => {
          const ts = Math.max(frameTime, lastTs + 1); // MediaPipe needs strictly increasing timestamps
          lastTs = ts;
          const r = lmk.detectForVideo(v, ts);
          const lm = r.landmarks?.[0];
          if (lm) {
            const handedness = r.handedness?.[0]?.[0]?.categoryName ?? 'Right';
            latest = { landmarks: lm, handedness, features: landmarksToFeatures(lm, handedness), at: frameTime };
          } else latest = null;
          listeners.forEach((l) => l(latest));
        },
        {
          maxFps: 30,
          onStats: (s) => metrics.set({ processedFps: s.processedFps, avgProcessMs: s.avgProcessMs, skippedPerSec: s.skippedPerSec }),
        },
      );
      current = { video, stop, users: 0 };
    }
    current.users++;
    const mine = current;
    let released = false;
    return () => {
      if (released || current !== mine) return;
      released = true;
      mine.users--;
      if (mine.users <= 0) {
        mine.stop();
        current = null;
        latest = null;
        listeners.forEach((l) => l(null));
      }
    };
  },
};
