// Feature normalisation, k-NN classifier, evaluation and stability filter.
import { describe, expect, it } from 'vitest';
import { FEATURE_DIM, landmarksToFeatures, type Landmark } from '../src/ml/features';
import { buildModel, evaluate, predict, type Sample } from '../src/ml/knn';
import { createStabilityFilter } from '../src/ml/stability';

// Synthetic hand poses: 21 points on a "hand" whose finger curl is controlled by `curl`.
function hand(curl: number, opts: { dx?: number; dy?: number; scale?: number; jitter?: number; seed?: number } = {}): Landmark[] {
  const { dx = 0.5, dy = 0.6, scale = 0.2, jitter = 0, seed = 1 } = opts;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * jitter;
  const pts: Landmark[] = [{ x: 0, y: 0, z: 0 }];
  for (let f = 0; f < 5; f++) {
    const ang = -0.6 + f * 0.3;
    for (let j = 1; j <= 4; j++) {
      const r = j * (1 - curl * (j / 6));
      pts.push({ x: Math.sin(ang) * r * 0.5, y: -Math.cos(ang) * r * 0.5, z: curl * j * 0.05 });
    }
  }
  return pts.map((p) => ({ x: dx + p.x * scale + rnd(), y: dy + p.y * scale + rnd(), z: p.z * scale + rnd() }));
}

describe('features', () => {
  it('has 63 dimensions', () => {
    expect(landmarksToFeatures(hand(0), 'Right')).toHaveLength(FEATURE_DIM);
  });
  it('does not depend on hand position or distance from the camera', () => {
    const a = landmarksToFeatures(hand(0.5), 'Right');
    const b = landmarksToFeatures(hand(0.5, { dx: 0.2, dy: 0.3, scale: 0.35 }), 'Right');
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  });
  it('mirrors left hands', () => {
    const r = landmarksToFeatures(hand(0.3), 'Right');
    const l = landmarksToFeatures(hand(0.3), 'Left');
    expect(l[3]).toBeCloseTo(-r[3], 6);
    expect(l[4]).toBeCloseTo(r[4], 6);
  });
});

function takes(label: string, curl: number, nTakes: number, frames = 20, seed0 = 1): Sample[] {
  const out: Sample[] = [];
  for (let t = 0; t < nTakes; t++)
    for (let f = 0; f < frames; f++)
      out.push({
        label,
        take: `${label}-${t}`,
        vec: landmarksToFeatures(hand(curl, { jitter: 0.004, seed: seed0 + t * 100 + f, dx: 0.4 + t * 0.05, scale: 0.18 + t * 0.02 }), 'Right'),
      });
  return out;
}

describe('k-NN classifier', () => {
  const data = [...takes('hello', 0, 3), ...takes('no', 0.9, 3, 20, 7)];
  const model = buildModel(data);

  it('recognises recorded signs at new positions and sizes with high confidence', () => {
    const p1 = predict(model, landmarksToFeatures(hand(0, { dx: 0.3, scale: 0.3, jitter: 0.004, seed: 999 }), 'Right'));
    expect(p1.label).toBe('hello');
    expect(p1.confidence).toBeGreaterThan(0.8);
    const p2 = predict(model, landmarksToFeatures(hand(0.9, { dx: 0.7, scale: 0.15, jitter: 0.004, seed: 555 }), 'Right'));
    expect(p2.label).toBe('no');
  });

  it("says 'none' for a hand pose it was never trained on instead of guessing", () => {
    const p = predict(model, landmarksToFeatures(hand(0.45, { seed: 3 }), 'Right'));
    expect(p.label === 'none' || p.confidence < 0.8).toBe(true);
  });

  it('with no samples recognises nothing', () => {
    expect(predict(buildModel([]), new Array(FEATURE_DIM).fill(0)).label).toBe('none');
  });

  it('evaluation holds out whole recordings and reports per-sign recall', () => {
    const ev = evaluate(data, 0.8)!;
    expect(ev.takes).toBe(6);
    expect(ev.frames).toBe(120);
    expect(ev.accuracy).toBeGreaterThan(0.9);
    expect(Object.keys(ev.perLabelRecall).sort()).toEqual(['hello', 'no']);
    expect(ev.interval[0]).toBeLessThanOrEqual(ev.accuracy);
  });

  it('cannot evaluate with a single recording per sign', () => {
    expect(evaluate(takes('yes', 0.2, 1), 0.8)).toBeNull();
  });
});

describe('stability filter', () => {
  it('emits once when the sign is held for 150 ms at 30 fps (frame 6), with the hold start time', () => {
    const f = createStabilityFilter(3, 150);
    const out = [];
    for (let i = 0; i < 12; i++) out.push(f.feed('hello', 0.9, 100 + i * 33));
    const events = out.filter(Boolean);
    expect(events).toHaveLength(1);
    expect(out.findIndex(Boolean)).toBe(5); // 5 * 33 ms = 165 ms >= 150 ms
    expect(events[0]).toMatchObject({ label: 'hello', startedAt: 100 });
  });

  it('on a slow 10 fps device needs only 3 frames (200 ms), not 500 ms', () => {
    const f = createStabilityFilter(3, 150);
    const out = [];
    for (let i = 0; i < 6; i++) out.push(f.feed('yes', 0.9, i * 100));
    expect(out.findIndex(Boolean)).toBe(2);
  });

  it('never emits on fewer than 3 frames, however slow the device', () => {
    const f = createStabilityFilter(3, 150);
    expect(f.feed('yes', 0.9, 0)).toBeNull();
    expect(f.feed('yes', 0.9, 1000)).toBeNull();
    expect(f.feed('yes', 0.9, 2000)).not.toBeNull();
  });

  it('jitter between labels resets the count, so no event is emitted', () => {
    const f = createStabilityFilter(3, 0);
    const seq = ['a', 'a', 'b', 'a', 'a', 'b', 'a', 'a'];
    expect(seq.map((l) => f.feed(l, 0.9)).filter(Boolean)).toHaveLength(0);
  });

  it('after reset the same sign can be emitted again', () => {
    const f = createStabilityFilter(2, 0);
    f.feed('yes', 1);
    expect(f.feed('yes', 1)).not.toBeNull();
    f.reset();
    f.feed('yes', 1);
    expect(f.feed('yes', 1)).not.toBeNull();
  });
});
