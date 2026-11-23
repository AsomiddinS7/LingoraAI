// Checks model packaging and source consistency, never held-out accuracy.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { loadMatcher } from './evaluate-motion.mjs';
Error.stackTraceLimit = 0;

const matcher = await loadMatcher();
const root = 'private-video-work/tracking-v1/';
const raw = matcher.parseTemplateDataset(await readFile(root + 'speech-templates-train.json', 'utf8'));
const compiled = matcher.parseMotionModel(await readFile(root + 'speech-model.json', 'utf8'));
const sourceChecks = raw.templates.map(template => {
  const result = matcher.matchSequence(template.frames, compiled.templates);
  assert.deepEqual(result, matcher.matchSequence(template.frames, raw.templates));
  assert.equal(result.label, template.label, `Source reference rejected: ${template.label}`);
  return { label: template.label, predicted: result.label, similarity: result.confidence,
    durationMs: template.frames.at(-1).t - template.frames[0].t };
});
const negativeData = JSON.parse(await readFile(root + 'greeting-templates-negative.json', 'utf8'));
// "none" is evaluation ground truth, never an importable inference label.
const negatives = matcher.parseTemplateDataset(JSON.stringify({ ...negativeData,
  templates: negativeData.templates.map(template => ({ ...template, label: template.label === 'none' ? 'expected_none' : template.label })),
}));
const negativeChecks = negatives.templates.map(template => {
  const result = matcher.matchSequence(template.frames, compiled.templates);
  assert.equal(result.label, 'none', `Unsupported lesson movement accepted: ${template.id}`);
  return { id: template.id, predicted: result.label };
});
const report = { kind: 'reference_consistency_only', heldOutSpeechExamples: 0,
  limitation: 'One source take per phrase; source replay does not establish accuracy on another performance or signer.',
  sourceChecks, negativeChecks };
await writeFile(root + 'packaging-consistency.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
