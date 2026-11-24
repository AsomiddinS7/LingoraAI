// Export only inference data; private training/evaluation records stay ignored.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function publicBundle(privateBundle) {
  const pick = (value, keys) => Object.fromEntries(keys.map(k => [k, value[k]]));
  const gallery = pick(privateBundle.gallery, ['format','version','feature_version','input_frames','feature_dim']);
  gallery.templates = privateBundle.gallery.templates.map((t, i) => ({
    id: `reference-${String(i + 1).padStart(3, '0')}`, label: t.label,
    normalized: pick(t.normalized, ['vectors','reference','durationMs','handCoverage']),
  }));
  gallery.matching = { profile: privateBundle.gallery.matching.profile,
    labels: [...privateBundle.gallery.matching.labels], templateIds: gallery.templates.map(t => t.id) };
  const classifier = pick(privateBundle.classifier, ['format','feature_version','descriptor','classes','mean','scale','weight','bias','minimum_score','minimum_margin']);
  classifier.motion_gate = pick(privateBundle.classifier.motion_gate, ['profile','minimum_span']);
  return { format: 'lingora-trained-sign-bundle-v1', version: 1, feature_version: 'two-hand-body-v2',
    tracking_profile: 'hands-pose-recovery-video-v2', gallery, classifier,
    vocabulary: privateBundle.vocabulary.map(v => pick(v, ['label','textUz'])) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2] ?? 'private-video-work/training-expanded-v2/trained-sign-model.json';
  const model = publicBundle(JSON.parse(await readFile(input, 'utf8')));
  await writeFile('public/model/trained-sign-model.json', JSON.stringify(model));
  await writeFile('src/data/trainedVocabulary.json', JSON.stringify(model.vocabulary, null, 2) + '\n');
  console.log(`Exported ${model.classifier.classes.length} labels and ${model.gallery.templates.length} inference references.`);
}
