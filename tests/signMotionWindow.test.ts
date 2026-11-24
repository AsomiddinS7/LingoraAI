import { describe, expect, it } from 'vitest';
import { trimRestingEdges, windowSuggestion } from '../src/ml/signMotionWindow';
import type { SequenceFrame, SequenceMatch } from '../src/ml/sequence';

const hand = (x: number) => Array.from({ length: 21 }, () => ({ x, y: .5, z: 0 }));
const result = (label: string, reason: SequenceMatch['reason'], confidence = .7): SequenceMatch =>
  ({ label, reason, confidence, distance: .1, alternatives: [] });

describe('movement window review', () => {
  it('trims edge pauses while preserving an internal tracking gap', () => {
    const frames: SequenceFrame[] = Array.from({ length: 31 }, (_, i) => ({
      t: i * 100, left: null, right: i === 15 ? null : hand(i < 10 ? .2 : i > 20 ? .4 : .2 + (i - 10) * .02),
    }));
    const cropped = trimRestingEdges(frames, 200);
    expect(cropped.length).toBeLessThan(frames.length);
    expect(cropped.some((frame) => frame.t === 1500 && frame.right === null)).toBe(true);
    expect(trimRestingEdges(frames.map((f) => ({ ...f, right: hand(.2) })), 200)).toHaveLength(frames.length);
  });
  it('offers an agreed sign for explicit review and never overrides an accepted or unsupported result', () => {
    const rejected = result('none', 'too_distant', 0), hello = result('hello', 'matched'), goodbye = result('goodbye', 'matched');
    expect(windowSuggestion(rejected, hello, hello)).toMatchObject({ label: 'none', reason: 'trimmed_suggestion', alternatives: [{ label: 'hello' }] });
    expect(windowSuggestion(rejected, hello, goodbye)).toEqual(rejected);
    expect(windowSuggestion(hello, goodbye, goodbye)).toEqual(hello);
    const missing = result('none', 'insufficient_tracking', 0);
    expect(windowSuggestion(missing, hello, hello)).toEqual(missing);
  });
});
