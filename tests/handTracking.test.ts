import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ hand: vi.fn(), pose: vi.fn(), image: vi.fn(), handCreate: vi.fn(), poseCreate: vi.fn(), pump: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  HandLandmarker: { createFromOptions: mocks.handCreate },
  PoseLandmarker: { createFromOptions: mocks.poseCreate },
}));
vi.mock('../src/pipeline/framePump', () => ({ startFramePump: mocks.pump }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const points = Array.from({ length: 21 }, () => ({ x: .8, y: .5, z: 0 }));
  const body = Array.from({ length: 33 }, () => ({ x: .5, y: .4, z: 0, visibility: 1 }));
  body[15].x = .2; body[16].x = .8;
  mocks.hand.mockImplementation((input) => input.width === 32 ? { landmarks: [], handedness: [] }
    : { landmarks: [points], handedness: [[{ categoryName: 'Right' }]] });
  mocks.pose.mockImplementation((input) => ({ landmarks: input.width === 32 ? [] : [body] }));
  mocks.handCreate.mockResolvedValue({ detectForVideo: mocks.hand, detect: mocks.image, close() {} });
  mocks.poseCreate.mockResolvedValue({ detectForVideo: mocks.pose, detect: mocks.image, close() {} });
  mocks.pump.mockReturnValue(() => {});
  vi.stubGlobal('document', { baseURI: 'http://localhost:5173/', createElement: () => ({
    width: 300, height: 150, getContext: (type: string) => type === '2d' ? { drawImage() {} } : null,
  }) });
});
afterEach(() => vi.unstubAllGlobals());
const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

describe('continuous hand and pose tracking', () => {
  it('uses video tracking and the same captured frame/timestamp for hands and body', async () => {
    const tracking = await import('../src/ml/handTracking');
    await tracking.loadHandLandmarker();
    tracking.beginTrackingSequence();
    const frame = tracking.trackVideoFrame(video, 5000);
    expect(mocks.handCreate.mock.calls[0][1]).toMatchObject({ runningMode: 'VIDEO', numHands: 2 });
    expect(mocks.poseCreate.mock.calls[0][1]).toMatchObject({ runningMode: 'VIDEO', numPoses: 1 });
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.hand.mock.calls.at(-1)![0]).toBe(mocks.pose.mock.calls.at(-1)![0]);
    expect(mocks.hand.mock.calls.at(-1)![1]).toBe(mocks.pose.mock.calls.at(-1)![1]);
    expect(frame?.right).toHaveLength(21);
  });
  it('supports repeated imports and camera restarts without invalid VIDEO timestamps', async () => {
    const tracking = await import('../src/ml/handTracking');
    await tracking.loadHandLandmarker();
    tracking.beginTrackingSequence();
    tracking.trackVideoFrame(video, 5000);
    tracking.trackVideoFrame(video, 5080);
    tracking.beginTrackingSequence();
    tracking.trackVideoFrame(video, -500);
    tracking.trackVideoFrame(video, 0);
    const times = mocks.hand.mock.calls.map(call => call[1] as number);
    expect(times.every((time, index) => index === 0 || time > times[index - 1])).toBe(true);
    expect(times.at(-1)! - times.at(-2)!).toBe(500);
  });
  it('clears lost or failed detections instead of keeping stale hand dots', async () => {
    const { handTracking, loadHandLandmarker } = await import('../src/ml/handTracking');
    await loadHandLandmarker();
    const release = handTracking.acquire(video);
    const process = mocks.pump.mock.calls[0][1];
    process(video, 10);
    expect(handTracking.latest()).not.toBeNull();
    mocks.hand.mockReturnValueOnce({ landmarks: [], handedness: [] });
    process(video, 90);
    expect(handTracking.latest()).toBeNull();
    process(video, 170);
    expect(handTracking.latest()).not.toBeNull();
    mocks.hand.mockImplementationOnce(() => { throw new Error('Inference failed'); });
    expect(() => process(video, 250)).toThrow();
    expect(handTracking.latest()).toBeNull();
    release();
  });
});
