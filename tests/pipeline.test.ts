// Frame pump tests.
import { describe, expect, it } from 'vitest';
import { startFramePump } from '../src/pipeline/framePump';

function fakeVideo() {
  const cbs: ((now: number) => void)[] = [];
  const video = {
    readyState: 4,
    requestVideoFrameCallback: (cb: (now: number) => void) => cbs.push(cb),
    cancelVideoFrameCallback: () => {},
  } as unknown as HTMLVideoElement;
  /** Deliver one camera frame at time `now`. */
  const frame = (now: number) => {
    const pending = cbs.splice(0);
    pending.forEach((cb) => cb(now));
  };
  return { video, frame };
}

describe('frame pump', () => {
  it('processes each new frame exactly once', () => {
    const { video, frame } = fakeVideo();
    let n = 0;
    const stop = startFramePump(video, () => {
      n++;
    });
    for (let i = 1; i <= 10; i++) frame(i * 33);
    stop();
    expect(n).toBe(10);
  });

  it('skips frames while the model is busy instead of queueing them (latest frame wins)', async () => {
    const { video, frame } = fakeVideo();
    const seen: number[] = [];
    let release: () => void = () => {};
    const stop = startFramePump(video, (_v, t) => {
      seen.push(t);
      return new Promise<void>((r) => (release = r));
    });
    frame(33); // starts processing
    frame(66); // busy -> skipped
    frame(99); // busy -> skipped
    release();
    await Promise.resolve();
    await Promise.resolve();
    frame(132); // processed: the newest frame, not the stale 66/99
    stop();
    expect(seen).toEqual([33, 132]);
  });

  it('respects maxFps', () => {
    const { video, frame } = fakeVideo();
    let n = 0;
    const stop = startFramePump(video, () => {
      n++;
    }, { maxFps: 10 });
    for (let i = 0; i < 30; i++) frame(1 + i * (1000 / 30)); // one second of 30 fps camera
    stop();
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
  });

  it('stops delivering after stop()', () => {
    const { video, frame } = fakeVideo();
    let n = 0;
    const stop = startFramePump(video, () => {
      n++;
    });
    frame(33);
    stop();
    frame(66);
    expect(n).toBe(1);
  });
});
