// The production app uses the same decision rule as the camera replay evaluation.
import * as matcher from './sequence';
import { parseSkeletalCandidate, inferSkeletalCandidate, type SkeletalModel } from '../../scripts/skeletal-inference.mjs';
import { createHybridClassifier } from '../../scripts/hybrid-sign-inference.mjs';
import { createStaticNumberSuggestion } from './staticNumberSuggestion';
import { trimRestingEdges, windowSuggestion } from './signMotionWindow';

export interface TrainedSignModel {
  format: 'lingora-trained-sign-bundle-v1'; version: 1;
  feature_version: 'two-hand-body-v2'; tracking_profile: 'hands-pose-recovery-video-v2';
  gallery: matcher.MotionModel; classifier: SkeletalModel;
  vocabulary: { label: string; textUz: string }[];
  number_extension?: { templates: matcher.CompiledTemplate[]; classifier: SkeletalModel };
}

/** Closely ranked wave greetings need an explicit choice before being used. */
export function guardConfusableGreeting(result: matcher.SequenceMatch): matcher.SequenceMatch {
  const other = result.label === 'hello' ? 'goodbye' : result.label === 'goodbye' ? 'hello' : null;
  const rival = other && result.alternatives.find(candidate => candidate.label === other);
  if (!rival || result.confidence - rival.confidence > 0.15) return result;
  return { label: 'none', confidence: 0, distance: result.distance, reason: 'ambiguous',
    alternatives: [{ label: result.label, confidence: result.confidence }, ...result.alternatives].slice(0, 3) };
}
const only = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));

export function parseTrainedSignModel(text: string): TrainedSignModel {
  if (typeof text !== 'string' || text.length > 20_000_000) throw new Error('Trained model too large');
  const raw = JSON.parse(text);
  if (!only(raw, ['format','version','feature_version','tracking_profile','gallery','classifier','vocabulary','number_extension'])
    || raw.format !== 'lingora-trained-sign-bundle-v1' || raw.version !== 1
    || raw.feature_version !== 'two-hand-body-v2' || raw.tracking_profile !== 'hands-pose-recovery-video-v2')
    throw new Error('Invalid trained model format');
  const g = raw.gallery, c = raw.classifier;
  if (!only(g, ['format','version','feature_version','input_frames','feature_dim','matching','templates'])
    || !only(g.matching, ['profile','labels','templateIds']) || !Array.isArray(g.templates)
    || g.templates.some(t => !only(t, ['id','label','normalized'])
      || typeof t.id !== 'string' || /[\\/]|\.(?:mp4|wav|webm|mov)/i.test(t.id)
      || !only(t.normalized, ['vectors','reference','durationMs','handCoverage']))
    || !only(c, ['format','feature_version','descriptor','classes','mean','scale','weight','bias','minimum_score','minimum_margin','motion_gate'])
    || !only(c.motion_gate, ['profile','minimum_span'])) throw new Error('Unexpected trained model metadata');
  const gallery = matcher.parseMotionModel(JSON.stringify(g));
  const classifier = parseSkeletalCandidate(JSON.stringify(c));
  const labels = [...new Set(gallery.templates.map(t => t.label))].sort();
  const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (gallery.version !== 2 || gallery.matching?.profile !== 'visibility-aware-dtw-v1'
    || !same(labels, gallery.matching.labels) || !same(gallery.templates.map(t => t.id), gallery.matching.templateIds)
    || gallery.templates.some(t => t.normalized.reference !== 'body')
    || !same(labels, classifier.classes) || !classifier.motion_gate || classifier.motion_gate.minimum_span <= 0)
    throw new Error('Trained model label/tracking contract mismatch');
  let number_extension: TrainedSignModel['number_extension'];
  let vocabularyLabels = labels;
  if (raw.number_extension !== undefined) {
    const ext = raw.number_extension;
    if (!only(ext, ['templates', 'classifier']) || !Array.isArray(ext.templates)
      || ext.templates.some(t => !only(t, ['id','label','normalized']) || typeof t.id !== 'string'
        || /[\\/]|\.(?:mp4|wav|webm|mov)/i.test(t.id)
        || typeof t.label !== 'string' || !['number_one','number_two','number_three'].includes(t.label)
        || !only(t.normalized, ['vectors','reference','durationMs','handCoverage'])))
      throw new Error('Invalid number extension');
    const combined = { ...g, templates: [...g.templates, ...ext.templates],
      matching: { ...g.matching, labels: [...labels, 'number_three'],
        templateIds: [...gallery.matching!.templateIds, ...ext.templates.map(t => t.id)] } };
    const checked = matcher.parseMotionModel(JSON.stringify(combined));
    const c2 = ext.classifier;
    if (!only(c2, ['format','feature_version','descriptor','classes','mean','scale','weight','bias','minimum_score','minimum_margin','motion_gate'])
      || !only(c2.motion_gate, ['profile','minimum_span'])) throw new Error('Invalid number classifier metadata');
    const numberClassifier = parseSkeletalCandidate(JSON.stringify(c2));
    vocabularyLabels = [...labels, 'number_three'];
    if (!same(vocabularyLabels, numberClassifier.classes) || !numberClassifier.motion_gate
      || numberClassifier.motion_gate.minimum_span <= 0 || checked.templates.some(t => t.normalized.reference !== 'body'))
      throw new Error('Invalid number extension contract');
    number_extension = { templates: checked.templates.slice(gallery.templates.length), classifier: numberClassifier };
  }
  if (!Array.isArray(raw.vocabulary) || raw.vocabulary.length !== vocabularyLabels.length
    || raw.vocabulary.some(v => !only(v, ['label','textUz']) || typeof v.label !== 'string'
      || typeof v.textUz !== 'string' || !v.textUz.trim() || v.textUz.length > 100 || /[<>\u0000-\u001f]/.test(v.textUz))
    || !same(vocabularyLabels, raw.vocabulary.map(v => v.label))) throw new Error('Invalid trained vocabulary');
  return { format: 'lingora-trained-sign-bundle-v1', version: 1, feature_version: 'two-hand-body-v2',
    tracking_profile: 'hands-pose-recovery-video-v2', gallery, classifier,
    vocabulary: raw.vocabulary as TrainedSignModel['vocabulary'], ...(number_extension ? { number_extension } : {}) };
}

export function createTrainedMatcher(model: TrainedSignModel) {
  const classify = createHybridClassifier(matcher, model.gallery, model.classifier, inferSkeletalCandidate);
  const ext = model.number_extension;
  if (!ext) return (frames: matcher.SequenceFrame[]): matcher.SequenceMatch => guardConfusableGreeting(classify(frames).result);
  const templates = [...model.gallery.templates, ...ext.templates];
  const gallery = { ...model.gallery, templates, matching: { ...model.gallery.matching!,
    labels: [...model.gallery.matching!.labels, 'number_three'], templateIds: templates.map(t => t.id) } };
  const classifyNumbers = createHybridClassifier(matcher, gallery, ext.classifier, inferSkeletalCandidate);
  const suggestStaticNumber = createStaticNumberSuggestion(templates);
  const evaluate = (frames: matcher.SequenceFrame[]): matcher.SequenceMatch => {
    const original = classify(frames).result;
    if (original.label !== 'none') return original;
    const candidate = classifyNumbers(frames).result;
    if (['number_one','number_two','number_three'].includes(candidate.label)) return candidate;
    if (original.reason === 'insufficient_motion' && candidate.reason === 'insufficient_motion') {
      const normalized = matcher.normalizeSequence(frames);
      if (normalized) return { ...original, alternatives: suggestStaticNumber(normalized) };
    }
    return original;
  };
  return (frames: matcher.SequenceFrame[]): matcher.SequenceMatch => {
    const original = evaluate(frames);
    if (original.label !== 'none') return guardConfusableGreeting(original);
    if (!['too_distant', 'ambiguous'].includes(original.reason)) return original;
    const short = trimRestingEdges(frames, 200), long = trimRestingEdges(frames, 400);
    if (short.length === frames.length || long.length === frames.length) return original;
    const a = evaluate(short), b = evaluate(long);
    return windowSuggestion(original, a, b);
  };
}
