import { describe, expect, it } from 'vitest';
import { videoSampleTimes } from '../src/ml/videoSequence';

describe('video extraction sample times', () => {
  it('keeps both endpoints without duplicate times for an exact 12.5 Hz interval', () => {
    const times = videoSampleTimes(2.6, 4.28);
    expect(times[0]).toBe(2.6);
    expect(times.at(-1)).toBe(4.28);
    expect(times).toHaveLength(22);
    expect(times.every((time, i) => i === 0 || time > times[i - 1])).toBe(true);
  });
  it('includes the endpoint for an interval between frame boundaries', () => {
    const times = videoSampleTimes(1, 1.37);
    expect(times.at(-1)).toBe(1.37);
    expect(times.every((time, i) => i === 0 || time > times[i - 1])).toBe(true);
  });
});
