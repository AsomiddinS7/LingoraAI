import { afterEach, expect, it, vi } from 'vitest';
import type { SequenceFrame } from '../src/ml/sequence';

const tracker = vi.hoisted(() => ({ listener: null as null | ((frame: unknown, at: number) => void) }));
vi.mock('../src/ml/handTracking', () => ({
  loadHandLandmarker: vi.fn(async () => {}),
  handTracking: {
    acquire: () => () => {},
    subscribe: (fn: (frame: unknown, at: number) => void) => { tracker.listener = fn; return () => { tracker.listener = null; }; },
  },
}));

import { MotionRecognizer } from '../src/recognition/motionRecognizer';
import { runtime } from '../src/runtime';

afterEach(() => { vi.useRealTimers(); tracker.listener = null; });

async function record(captureCountdown: boolean) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  runtime.setConfig({ signWindow: { ...runtime.get().config.signWindow, countdownMs: 1000 } });
  let captured: SequenceFrame[] = [];
  const store = { all: () => [{}], match: (frames: SequenceFrame[]) => {
    captured = frames;
    return { label: 'none', confidence: 0, distance: 1, alternatives: [], reason: 'test' };
  } };
  const recognizer = new MotionRecognizer({ store: store as never, captureCountdown });
  recognizer.attach({} as HTMLVideoElement);
  recognizer.startWindow();
  const frame = { left: [{ x: 0, y: 0, z: 0 }], right: null, pose: null, aspect: 1 };
  tracker.listener?.(frame, 100);
  await vi.advanceTimersByTimeAsync(1000);
  tracker.listener?.(frame, 1100);
  recognizer.finishWindow();
  await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0));
  recognizer.detach();
  return captured.map(f => f.t);
}

it('leaves countdown capture disabled by default', async () => {
  expect(await record(false)).toEqual([1100]);
});

it('the experimental option keeps observed countdown frames before the recording', async () => {
  expect(await record(true)).toEqual([100, 1100]);
});

it('discards countdown frames when a turn is cancelled', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  runtime.setConfig({ signWindow: { ...runtime.get().config.signWindow, countdownMs: 1000 } });
  let captured: SequenceFrame[] = [];
  const store = { all: () => [{}], match: (frames: SequenceFrame[]) => {
    captured = frames;
    return { label: 'none', confidence: 0, distance: 1, alternatives: [], reason: 'test' };
  } };
  const recognizer = new MotionRecognizer({ store: store as never, captureCountdown: true });
  recognizer.attach({} as HTMLVideoElement);
  const frame = { left: [{ x: 0, y: 0, z: 0 }], right: null, pose: null, aspect: 1 };
  recognizer.startWindow(); tracker.listener?.(frame, 100);
  recognizer.cancelWindow(); recognizer.startWindow();
  tracker.listener?.(frame, 200);
  await vi.advanceTimersByTimeAsync(1000);
  tracker.listener?.(frame, 1100); recognizer.finishWindow();
  await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0));
  expect(captured.map(f => f.t)).toEqual([200, 1100]);
  recognizer.detach();
});
