import { describe, expect, it } from 'vitest';
import { DEMO_SIGN_LABELS, limitDemoSign } from '../src/recognition/demoVocabulary';

describe('limited sign demo', () => {
  it('keeps a supported result and removes out-of-scope alternatives', () => {
    const result = limitDemoSign({ label: 'hello', confidence: .8, distance: .1, reason: 'matched',
      alternatives: [{ label: 'goodbye', confidence: .7 }, { label: 'number_four', confidence: .6 }] }, DEMO_SIGN_LABELS);
    expect(result.label).toBe('hello');
    expect(result.alternatives.map(item => item.label)).toEqual(['goodbye']);
  });
  it('rejects an out-of-scope winning sign rather than relabeling it', () => {
    const result = limitDemoSign({ label: 'number_four', confidence: .9, distance: .08, reason: 'matched',
      alternatives: [{ label: 'hello', confidence: .7 }] }, DEMO_SIGN_LABELS);
    expect(result.label).toBe('none');
    expect(result.alternatives).toEqual([]);
  });
  it('preserves in-scope choices from an ambiguous result', () => {
    const result = limitDemoSign({ label: 'none', confidence: 0, distance: .1, reason: 'ambiguous',
      alternatives: [{ label: 'no', confidence: .8 }, { label: 'goodbye', confidence: .7 }] }, DEMO_SIGN_LABELS);
    expect(result.reason).toBe('ambiguous');
    expect(result.alternatives.map(item => item.label)).toEqual(['goodbye']);
  });
});
