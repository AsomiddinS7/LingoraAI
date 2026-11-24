import { describe, expect, it } from 'vitest';
import { compileTemplateDataset, matchSequence, normalizeSequence, parseMotionModel, parseTemplateDataset, sequenceDistance, type MotionTemplate, type SequenceFrame } from '../src/ml/sequence';
import type { Landmark } from '../src/ml/features';
import { createSequenceStore, sequenceStore } from '../src/ml/sequenceStore';

function hand(x: number, y = 0.5, curl = 0): Landmark[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 4) * 0.015, y: y - Math.floor(i / 4) * 0.018 * (1 - curl), z: (i % 4) * curl * 0.01 }));
}
function clip(reverse = false, opts: { offset?: number; scale?: number; curl?: number; separation?: number; body?: boolean } = {}): SequenceFrame[] {
  const { offset = 0, scale = 1, curl = 0, separation = 0.3, body = false } = opts;
  const transform = (p: Landmark) => ({ x: p.x * scale + offset, y: p.y * scale + offset, z: p.z * scale });
  return Array.from({ length: 16 }, (_, i) => {
    const progress = (reverse ? 15 - i : i) / 15;
    return { t: i * 80, left: hand(0.2, 0.5, curl).map(transform), right: hand(0.2 + separation + progress * 0.25, 0.5, curl).map(transform),
      ...(body ? { pose: [
        { x: 0.5, y: 0.1, z: 0 }, { x: 0.25, y: 0.3, z: 0 }, { x: 0.75, y: 0.3, z: 0 },
        { x: 0.2, y: 0.5, z: 0 }, { x: 0.8, y: 0.5, z: 0 }, { x: 0.2, y: 0.7, z: 0 }, { x: 0.8, y: 0.7, z: 0 },
      ].map(transform) } : {}) };
  });
}
function template(label: string, frames: SequenceFrame[]): MotionTemplate { return { id: label, label, frames }; }
function dataset(templates: MotionTemplate[]) { return JSON.stringify({ format: 'lingora-motion-templates', version: 1, templates }); }

describe('two-hand sequence matching', () => {
  it('rejects resting hands using only the loaded reference movement, and clears that floor on reset',()=>{
    const store=createSequenceStore(),frames=clip(false,{body:true});
    store.importJson(dataset([template('hello',frames)]));
    const idle=frames.map(f=>({...f,left:frames[0].left,right:frames[0].right}));
    expect(store.match(frames).label).toBe('hello');
    expect(store.match(idle).reason).toBe('insufficient_motion');
    store.clear();expect(store.match(idle).reason).toBe('no_templates');
    store.importJson(dataset([template('held_shape',idle)]));
    expect(store.match(idle).label).toBe('held_shape');
  });
  it('keeps conversation and signed-speech references isolated and rejects cross-scope labels atomically', () => {
    const conversation = createSequenceStore(), speech = createSequenceStore();
    conversation.importJson(dataset([template('hello', clip())]), ['hello']);
    expect(speech.all()).toHaveLength(0);
    expect(speech.match(clip()).label).toBe('none');
    expect(() => speech.importJson(conversation.exportJson(), ['speech_01'])).toThrow();
    expect(speech.all()).toHaveLength(0);
    speech.importJson(dataset([template('speech_01', clip(true))]), ['speech_01']);
    speech.clear();
    expect(conversation.match(clip()).label).toBe('hello');
  });
  it('distinguishes the same hand shapes moving in opposite temporal directions', () => {
    const templates = [template('outward', clip()), template('inward', clip(true))];
    expect(matchSequence(clip(), templates).label).toBe('outward');
    expect(matchSequence(clip(true), templates).label).toBe('inward');
  });

  it('shares translation and scale normalization across both hands', () => {
    const a = normalizeSequence(clip())!, b = normalizeSequence(clip(false, { offset: 0.1, scale: 0.7 }))!;
    expect(sequenceDistance(a, b)).toBeLessThan(1e-8);
    expect(a.vectors[0]).toHaveLength(128);
    const different = normalizeSequence(clip(false, { separation: 0.08 }))!;
    expect(sequenceDistance(a, different)).toBeGreaterThan(0.03);
  });

  it('keeps the same physical hand depth comparable across landscape and portrait aspect ratios', () => {
    const landscapeAspect = 16 / 9, portraitAspect = 3 / 4;
    const landscape = clip(false, { body: true, curl: 0.6 }).map((f) => ({ ...f, aspect: landscapeAspect }));
    const ratio = landscapeAspect / portraitAspect;
    // Hold physical positions relative to image height constant while width changes.
    // Hand z is width-normalized, so it changes by the same factor as x.
    const reframe = (p: Landmark) => ({ x: 0.5 + (p.x - 0.5) * ratio, y: p.y, z: p.z * ratio });
    const portrait = landscape.map((f) => ({ ...f, aspect: portraitAspect,
      left: f.left?.map(reframe) ?? null, right: f.right?.map(reframe) ?? null, pose: f.pose?.map(reframe) }));
    expect(sequenceDistance(normalizeSequence(landscape)!, normalizeSequence(portrait)!)).toBeLessThan(1e-8);
  });

  it('preserves hand location relative to shoulders and accepts compact/full pose layouts', () => {
    const a = normalizeSequence(clip(false, { body: true }))!;
    const b = normalizeSequence(clip(false, { body: true, offset: 0.1, scale: 0.8 }))!;
    expect(a.reference).toBe('body');
    expect(sequenceDistance(a, b)).toBeLessThan(1e-8);
    const raised = clip(false, { body: true }).map((f) => ({ ...f, right: f.right!.map((p) => ({ ...p, y: p.y - 0.25 })) }));
    expect(sequenceDistance(a, normalizeSequence(raised)!)).toBeGreaterThan(0.1);
    const full = clip(false, { body: true }).map((f) => {
      const pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
      pose[11] = f.pose![1]; pose[12] = f.pose![2];
      return { ...f, pose };
    });
    expect(sequenceDistance(a, normalizeSequence(full)!)).toBeLessThan(1e-8);
  });

  it('rejects absent tracking, unknown motion, and coordinate systems that cannot be compared', () => {
    const t = [template('outward', clip())];
    expect(matchSequence([], t).reason).toBe('insufficient_tracking');
    expect(matchSequence(clip().map((f) => ({ ...f, left: null, right: null })), t).label).toBe('none');
    expect(matchSequence(clip(false, { curl: 0.95 }), t, { maxDistance: 0.03 }).reason).toBe('too_distant');
    expect(matchSequence(clip(false, { body: true }), t).reason).toBe('no_compatible_templates');
    expect(matchSequence(clip(), []).reason).toBe('no_templates');
  });

  it('rejects ambiguous labels instead of selecting the first exact template', () => {
    const result = matchSequence(clip(), [template('a', clip()), template('b', clip())]);
    expect(result.label).toBe('none');
    expect(result.reason).toBe('ambiguous');
    expect(result.confidence).toBe(0);
  });

  it('does not treat a missing hand as a hand at the coordinate origin', () => {
    const a = normalizeSequence(clip())!;
    const missing = normalizeSequence(clip().map((f) => ({ ...f, left: null })))!;
    expect(missing.vectors.every((v) => v[0] === 0)).toBe(true);
    expect(sequenceDistance(a, missing)).toBeGreaterThan(0.4);
  });

  it('is robust to variable frame rate and retains the original duration', () => {
    const original = clip();
    const sparse = original.filter((_, i) => i % 3 === 0);
    const a = normalizeSequence(original)!, b = normalizeSequence(sparse)!;
    expect(sequenceDistance(a, b)).toBeLessThan(1e-8);
    expect(b.durationMs).toBe(1200);
  });
});

describe('bounded template imports', () => {
  it('keeps explicit provenance and strips unknown properties', () => {
    const item = { ...template('outward', clip()), source: { kind: 'recording', name: 'local-clip', permission: 'User-provided recording' }, executable: 'ignored' };
    const result = parseTemplateDataset(dataset([item as MotionTemplate]));
    expect(result.templates[0].source?.name).toBe('local-clip');
    expect(result.templates[0]).not.toHaveProperty('executable');
  });

  it('rejects malformed arrays, non-finite coordinates, duplicate ids and non-monotonic time', () => {
    expect(() => parseTemplateDataset(dataset([template('x', clip().map((f) => ({ ...f, t: 0 })))]))).toThrow();
    expect(() => parseTemplateDataset(dataset([template('x', clip().map((f) => ({ ...f, left: f.left!.slice(0, 20) })))]))).toThrow();
    expect(() => parseTemplateDataset(dataset([template('x', clip().map((f) => ({ ...f, left: f.left!.map((p) => ({ ...p, x: Infinity })) })))]))).toThrow();
    expect(() => parseTemplateDataset(dataset([template('x', clip()), template('x', clip())]))).toThrow();
    expect(() => parseTemplateDataset(JSON.stringify({ format: 'other', version: 1, templates: [] }))).toThrow();
  });

  it('imports atomically, enforces vocabulary when provided, and replaces duplicates', () => {
    sequenceStore.clear();
    const text = dataset([template('outward', clip())]);
    expect(sequenceStore.importJson(text, ['outward'])).toBe(1);
    expect(sequenceStore.importJson(text)).toBe(1);
    expect(sequenceStore.all()).toHaveLength(1);
    expect(() => sequenceStore.importJson(text, ['inward'])).toThrow();
    expect(sequenceStore.counts()).toEqual({ outward: 1 });
    expect(sequenceStore.match(clip()).label).toBe('outward');
    sequenceStore.clear();
  });
});

describe('derived deployment models', () => {
  it('preserves raw-template predictions exactly without source landmarks or provenance', () => {
    const raw = [
      { ...template('outward', clip()), source: { kind: 'recording' as const, name: 'private-source.mp4', permission: 'private' } },
      template('inward', clip(true)),
    ];
    const model = compileTemplateDataset(raw);
    const text = JSON.stringify(model);
    expect(text).not.toContain('private-source');
    expect(model.templates[0]).not.toHaveProperty('frames');
    expect(model.templates[0]).not.toHaveProperty('source');
    const parsed = parseMotionModel(text);
    for (const frames of [clip(), clip(true), clip(false, { curl: 0.95 })])
      expect(matchSequence(frames, parsed.templates)).toEqual(matchSequence(frames, raw));
  });

  it('rejects malformed feature dimensions, flags, non-finite numbers and model versions', () => {
    const valid = () => compileTemplateDataset([template('outward', clip())]);
    const badDimension = valid(); badDimension.templates[0].normalized.vectors[0].pop();
    expect(() => parseMotionModel(JSON.stringify(badDimension))).toThrow();
    const badMask = valid(); badMask.templates[0].normalized.vectors[0][0] = 0.5;
    expect(() => parseMotionModel(JSON.stringify(badMask))).toThrow();
    const absentWithValues = valid(); absentWithValues.templates[0].normalized.vectors[0][0] = 0;
    expect(() => parseMotionModel(JSON.stringify(absentWithValues))).toThrow();
    const infinite = valid(); infinite.templates[0].normalized.vectors[0][1] = Infinity;
    expect(() => parseMotionModel(JSON.stringify(infinite))).toThrow();
    expect(() => parseMotionModel(JSON.stringify({ ...valid(), feature_version: 'other' }))).toThrow();
    expect(() => parseMotionModel(JSON.stringify({ ...valid(), feature_version: 'two-hand-body-v1' }))).toThrow();
    const duplicate = valid(); duplicate.templates.push(duplicate.templates[0]);
    expect(() => parseMotionModel(JSON.stringify(duplicate))).toThrow();
  });

  it('loads compiled models atomically and roundtrips mixed imported and newly extracted examples', () => {
    sequenceStore.clear();
    const model = compileTemplateDataset([template('outward', clip())]);
    sequenceStore.importJson(JSON.stringify(model), ['outward']);
    expect(sequenceStore.counts()).toEqual({ outward: 1 });
    expect(() => sequenceStore.importJson(JSON.stringify(model), ['inward'])).toThrow();
    expect(sequenceStore.match(clip()).label).toBe('outward');
    sequenceStore.replace([...sequenceStore.all(), template('inward', clip(true))]);
    const roundtrip = sequenceStore.exportJson();
    expect(parseMotionModel(roundtrip).templates).toHaveLength(2);
    sequenceStore.importJson(roundtrip);
    expect(sequenceStore.match(clip(true)).label).toBe('inward');
    expect(sequenceStore.counts()).toEqual({ outward: 1, inward: 1 });
    sequenceStore.clear();
  });
});
