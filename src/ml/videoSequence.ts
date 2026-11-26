import { loadHandLandmarker, beginTrackingSequence, trackVideoFrame, handTracking } from './handTracking';
import type { SequenceFrame } from './sequence';
// Diagnostics and controls must refer to the exact instance used by this extractor.
export { setTrackingMode,trackingDiagnostics,loadHandLandmarker,handTracking,TRACKING_PROFILE,delegate,poseDelegate } from './handTracking';

export function videoSampleTimes(start: number, end: number): number[] {
  // A rounding error near an integer must not create a duplicate final frame.
  const count = Math.max(1, Math.ceil((end - start) * 12.5 - 1e-9));
  return Array.from({ length: count + 1 }, (_, i) => i === count ? end : start + i / 12.5);
}

async function seek(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (Math.abs(video.currentTime - time) < 0.005 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); signal?.removeEventListener('abort', abort); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Video could not be decoded')); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(fail, 8000);
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    video.currentTime = time;
  });
}

/** Decode only the selected interval from a local video, without uploading the file. */
export async function extractVideoSequence(video: HTMLVideoElement, start: number, end: number,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void; maxSeconds?: number } = {}): Promise<SequenceFrame[]> {
  const maxSeconds = Math.min(options.maxSeconds ?? 12, 20);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > video.duration || end - start < 0.3 || end - start > maxSeconds)
    throw new Error(`Select an interval between 0.3 and ${maxSeconds} seconds`);
  if (handTracking.active()) throw new Error('Stop the camera before extracting a video');
  await loadHandLandmarker();
  beginTrackingSequence();
  video.pause();
  // Live signing starts after the tracker has acquired the camera. Prime the
  // tracker on preceding source frames too; exclude pre-roll from the example.
  for (let time = Math.max(0, start - 0.5); time < start - 0.005; time += 1 / 12.5) {
    await seek(video, time, options.signal);
    trackVideoFrame(video, (time - start) * 1000);
  }
  const frames: SequenceFrame[] = [];
  const times = videoSampleTimes(start, end);
  for (let i = 0; i < times.length; i++) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const time = times[i];
    await seek(video, time, options.signal);
    const frame = trackVideoFrame(video, (time - start) * 1000);
    frames.push(frame ? { t: (time - start) * 1000, left: frame.left, right: frame.right, pose: frame.pose, aspect: frame.aspect }
      : { t: (time - start) * 1000, left: null, right: null, aspect: video.videoWidth / video.videoHeight });
    options.onProgress?.((i + 1) / times.length);
    // Yield so Cancel and progress updates remain responsive during extraction.
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return frames;
}
