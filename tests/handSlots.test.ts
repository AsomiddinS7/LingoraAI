import { describe, expect, it } from 'vitest';
import { assignHands } from '../src/ml/handTracking';
import type { Landmark } from '../src/ml/features';

const hand = (x: number, y = 0.5): Landmark[] => Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.001, y, z: 0 }));
const pose = (leftX = 0.2, rightX = 0.8): Landmark[] => [
  { x: 0.5, y: 0.1, z: 0 }, { x: 0.3, y: 0.3, z: 0 }, { x: 0.7, y: 0.3, z: 0 },
  { x: 0.25, y: 0.4, z: 0 }, { x: 0.75, y: 0.4, z: 0 },
  { x: leftX, y: 0.5, z: 0 }, { x: rightX, y: 0.5, z: 0 },
];

describe('anatomical hand slots', () => {
  it('stays stable when the detector reverses its hand-list order', () => {
    const left = hand(0.2), right = hand(0.8);
    expect(assignHands([left, right], ['Left', 'Right'], pose())).toEqual({ left, right });
    expect(assignHands([right, left], ['Right', 'Left'], pose())).toEqual({ left, right });
  });

  it('uses pose wrists when detector handedness is wrong or duplicated', () => {
    const left = hand(0.2), right = hand(0.8);
    expect(assignHands([right, left], ['Left', 'Right'], pose())).toEqual({ left, right });
    expect(assignHands([right, left], ['Left', 'Left'], pose())).toEqual({ left, right });
  });

  it('follows anatomical wrists across crossed hands instead of using screen side', () => {
    const anatomicalLeft = hand(0.8), anatomicalRight = hand(0.2);
    expect(assignHands([anatomicalRight, anatomicalLeft], ['Left', 'Right'], pose(0.8, 0.2)))
      .toEqual({ left: anatomicalLeft, right: anatomicalRight });
  });

  it('keeps a single visible hand in its anatomical slot', () => {
    const left = hand(0.21), right = hand(0.79);
    expect(assignHands([left], ['Right'], pose())).toEqual({ left, right: null });
    expect(assignHands([right], ['Left'], pose())).toEqual({ left: null, right });
  });

  it('falls back to detector labels when no usable pose is available', () => {
    const left = hand(0.8), right = hand(0.2);
    expect(assignHands([right, left], ['Right', 'Left'], null)).toEqual({ left, right });
    expect(assignHands([left], ['Left'], null)).toEqual({ left, right: null });
    expect(assignHands([right], ['Right'], null)).toEqual({ left: null, right });
  });

  it('does not duplicate a single detection into both slots', () => {
    expect(assignHands([], [], null)).toEqual({ left: null, right: null });
    expect(assignHands([], [], pose())).toEqual({ left: null, right: null });
    const only = hand(0.5);
    const assigned = assignHands([only], [], null);
    expect([assigned.left, assigned.right].filter(Boolean)).toHaveLength(1);
  });
});
