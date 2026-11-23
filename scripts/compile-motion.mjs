// Compile local reviewed examples to derived model data; never copies footage or source paths.
// Usage: node scripts/compile-motion.mjs --in private-video-work/templates-train.json --out private-video-work/motion-model.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMatcher } from './evaluate-motion.mjs';

export async function compileFile(input, output, verifyInput) {
  const matcher = await loadMatcher();
  const dataset = matcher.parseInferenceDataset(await readFile(input, 'utf8'));
  const model = matcher.compileTemplateDataset(dataset.templates);
  let verifiedClips = 0;
  if (verifyInput) {
    const verification = matcher.parseTemplateDataset(await readFile(verifyInput, 'utf8'));
    for (const clip of verification.templates) {
      const raw = matcher.matchSequence(clip.frames, dataset.templates);
      const compiled = matcher.matchSequence(clip.frames, model.templates);
      if (JSON.stringify(raw) !== JSON.stringify(compiled)) throw new Error(`Compiled prediction differs for ${clip.id}`);
      verifiedClips++;
    }
  }
  await writeFile(output, JSON.stringify(model), 'utf8');
  return { templates: model.templates.length, labels: [...new Set(model.templates.map((t) => t.label))],
    ...(verifyInput ? { verifiedClips, verification: 'Exact raw/compiled prediction parity; not a new accuracy evaluation' } : {}), output: resolve(output) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const input = args[args.indexOf('--in') + 1];
  const output = args[args.indexOf('--out') + 1];
  const verifyInput = args[4] === '--verify' ? args[5] : undefined;
  if (![4, 6].includes(args.length) || args[0] !== '--in' || args[2] !== '--out' || !input || !output
    || (args.length === 6 && !verifyInput))
    throw new Error('Usage: node scripts/compile-motion.mjs --in EXAMPLES.json --out MODEL.json [--verify HELDOUT.json]');
  console.log(JSON.stringify(await compileFile(input, output, verifyInput)));
}
