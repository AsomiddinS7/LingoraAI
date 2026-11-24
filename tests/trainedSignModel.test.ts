import text from '../public/model/trained-sign-model.json?raw';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTrainedSignModel, createTrainedMatcher } from '../src/ml/trainedSignModel';
import { createSequenceStore } from '../src/ml/sequenceStore';
import { registerModelWords, glossFor, vocabLabels } from '../src/data';
import { composeLocally } from '../src/providers/localSentence';
import type { NormalizedSequence, SequenceFrame } from '../src/ml/sequence';

const model = parseTrainedSignModel(text);
// Invert body normalization for a packaging regression, not an accuracy claim.
function frames(input: NormalizedSequence): SequenceFrame[] {
  return input.vectors.map((v, i) => {
    const hand = (offset: number) => v[offset] ? Array.from({ length: 21 }, (_, j) => ({
      x: .5 + v[offset + 1 + j * 3] * .2, y: .3 + v[offset + 2 + j * 3] * .2, z: v[offset + 3 + j * 3] * .2,
    })) : null;
    return { t: i * input.durationMs / 31, left: hand(0), right: hand(64), aspect: 1,
      pose: [.5,.4,.6,.4,.6,.4,.6].map((x, j) => ({ x, y: j === 0 ? .1 : .3, z: 0 })) };
  });
}
afterEach(() => registerModelWords([]));
describe('published trained model integration', () => {
  it('loads all 40 words and preserves the trained decision when imported/exported', () => {
    const store = createSequenceStore();
    expect(store.importJson(text)).toBe(85);
    expect(Object.keys(store.counts())).toHaveLength(40);
    expect(store.isTrained()).toBe(true);
    const input = frames(model.gallery.templates[0].normalized);
    expect(store.match(input)).toEqual(createTrainedMatcher(model)(input));
    expect(store.match(input).label).toBe(model.gallery.templates[0].label);
    const restored = createSequenceStore(); restored.importJson(store.exportJson());
    expect(restored.match(input)).toEqual(store.match(input));
  });
  it('rejects empty camera frames and keeps the active model after invalid or cross-scope imports', () => {
    const store = createSequenceStore(); store.importJson(text);
    expect(store.match(Array.from({ length: 32 }, (_, i) => ({ t: i * 50, left: null, right: null }))).label).toBe('none');
    expect(() => store.importJson(text, ['speech_01'])).toThrow();
    expect(() => store.importJson('{"format":"wrong"}')).toThrow();
    expect(store.isTrained()).toBe(true); expect(store.all()).toHaveLength(85);
    store.replace([store.all()[0]]); expect(store.isTrained()).toBe(false);
    store.importJson(text); store.clear(); expect(store.isTrained()).toBe(false);
    expect(store.match([]).reason).toBe('no_templates');
  });
  it('rejects source metadata and mismatched learned/gallery vocabularies', () => {
    const raw = JSON.parse(text); raw.training = { source: 'private.mp4' };
    expect(() => parseTrainedSignModel(JSON.stringify(raw))).toThrow(); delete raw.training;
    raw.classifier.classes[0] = 'unreviewed';
    expect(() => parseTrainedSignModel(JSON.stringify(raw))).toThrow();
  });
  it('uses Uzbek words in confirmed text instead of internal dictionary IDs', () => {
    registerModelWords(model.vocabulary);
    const label = 'uzsl_1841_yordam_bermoq';
    expect(vocabLabels()).toContain(label); expect(glossFor(label, 'uz')).toBe('Yordam bermoq');
    const result = composeLocally({ session_id: 'test', context: 'general', face_hints: null,
      signs: [{ label, confidence: .9 }], language: 'uz' });
    expect(result.sentence).toBe('Yordam bermoq.');
  });
});
