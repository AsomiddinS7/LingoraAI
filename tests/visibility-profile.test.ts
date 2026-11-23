import { describe, expect, it } from 'vitest';
import { compileTemplateDataset, matchSequence, normalizeSequence, parseMotionModel, parseTemplateDataset, sequenceDistance,
  visibilityAwareSequenceDistance, type MatchingManifest, type MotionTemplate, type SequenceFrame } from '../src/ml/sequence';
import { createSequenceStore } from '../src/ml/sequenceStore';

function hand(x: number, y: number) {
  return Array.from({ length: 21 }, (_, i) => ({ x: x + i % 4 * .008, y: y + Math.floor(i / 4) * .01, z: -.001 * i }));
}
function clip(raised = false): SequenceFrame[] {
  return Array.from({ length: 16 }, (_, i) => ({ t: i * 80, left: hand(.2, .7), right: hand(.6 + i * .01, raised ? .05 : .5),
    pose: [{ x: .5, y: .1, z: 0 }, { x: .3, y: .3, z: 0 }, { x: .7, y: .3, z: 0 },
      { x: .25, y: .5, z: 0 }, { x: .75, y: .5, z: 0 }, { x: .2, y: .7, z: 0 }, { x: .6, y: .5, z: 0 }] }));
}
const templates: MotionTemplate[] = [{ id: 'a-reference', label: 'a', frames: clip() }, { id: 'b-reference', label: 'b', frames: clip(true) }];
const manifest: MatchingManifest = { profile: 'visibility-aware-dtw-v1', labels: ['a', 'b'], templateIds: ['a-reference', 'b-reference'] };
const dropped = () => clip().map((f, i) => ({ ...f, right: i >= 5 && i < 8 ? null : f.right }));
const rawJson = () => JSON.stringify({ format: 'lingora-motion-templates', version: 1, templates });

describe('reviewed complete-gallery matching profile', () => {
  it('uses v2 for explicit matching policies and preserves strict legacy v1 models', () => {
    expect(compileTemplateDataset(templates).version).toBe(1);
    const declared = compileTemplateDataset(templates, manifest);
    expect(declared.version).toBe(2);
    expect(parseMotionModel(JSON.stringify(declared)).version).toBe(2);
    expect(() => parseMotionModel(JSON.stringify({ ...declared, version: 1 }))).toThrow('version 2');
    expect(() => parseMotionModel(JSON.stringify({ ...compileTemplateDataset(templates), version: 2 }))).toThrow('matching policy');
    expect(parseMotionModel(JSON.stringify(compileTemplateDataset(templates))).version).toBe(1);
  });
  it('keeps legacy matching strict by default and only changes explicit complete dictionaries', () => {
    const strict = matchSequence(dropped(), templates);
    const aware = matchSequence(dropped(), templates, { matching: manifest });
    expect(aware.label).toBe('a');
    expect(aware.distance).toBeLessThan(strict.distance);
    expect(matchSequence(dropped(), templates)).toEqual(strict);
  });

  it('falls back to strict distance for missing or unexpected declared labels', () => {
    const missing = templates.slice(0, 1);
    const unexpected = [...templates, { ...templates[1], id: 'c-reference', label: 'c' }];
    for (const gallery of [missing, unexpected]) {
      expect(matchSequence(dropped(), gallery, { matching: manifest })).toEqual(matchSequence(dropped(), gallery));
    }
  });

  it('falls back when one demonstrated variant is removed even if every label remains', () => {
    const gallery = [...templates, { ...templates[0], id: 'a-second-variant' }];
    const matching: MatchingManifest = { ...manifest, templateIds: [...manifest.templateIds, 'a-second-variant'] };
    expect(matchSequence(dropped(), templates, { matching })).toEqual(matchSequence(dropped(), templates));
    expect(matchSequence(dropped(), gallery, { matching }).distance).toBeLessThan(matchSequence(dropped(), gallery).distance);
  });

  it('falls back before filtering a declared template with an incompatible coordinate reference', () => {
    const model = compileTemplateDataset(templates, manifest);
    model.templates[1].normalized.reference = 'hands';
    expect(matchSequence(dropped(), model.templates, { matching: manifest })).toEqual(matchSequence(dropped(), model.templates));
  });

  it('preserves matching metadata through strict model parsing, recompilation and store export', () => {
    const model = compileTemplateDataset(templates, manifest);
    expect(parseMotionModel(JSON.stringify(model)).matching).toEqual(manifest);
    expect(compileTemplateDataset(model).matching).toEqual(manifest);
    const store = createSequenceStore(); store.importJson(JSON.stringify(model));
    expect(JSON.parse(store.exportJson()).matching).toEqual(manifest);
    expect(store.match(dropped())).toEqual(matchSequence(dropped(), model.templates, { matching: manifest }));
  });

  it('keeps custom/raw imports strict, including forged raw metadata or caller options', () => {
    const store = createSequenceStore();
    store.importJson(JSON.stringify({ ...JSON.parse(rawJson()), matching: manifest }));
    expect(parseTemplateDataset(rawJson())).not.toHaveProperty('matching');
    expect(store.match(dropped(), { matching: manifest })).toEqual(matchSequence(dropped(), templates));
    store.importJson(JSON.stringify(compileTemplateDataset(templates)));
    expect(store.match(dropped())).toEqual(matchSequence(dropped(), templates));
    expect(JSON.parse(store.exportJson())).not.toHaveProperty('matching');
  });

  it('resets the declared profile when references are edited or cleared', () => {
    const store = createSequenceStore(), model = compileTemplateDataset(templates, manifest);
    store.importJson(JSON.stringify(model)); store.replace(model.templates);
    expect(JSON.parse(store.exportJson())).not.toHaveProperty('matching');
    expect(store.match(dropped())).toEqual(matchSequence(dropped(), templates));
    store.importJson(JSON.stringify(model)); store.clear(); store.importJson(rawJson());
    expect(JSON.parse(store.exportJson())).not.toHaveProperty('matching');
  });

  it('retains declarations but safely disables them if a compiled gallery is partial', () => {
    const partial = compileTemplateDataset(templates.slice(0, 1), manifest);
    const store = createSequenceStore(); store.importJson(JSON.stringify(partial));
    expect(JSON.parse(store.exportJson()).matching).toEqual(manifest);
    expect(store.match(dropped())).toEqual(matchSequence(dropped(), partial.templates));
  });

  it('rejects malformed manifests atomically and strips unrelated profile fields', () => {
    const model = compileTemplateDataset(templates, manifest), store = createSequenceStore();
    store.importJson(JSON.stringify(model)); const previous = store.exportJson();
    for (const matching of [{ ...manifest, profile: 'unknown' }, { ...manifest, labels: [] },
      { ...manifest, labels: ['a', 'a'] }, { ...manifest, labels: ['none'] }, { ...manifest, labels: [42] },
      { ...manifest, templateIds: [] }, { ...manifest, templateIds: ['a-reference', 'a-reference'] },
      { ...manifest, templateIds: [42] }]) {
      expect(() => store.importJson(JSON.stringify({ ...model, matching }))).toThrow();
      expect(store.exportJson()).toBe(previous);
    }
    expect(parseMotionModel(JSON.stringify({ ...model, matching: { ...manifest, executable: 'discard' } })).matching).toEqual(manifest);
  });

  it('has exact raw/compiled matching parity when both explicitly use the same profile', () => {
    const compiled = compileTemplateDataset(templates, manifest);
    expect(matchSequence(dropped(), compiled.templates, { matching: compiled.matching })).toEqual(matchSequence(dropped(), templates, { matching: manifest }));
  });

  it('retains geometry/direction and rejects absent or disjoint observations', () => {
    const original = normalizeSequence(clip())!, reverse = { ...original, vectors: [...original.vectors].reverse() };
    expect(visibilityAwareSequenceDistance(original, original)).toBe(sequenceDistance(original, original));
    expect(visibilityAwareSequenceDistance(original, reverse)).toBeGreaterThan(0);
    const left = { ...original, vectors: original.vectors.map((v) => [...v.slice(0, 64), ...Array<number>(64).fill(0)]) };
    const right = { ...original, vectors: original.vectors.map((v) => [...Array<number>(64).fill(0), ...v.slice(64)]) };
    expect(visibilityAwareSequenceDistance(left, right)).toBe(Infinity);
    const empty = { ...original, vectors: original.vectors.map(() => Array<number>(128).fill(0)) };
    expect(visibilityAwareSequenceDistance(empty, empty)).toBe(Infinity);
  });
});

describe('explicit background rejection references', () => {
  const backgroundFrames = () => clip().map((frame) => ({ ...frame,
    right: frame.right!.map((point) => ({ ...point, y: point.y + .5 })) }));
  const gallery = () => [...templates, { id: 'background-reference', label: 'background', frames: backgroundFrames() }];
  const policy: MatchingManifest = { profile: 'visibility-aware-dtw-v1', labels: ['a', 'b', 'background'],
    templateIds: ['a-reference', 'b-reference', 'background-reference'], rejectionLabels: ['background'] };

  it('rejects a v1 background policy rather than letting older clients turn it into a word', () => {
    const model = compileTemplateDataset(gallery(), policy);
    expect(model.version).toBe(2);
    expect(() => parseMotionModel(JSON.stringify({ ...model, version: 1 }))).toThrow('version 2');
    const strictBackground = compileTemplateDataset(gallery(), { ...policy, profile: 'strict-dtw-v1' });
    expect(strictBackground.version).toBe(2);
  });

  it('rejects the best background instead of translating it and hides it from public counts', () => {
    const store = createSequenceStore(), model = compileTemplateDataset(gallery(), policy);
    store.importJson(JSON.stringify(model));
    expect(store.all()).toHaveLength(3);
    expect(store.counts()).toEqual({ a: 1, b: 1 });
    const result = store.match(backgroundFrames());
    expect(result.label).toBe('none'); expect(result.confidence).toBe(0);
    expect(result.reason).toBe('background_reference');
    expect(result.alternatives.some((item) => item.label === 'background')).toBe(false);
  });

  it('permits explicit non-translatable references outside the allowed positive vocabulary, never unmarked raw words', () => {
    const store = createSequenceStore(), model = compileTemplateDataset(gallery(), policy);
    expect(store.importJson(JSON.stringify(model), ['a', 'b'])).toBe(3);
    expect(store.counts()).toEqual({ a: 1, b: 1 });
    expect(() => store.importJson(JSON.stringify({ format: 'lingora-motion-templates', version: 1, templates: gallery() }), ['a', 'b'])).toThrow();
    expect(store.match(backgroundFrames()).label).toBe('none');
  });

  it('keeps background competition in ambiguity checks while hiding alternatives', () => {
    const references = [...templates, { id: 'background-reference', label: 'background', frames: clip() }];
    const result = matchSequence(clip(), references, { matching: policy });
    expect(result.label).toBe('none'); expect(result.reason).toBe('ambiguous');
    expect(result.alternatives.some((item) => item.label === 'background')).toBe(false);
  });

  it('retains rejection semantics when a partial gallery falls back to strict distance', () => {
    const references = gallery().filter((item) => item.label !== 'b');
    const result = matchSequence(backgroundFrames(), references, { matching: policy });
    expect(result.label).toBe('none'); expect(result.reason).toBe('background_reference');
    expect(matchSequence(backgroundFrames(), references).label).toBe('background');
    expect(result.alternatives.some((item) => item.label === 'background')).toBe(false);
  });

  it('resets edited dictionaries to strict while preserving their explicit negative policy, even with unchanged IDs', () => {
    const store = createSequenceStore(), model = compileTemplateDataset(gallery(), policy);
    store.importJson(JSON.stringify(model));
    const edited = structuredClone(model.templates);
    edited[2].normalized.vectors[0][2] += .001;
    store.replace(edited);
    const exported = parseMotionModel(store.exportJson());
    expect(exported.matching).toEqual({ ...policy, profile: 'strict-dtw-v1' });
    expect(store.match(dropped())).toEqual(matchSequence(dropped(), edited, { matching: exported.matching }));
    expect(store.match(backgroundFrames()).label).toBe('none');
    expect(store.counts()).not.toHaveProperty('background');
    expect(compileTemplateDataset(exported).matching).toEqual(exported.matching);
  });

  it('preserves the background policy through raw edits and an empty dictionary without silently enabling it later', () => {
    const store = createSequenceStore(); store.importJson(JSON.stringify(compileTemplateDataset(gallery(), policy)));
    store.replace(gallery());
    expect(JSON.parse(store.exportJson()).matching.profile).toBe('strict-dtw-v1');
    expect(store.match(backgroundFrames()).label).toBe('none');
    store.replace([]);
    expect(JSON.parse(store.exportJson()).matching.rejectionLabels).toEqual(['background']);
    store.replace(gallery());
    expect(store.match(backgroundFrames()).label).toBe('none');
    store.clear(); store.importJson(rawJson());
    expect(JSON.parse(store.exportJson())).not.toHaveProperty('matching');
  });

  it('rejects malformed or undeclared background labels atomically', () => {
    const store = createSequenceStore(), model = compileTemplateDataset(gallery(), policy);
    store.importJson(JSON.stringify(model)); const previous = store.exportJson();
    for (const rejectionLabels of [['outside'], ['background', 'background'], ['none'], [42], 'background']) {
      expect(() => store.importJson(JSON.stringify({ ...model, matching: { ...policy, rejectionLabels } }))).toThrow();
      expect(store.exportJson()).toBe(previous);
    }
  });

  it('keeps background policies in exact raw/compiled parity and metadata round trips', () => {
    const model = compileTemplateDataset(gallery(), policy);
    expect(compileTemplateDataset(model).matching).toEqual(policy);
    expect(matchSequence(backgroundFrames(), model.templates, { matching: model.matching }))
      .toEqual(matchSequence(backgroundFrames(), gallery(), { matching: policy }));
  });
});
