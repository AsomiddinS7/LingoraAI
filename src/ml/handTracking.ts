// Both hands and the upper body are processed locally. Raw video is never uploaded.
import { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { startFramePump } from '../pipeline/framePump';
import { metrics } from '../pipeline/metrics';
import { landmarksToFeatures, type Landmark } from './features';
import { createTrackingClock } from './trackingClock';
import { createHandAssociator } from './handIdentity';
import { acceptRecoveredHand, restoreCropLandmarks, wristRecoveryRegion } from './handRecovery';

export type TrackingMode = 'legacy' | 'stable' | 'recovery';
let trackingMode: TrackingMode = 'recovery';
export let TRACKING_PROFILE = 'hands-pose-recovery-video-v2';
const associator = createHandAssociator();
let lastRecovery = -Infinity;
let nextRecoverySlot: 0 | 1 = 0;
const diagnostics = { frames: 0, processingMs: 0, recoveryAttempts: 0, recoveryErrors: 0, recoveredHands: 0, singleHandFrames: 0, twoHandFrames: 0 };
export function trackingDiagnostics() { return { ...diagnostics, mode: trackingMode, recoveryAvailable: Boolean(recoveryLandmarker) }; }
/** Explicit benchmark modes use the same detector and frozen source frames. */
export function setTrackingMode(mode: TrackingMode) {
  trackingMode = mode;
  TRACKING_PROFILE = mode === 'legacy' ? 'hands-pose-video-v1' : `hands-pose-${mode}-video-v2`;
  associator.reset(); lastRecovery = -Infinity;
}
export const HAND_TRACKING_OPTIONS = {
  runningMode: 'VIDEO' as const, numHands: 2,
  minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.5,
};

export interface HandFrame {
  /** Primary hand, retained for the older static recognizer. */
  landmarks: Landmark[];
  handedness: string;
  features: number[];
  left: Landmark[] | null;
  right: Landmark[] | null;
  /** [nose, left shoulder, right shoulder, left elbow, right elbow, left wrist, right wrist]. */
  pose: Landmark[] | null;
  aspect: number;
  width: number;
  height: number;
  at: number;
}

let landmarker: HandLandmarker | null = null;
let poseLandmarker: PoseLandmarker | null = null;
let recoveryLandmarker: HandLandmarker | null = null;
let recoveryFactory: (()=>Promise<HandLandmarker>) | null = null;
let recoveryLoading: Promise<void> | null = null;
let handLoading: Promise<HandLandmarker> | null = null;
let loading: Promise<HandLandmarker> | null = null;
type VisionFileset = { wasmLoaderPath: string; wasmBinaryPath: string };
let filesetLoading: Promise<VisionFileset> | null = null;
let handModelLoading: Promise<Uint8Array> | null = null;
let poseModelLoading: Promise<Uint8Array> | null = null;
export let delegate: 'GPU' | 'CPU' | null = null;
export let poseDelegate: 'GPU' | 'CPU' | null = null;

function preferredDelegate(): 'GPU' | 'CPU' {
  if (import.meta.env.VITE_TRACKING_DELEGATE === 'CPU') return 'CPU';
  // Software WebGL can initialize successfully but make inference unusably slow.
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return 'CPU';
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /swiftshader|llvmpipe|software|basic render/i.test(renderer) ? 'CPU' : 'GPU';
}

async function loadRecoveryLandmarker() {
  if(!recoveryLandmarker&&recoveryFactory){
    recoveryLoading ??= recoveryFactory().then(model=>{recoveryLandmarker=model;}).catch(()=>{recoveryLandmarker=null;});
    await recoveryLoading;
  }
}

function loadFileset() {
  if (filesetLoading) return filesetLoading;
  const configured = String(import.meta.env.VITE_MEDIAPIPE_WASM_URL ?? '').trim();
  const root = (configured || new URL('mediapipe/wasm', document.baseURI).href).replace(/\/$/, '');
  // MediaPipe's SIMD probe can remain pending on static-host origins before it
  // issues any asset request. Current supported browsers all provide WASM SIMD,
  // so use the corresponding immutable runtime files directly.
  filesetLoading = Promise.resolve({
    wasmLoaderPath: `${root}/vision_wasm_internal.js`,
    wasmBinaryPath: `${root}/vision_wasm_internal.wasm`,
  });
  return filesetLoading;
}

function loadModel(path: string): Promise<Uint8Array> {
  return fetch(new URL(path, document.baseURI), { cache: 'force-cache' }).then(async response => {
    if (!response.ok) throw new Error(`Tracking model could not be loaded: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  });
}

/** Load just the hand graph so the live skeleton can appear before pose/recognition is ready. */
export function loadHandOverlayLandmarker(): Promise<HandLandmarker> {
  if (landmarker) return Promise.resolve(landmarker);
  const filesetPromise = loadFileset();
  handModelLoading ??= loadModel('model/hand_landmarker.task');
  if (handLoading) return handLoading;
  const pending = (async () => {
    const [fileset, modelAssetBuffer] = await Promise.all([filesetPromise, handModelLoading!]);
    const makeHand = (d: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer, delegate: d },
      ...HAND_TRACKING_OPTIONS,
    });
    const preferred = preferredDelegate();
    try { landmarker = await makeHand(preferred); delegate = preferred; }
    catch { landmarker = await makeHand('CPU'); delegate = 'CPU'; }
    return landmarker!;
  })();
  handLoading = pending;
  pending.catch(() => { if (handLoading === pending) handLoading = null; });
  return pending;
}

export function loadHandLandmarker(): Promise<HandLandmarker> {
  if (landmarker && poseLandmarker) return trackingMode==='recovery'
    ? loadRecoveryLandmarker().then(()=>landmarker!) : Promise.resolve(landmarker);
  if (loading) return loading;
  const pending = (async () => {
    const t0 = performance.now();
    const filesetPromise = loadFileset();
    const handPromise = loadHandOverlayLandmarker();
    handModelLoading ??= loadModel('model/hand_landmarker.task');
    poseModelLoading ??= loadModel('model/pose_landmarker.task');
    const [fileset, poseModelAssetBuffer] = await Promise.all([filesetPromise, poseModelLoading!]);
    await handPromise;
    const makePose = (d: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: poseModelAssetBuffer, delegate: d },
      runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { poseLandmarker = await makePose(delegate!); poseDelegate = delegate; }
    catch {
      try { poseLandmarker = await makePose('CPU'); poseDelegate = 'CPU'; }
      catch (err) { landmarker?.close(); landmarker = null; throw err; }
    }
    // Separate IMAGE inference never contaminates the main VIDEO tracker state.
    recoveryFactory = async () => HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: await handModelLoading!, delegate: delegate! },
        runningMode: 'IMAGE', numHands: 1, minHandDetectionConfidence: .5, minHandPresenceConfidence: .5,
      });
    if(trackingMode==='recovery')await loadRecoveryLandmarker();
    metrics.set({ modelLoadMs: performance.now() - t0 });
    return landmarker!;
  })();
  loading = pending;
  pending.catch(() => { if (loading === pending) loading = null; });
  return pending;
}

/** Assign hands using body wrists, including when hands cross or labels flicker. */
export function assignHands(hands: Landmark[][], labels: string[], pose: Landmark[] | null) {
  let left: Landmark[] | null = null;
  let right: Landmark[] | null = null;
  if (pose && hands.length) {
    const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
    if (hands.length > 1) {
      const normal = dist(hands[0][0], pose[5]) + dist(hands[1][0], pose[6]);
      const swapped = dist(hands[0][0], pose[6]) + dist(hands[1][0], pose[5]);
      [left, right] = normal <= swapped ? [hands[0], hands[1]] : [hands[1], hands[0]];
    } else if (dist(hands[0][0], pose[5]) <= dist(hands[0][0], pose[6])) left = hands[0];
    else right = hands[0];
  } else {
    hands.slice(0, 2).forEach((hand, i) => {
      if (labels[i] === 'Left' && !left) left = hand;
      else if (!right) right = hand;
      else if (!left) left = hand;
    });
  }
  return { left, right };
}

const videoClock = createTrackingClock();
let snapshot: HTMLCanvasElement | null = null;
let recoveryCanvas: HTMLCanvasElement | null = null;

/** Independent videos must not inherit the previous stream's tracked regions. */
export function beginTrackingSequence(): void {
  if (!landmarker) throw new Error('Hand tracking model not loaded');
  associator.reset(); lastRecovery = -Infinity; nextRecoverySlot = 0;
  for (const key of Object.keys(diagnostics) as (keyof typeof diagnostics)[]) diagnostics[key] = 0;
  const empty = document.createElement('canvas');
  empty.width = empty.height = 32;
  videoClock.restart();
  const timestamp = videoClock.next(0);
  // A blank warm-up frame clears tracked regions without fabricating observations.
  landmarker.detectForVideo(empty, timestamp);
  poseLandmarker?.detectForVideo(empty, timestamp);
  videoClock.restart();
}

/** Shared sequential live/offline processing. Call only after loadHandLandmarker(). */
export function trackVideoFrame(video: HTMLVideoElement, at = performance.now()): HandFrame | null {
  if (!landmarker) throw new Error('Hand tracking model not loaded');
  const started = performance.now();
  snapshot ??= document.createElement('canvas');
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (snapshot.width !== width) snapshot.width = width;
  if (snapshot.height !== height) snapshot.height = height;
  // Both models see the same instant, even when inference is slower than the camera.
  snapshot.getContext('2d')!.drawImage(video, 0, 0, width, height);
  const timestamp = videoClock.next(at);
  const result = landmarker.detectForVideo(snapshot, timestamp);
  const body = poseLandmarker?.detectForVideo(snapshot, timestamp).landmarks[0];
  const indices = [0, 11, 12, 13, 14, 15, 16];
  const pose = body ? indices.map((i) => ({ x: body[i].x, y: body[i].y, z: body[i].z })) : null;
  const hands = result.landmarks.map((h) => h.map(({ x, y, z }) => ({ x, y, z })));
  const labels = result.handedness.map((h) => h[0]?.categoryName ?? 'Right');
  const categories = result.handedness.map(h => ({ label:h[0]?.categoryName ?? 'Right', score:h[0]?.score }));
  const visibility: [number,number] = body ? [body[15].visibility ?? 1,body[16].visibility ?? 1] : [0,0];
  const aspect = width/height;
  const meanMs = diagnostics.frames ? diagnostics.processingMs/diagnostics.frames : 0;
  const recoveryInterval = delegate === 'GPU' && poseDelegate === 'GPU' && meanMs < 50 ? 80 : 200;
  if (trackingMode === 'recovery' && recoveryLandmarker && pose && hands.length < 2 && timestamp-lastRecovery >= recoveryInterval-.01) {
    const slots: (0 | 1)[] = [nextRecoverySlot, nextRecoverySlot === 0 ? 1 : 0];
    for (const slot of slots) {
      if (visibility[slot] < .5) continue;
      const region = wristRecoveryRegion(pose,slot,width,height);
      if (!region || hands.some(h=>Math.hypot((h[0].x-region.target.x)*width,(h[0].y-region.target.y)*height)<region.scale*.25)) continue;
      lastRecovery = timestamp; nextRecoverySlot = slot === 0 ? 1 : 0;
      recoveryCanvas ??= document.createElement('canvas');
      recoveryCanvas.width = recoveryCanvas.height = 256;
      recoveryCanvas.getContext('2d')!.drawImage(snapshot,region.x,region.y,region.size,region.size,0,0,256,256);
      diagnostics.recoveryAttempts++;
      try {
        const recovered = recoveryLandmarker.detect(recoveryCanvas);
        const points = recovered.landmarks[0] && restoreCropLandmarks(recovered.landmarks[0],region,width,height);
        if (points && acceptRecoveredHand(points,region,hands,width,height)) {
          hands.push(points); labels.push(slot === 0 ? 'Left' : 'Right');
          categories.push({ label:slot === 0 ? 'Left' : 'Right', score:recovered.handedness[0]?.[0]?.score });
          diagnostics.recoveredHands++;
        }
      } catch { diagnostics.recoveryErrors++; recoveryLandmarker.close(); recoveryLandmarker = null; }
      break; // bounded to one crop; GPU at most12.5Hz, CPU at most5Hz
    }
  }
  diagnostics.frames++;
  if (hands.length === 1) diagnostics.singleHandFrames++;
  if (hands.length >= 2) diagnostics.twoHandFrames++;
  // Keep the body for normalization, but trust wrist assignment only when both
  // anatomical wrists are visible. References use this same VIDEO pipeline.
  const slotPose = body && (body[15].visibility ?? 1) >= 0.3 && (body[16].visibility ?? 1) >= 0.3 ? pose : null;
  const { left, right } = trackingMode === 'legacy' ? assignHands(hands, labels, slotPose)
    : associator.update(hands,categories,pose,visibility,timestamp,aspect);
  diagnostics.processingMs += performance.now()-started;
  if (!left && !right) return null;
  const landmarks = right ?? left!;
  const handedness = right ? 'Right' : 'Left';
  return { landmarks, handedness, features: landmarksToFeatures(landmarks, handedness),
    left, right, pose, aspect: width / height, width, height, at };
}

type Listener = (f: HandFrame | null, capturedAt: number, videoTime?: number) => void;
const listeners = new Set<Listener>();
let latest: HandFrame | null = null;
let current: { video: HTMLVideoElement; stop: () => void; users: number } | null = null;

export const handTracking = {
  latest: () => latest,
  active: () => current !== null,
  subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
  acquire(video: HTMLVideoElement): () => void {
    if (!landmarker) throw new Error('Hand landmarker not loaded');
    if (current && current.video !== video) { current.stop(); current = null; }
    if (!current) {
      beginTrackingSequence();
      latest = null;
      listeners.forEach((l) => l(null, performance.now()));
      const stop = startFramePump(video, (v) => {
        // Record the instant the video is sampled, before synchronous hand and
        // pose inference. Using completion time distorts movement when it lags.
        const capturedAt = performance.now();
        const videoTime = v.currentTime;
        try { latest = trackVideoFrame(v, capturedAt); }
        catch (error) { latest = null; listeners.forEach((l) => l(null, capturedAt, videoTime)); throw error; }
        listeners.forEach((l) => l(latest, capturedAt, videoTime));
      }, {
        maxFps: 30,
        onStats: (s) => metrics.set({ processedFps: s.processedFps, avgProcessMs: s.avgProcessMs, skippedPerSec: s.skippedPerSec }),
      });
      current = { video, stop, users: 0 };
    }
    current.users++;
    const mine = current;
    let released = false;
    return () => {
      if (released || current !== mine) return;
      released = true;
      if (--mine.users <= 0) {
        mine.stop(); current = null; latest = null;
        listeners.forEach((l) => l(null, performance.now()));
      }
    };
  },
};
