// Real-time frame scheduling for the classifier. Handed to the team's model (see public/model/README.md).
//
// - Runs on requestVideoFrameCallback: exactly one callback per *new* camera frame, so the
//   classifier never processes the same frame twice (falls back to requestAnimationFrame).
// - Never queues work: if the previous frame is still being processed, the new frame is skipped
//   (latest-frame-wins). Latency stays bounded instead of growing with a backlog.
// - Optional maxFps cap so a heavy model leaves time for the UI thread.
// - Reports processed FPS, average processing time and skipped frames to the metrics store.

export type FrameProcessor = (video: HTMLVideoElement, frameTime: number) => void | Promise<void>;

export interface FramePumpOptions {
  /** Upper bound on processed frames per second. Default: every camera frame. */
  maxFps?: number;
  onStats?: (s: { processedFps: number; avgProcessMs: number; skippedPerSec: number }) => void;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export function startFramePump(video: HTMLVideoElement, process: FrameProcessor, opts: FramePumpOptions = {}): () => void {
  const v = video as VideoWithRvfc;
  const minGap = opts.maxFps ? 1000 / opts.maxFps : 0;
  let running = true;
  let busy = false;
  let lastRun = -Infinity;
  let handle = 0;
  let processed = 0;
  let skipped = 0;
  let totalMs = 0;
  let windowStart = performance.now();

  const schedule = () => {
    if (!running) return;
    handle = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  };

  const report = (now: number) => {
    const elapsed = now - windowStart;
    if (elapsed < 1000) return;
    opts.onStats?.({
      processedFps: (processed * 1000) / elapsed,
      avgProcessMs: processed ? totalMs / processed : 0,
      skippedPerSec: (skipped * 1000) / elapsed,
    });
    processed = skipped = totalMs = 0;
    windowStart = now;
  };

  function tick(now: number) {
    if (!running) return;
    schedule(); // ask for the next frame first so processing never delays scheduling
    report(now);
    if (video.readyState < 2) return; // no decoded frame yet
    if (busy || now - lastRun < minGap) {
      skipped++;
      return;
    }
    busy = true;
    lastRun = now;
    const t0 = performance.now();
    const done = () => {
      totalMs += performance.now() - t0;
      processed++;
      busy = false;
    };
    try {
      const r = process(video, now);
      if (r && typeof (r as Promise<void>).then === 'function') (r as Promise<void>).then(done, done);
      else done();
    } catch (err) {
      done();
      console.warn('[SignConnect] frame processor threw', err);
    }
  }

  schedule();
  return () => {
    running = false;
    if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
  };
}

/** Measures the frame rate the camera actually delivers, without processing anything. */
export function startFpsMeter(video: HTMLVideoElement, onFps: (fps: number) => void): () => void {
  let frames = 0;
  let start = performance.now();
  return startFramePump(video, () => {
    frames++;
    const now = performance.now();
    if (now - start >= 1000) {
      onFps((frames * 1000) / (now - start));
      frames = 0;
      start = now;
    }
  });
}
