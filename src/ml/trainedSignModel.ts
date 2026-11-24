// The production app uses the same decision rule as the camera replay evaluation.
import * as matcher from './sequence';
import { parseSkeletalCandidate, inferSkeletalCandidate, type SkeletalModel } from '../../scripts/skeletal-inference.mjs';
import { createHybridClassifier } from '../../scripts/hybrid-sign-inference.mjs';

export interface TrainedSignModel {
  format: 'lingora-trained-sign-bundle-v1'; version: 1;
  feature_version: 'two-hand-body-v2'; tracking_profile: 'hands-pose-recovery-video-v2';
  gallery: matcher.MotionModel; classifier: SkeletalModel;
  vocabulary: { label: string; textUz: string }[];
}
const only = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));

export function parseTrainedSignModel(text: string): TrainedSignModel {
  if (typeof text !== 'string' || text.length > 20_000_000) throw new Error('Trained model too large');
  const raw = JSON.parse(text);
  if (!only(raw, ['format','version','feature_version','tracking_profile','gallery','classifier','vocabulary'])
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
  if (!Array.isArray(raw.vocabulary) || raw.vocabulary.length !== labels.length
    || raw.vocabulary.some(v => !only(v, ['label','textUz']) || typeof v.label !== 'string'
      || typeof v.textUz !== 'string' || !v.textUz.trim() || v.textUz.length > 100 || /[<>\u0000-\u001f]/.test(v.textUz))
    || !same(labels, raw.vocabulary.map(v => v.label))) throw new Error('Invalid trained vocabulary');
  return { format: 'lingora-trained-sign-bundle-v1', version: 1, feature_version: 'two-hand-body-v2',
    tracking_profile: 'hands-pose-recovery-video-v2', gallery, classifier,
    vocabulary: raw.vocabulary as TrainedSignModel['vocabulary'] };
}

export function createTrainedMatcher(model: TrainedSignModel) {
  const classify = createHybridClassifier(matcher, model.gallery, model.classifier, inferSkeletalCandidate);
  return (frames: matcher.SequenceFrame[]): matcher.SequenceMatch => classify(frames).result;
}
