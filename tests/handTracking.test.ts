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
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0]), { status: 200 })));
  vi.stubGlobal('document', { baseURI: 'http://localhost:5173/', createElement: () => ({
    width: 300, height: 150, getContext: (type: string) => type === '2d' ? { drawImage() {} } : null,
  }) });
});
afterEach(() => vi.unstubAllGlobals());
const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

describe('continuous hand and pose tracking', () => {
  it('reassembles the hand model from parallel byte ranges', async () => {
    const total = 70_000;
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/);
      if (!range) throw new Error('Expected a byte range');
      const start = Number(range[1]); const end = Number(range[2]);
      const bytes = Uint8Array.from({ length: end - start + 1 }, (_, index) => (start + index) % 251);
      return new Response(bytes, { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${total}` } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const tracking = await import('../src/ml/handTracking');
    await tracking.loadHandOverlayLandmarker();
    const buffer = mocks.handCreate.mock.calls[0][1].baseOptions.modelAssetBuffer as Uint8Array;
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(buffer).toHaveLength(total);
    expect([buffer[0], buffer[65_535], buffer.at(-1)]).toEqual([0, 65_535 % 251, 69_999 % 251]);
  });

  it('recovers only a current observed crop and respects its retry budget', async () => {
    const tracking = await import('../src/ml/handTracking');
    tracking.setTrackingMode('recovery');
    const body = Array.from({length:33},()=>({x:.5,y:.4,z:0,visibility:1}));
    body[11].x=.3;body[12].x=.7;body[13].x=.25;body[14].x=.75;
    body[15]={x:.2,y:.5,z:0,visibility:1};body[16]={x:.8,y:.5,z:0,visibility:1};
    mocks.pose.mockImplementation(input=>({landmarks:input.width===32?[]:[body]}));
    mocks.image.mockReturnValue({landmarks:[Array.from({length:21},(_,i)=>({x:.5+i*.002,y:.471875-i*.006,z:0}))],handedness:[[{categoryName:'Left',score:.9}]]});
    await tracking.loadHandLandmarker();tracking.beginTrackingSequence();
    const first=tracking.trackVideoFrame(video,0);
    expect(first?.left).toHaveLength(21);expect(first?.right).toHaveLength(21);
    expect(tracking.trackingDiagnostics().recoveredHands).toBe(1);
    const second=tracking.trackVideoFrame(video,40);
    expect(mocks.image).toHaveBeenCalledTimes(1);
    expect(second?.left).toBeNull(); // no cached/fabricated observations between recovery frames
  });
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
  it('reports capture time for both observed and missing hands even when inference is slow', async () => {
    const tracking = await import('../src/ml/handTracking');
    await tracking.loadHandLandmarker();
    const release = tracking.handTracking.acquire(video);
    const times: number[] = [];
    const unsubscribe = tracking.handTracking.subscribe((_frame, at) => times.push(at));
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValue(1500);
    const process = mocks.pump.mock.calls[0][1];
    process(video, 0);
    expect(times).toEqual([1000]);
    expect(tracking.handTracking.latest()?.at).toBe(1000);
    now.mockReturnValueOnce(2000).mockReturnValue(2500);
    mocks.hand.mockReturnValueOnce({ landmarks: [], handedness: [] });
    process(video, 0);
    expect(times).toEqual([1000, 2000]);
    expect(tracking.handTracking.latest()).toBeNull();
    unsubscribe(); release(); now.mockRestore();
  });
});
