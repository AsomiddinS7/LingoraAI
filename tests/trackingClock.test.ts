import { describe, expect, it } from 'vitest';
import { createTrackingClock } from '../src/ml/trackingClock';

describe('MediaPipe video clock', () => {
  it('preserves frame intervals and never goes backwards across camera restarts and imported clips', () => {
    const clock = createTrackingClock();
    expect(clock.next(500000)).toBe(0);
    expect(clock.next(500080)).toBe(80);
    clock.restart();
    expect(clock.next(0)).toBe(81);
    expect(clock.next(80)).toBe(161);
    expect(clock.next(80)).toBe(162);
    expect(clock.next(10)).toBe(163);
    clock.restart();
    expect(clock.next(510000)).toBe(164);
    expect(clock.next(510040)).toBe(204);
  });
  it('rejects invalid timestamps without poisoning subsequent tracking', () => {
    const clock = createTrackingClock();
    expect(() => clock.next(NaN)).toThrow();
    expect(clock.next(0)).toBe(0);
  });
});
