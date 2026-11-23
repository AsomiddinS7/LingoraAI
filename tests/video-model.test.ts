// Optional local evaluation: never invent a score when private held-out footage is absent.
import { describe, expect, it } from 'vitest';
import { matchSequence, parseTemplateDataset } from '../src/ml/sequence';

// Vite test-only import: nothing in the browser application imports these files.
const local = import.meta.glob('../private-video-work/templates-*.json', { eager: true, import: 'default' });
const trainData = local['../private-video-work/templates-train.json'];
const testData = local['../private-video-work/templates-heldout.json'];
const negativeData = local['../private-video-work/templates-negative.json'];
const available = Boolean(trainData && testData);

describe('same-signer, same-session held-out repetitions (private data)', () => {
  it.skipIf(!available)('reports disjoint entire repetitions; skipped when private train/holdout files are missing', () => {
    const train = parseTemplateDataset(JSON.stringify(trainData));
    const test = parseTemplateDataset(JSON.stringify(testData));
    if (negativeData) test.templates.push(...parseTemplateDataset(JSON.stringify(negativeData)).templates);
    expect(train.templates.length).toBeGreaterThan(0);
    expect(test.templates.length).toBeGreaterThan(0);
    for (const t of train.templates) expect(t.source?.name).toBeTruthy();
    const results = test.templates.map((t) => {
      expect(t.source?.name).toBeTruthy();
      expect(train.templates.some((other) => other.source?.name === t.source!.name
        && t.frames[0].t <= other.frames[other.frames.length - 1].t
        && t.frames[t.frames.length - 1].t >= other.frames[0].t)).toBe(false);
      const geometry = (frames: typeof t.frames) => JSON.stringify(frames.map(({ t: _time, ...landmarks }) => landmarks));
      expect(train.templates.some((other) => geometry(other.frames) === geometry(t.frames))).toBe(false);
      return { id: t.id, expected: t.label, ...matchSequence(t.frames, train.templates) };
    });
    // No invented quality threshold: publish observations for the pilot gate.
    console.info('Same-signer, same-session held-out repetition evaluation (not generalization):', JSON.stringify({
      clips: results.length,
      correct: results.filter((r) => r.label === r.expected).length,
      accepted: results.filter((r) => r.label !== 'none').length,
      results,
    }));
    expect(results.every((r) => Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1)).toBe(true);
  });
});
