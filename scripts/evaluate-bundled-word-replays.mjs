// Evaluate the exact application store on saved MediaPipe landmarks. The clips
// are correlated source replays, not independent signer or webcam measurements.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const paths = ['private-video-work/tracking-v2/recovery/tracked-pixels.json',
  'private-video-work/training-expanded-v3/live/tracked-live.json'];
const sets = await Promise.all(paths.map(async p => ({ path: p, cases: JSON.parse(await readFile(p, 'utf8')).cases
  .filter(c => c.scope === 'word' && ['regression', 'unknown_regression'].includes(c.split)) })));
const model = await readFile('public/model/trained-sign-model.json', 'utf8');
const base = 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.goto(base + '/#/console', { waitUntil: 'domcontentloaded' });
  const comparisons = await page.evaluate(async ({ model, sets }) => {
    const { createSequenceStore } = await import('/src/ml/sequenceStore.ts');
    const store = createSequenceStore();
    store.importJson(model);
    return sets.map(set => ({ path: set.path, rows: set.cases.map(c => ({ id: c.id,
      expected: c.expected, scenario: c.scenario, split: c.split, result: store.match(c.frames) })) }));
  }, { model, sets });
  const summary = comparisons.map(set => {
    const groups = Object.groupBy(set.rows, c => c.expected === 'none' ? 'unknown' : c.scenario);
    return { path: set.path, groups: Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, {
      count: rows.length, correct: rows.filter(r => r.result.label === r.expected).length,
      wrong: rows.filter(r => r.result.label !== 'none' && r.result.label !== r.expected).length,
      rejected: rows.filter(r => r.expected !== 'none' && r.result.label === 'none').length,
    }])) };
  });
  const report = { modelSha256: createHash('sha256').update(model).digest('hex'),
    limitations: 'Saved correlated video replays; no independent signer or live webcam test.', summary, comparisons };
  await writeFile('private-video-work/uzslr-inspect/bundled-word-replays.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser.close(); }
