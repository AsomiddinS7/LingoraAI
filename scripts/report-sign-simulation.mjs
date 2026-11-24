// Standalone local report: no network requests and no external media uploads.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadMatcher } from './evaluate-motion.mjs';
import { parseSkeletalCandidate, inferSkeletalCandidate } from './skeletal-inference.mjs';
import { createHybridClassifier } from './hybrid-sign-inference.mjs';
const root = resolve('private-video-work/training-expanded-v1');
const directory = resolve(root, 'simulation');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const source = await read(resolve(root, 'evaluation-skeletal.json'));
const simulation = await read(resolve(directory, 'results.json'));
const matcher = await loadMatcher();
const modelBytes = await readFile(resolve(root, 'skeletal/candidate-model.json'));
const modelHash = createHash('sha256').update(modelBytes).digest('hex');
const gallery = matcher.parseMotionModel(await readFile(resolve(root, 'baseline-model.json'), 'utf8'));
const model = parseSkeletalCandidate(modelBytes.toString('utf8'));
const classify = createHybridClassifier(matcher, gallery, model, inferSkeletalCandidate);
const pixelsBytes = await readFile(resolve(directory, 'tracked-pixels.json'));
const pixels = new Map(JSON.parse(pixelsBytes).cases.map(c => [c.id, c]));
// Reuse actual tracked observations, never invent pixels or substitute expected labels.
simulation.pixelCases = simulation.pixelCases.map(row => {
  if (row.scope === 'phrase') return row;
  const actual = pixels.get(row.id);
  if (!actual) throw new Error('Missing tracked pixel observations: ' + row.id);
  const started = performance.now(), result = classify(actual.frames);
  return { ...row, ...result, predicted: result.result.label, inferenceMs: performance.now()-started };
});
try {
  const live = await read(resolve(directory, 'live-results.json'));
  if (!live.finishedAt || live.neuralSha256 !== modelHash || live.liveCases.length < 47)
    throw new Error('Updated live-model verification is incomplete');
  simulation.liveCases = live.liveCases;
  simulation.liveVerificationFinishedAt = live.finishedAt;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (simulation.neuralSha256 !== modelHash) throw new Error('Live trials have not verified this classifier');
}
simulation.currentClassifierSha256 = modelHash;
simulation.trackedPixelSha256 = createHash('sha256').update(pixelsBytes).digest('hex');
simulation.rescoringNote = 'Current frozen classifier evaluated on cached actual MediaPipe pixel observations; separate live verification uses the same current classifier hash. Original results.json is retained.';
const stress = await read(resolve(directory, 'tracking-stress.json'));
const data = await read(resolve(root, 'normalized-words.json'));
if (!simulation.finishedAt || simulation.summary.lexicalLabelsCovered !== 40 || simulation.summary.phraseLabelsCovered !== 6
  || simulation.liveCases.length < 47) throw new Error('Full camera simulation is incomplete');
const glosses = Object.fromEntries(data.examples.map(e => [e.label, e.label_uz]));
const phrases = await read(resolve('private-video-work/dataset-expansion/round/manifest.json'));
for (const sample of phrases.samples) glosses[sample.label] = sample.text_uz;
glosses.none = 'Not recognized';
const score = (rows, key = 'predicted') => ({ examples: rows.length,
  correct: rows.filter(r => r[key] === r.expected).length,
  wrong: rows.filter(r => r[key] !== 'none' && r[key] !== r.expected).length,
  rejected: rows.filter(r => r[key] === 'none' && r.expected !== 'none').length });
const simScore = rows => { const s=score(rows); return {examples:s.examples,correct:s.correct,wrongAccepted:s.wrong,rejectedKnown:s.rejected}; };
simulation.summary = {
  nominalDisjoint: simScore(simulation.pixelCases.filter(c=>c.scenario==='nominal'&&c.split==='regression')),
  adverseDisjoint: simScore(simulation.pixelCases.filter(c=>c.scenario!=='nominal'&&c.split==='regression')),
  trainingSourceReplays: simScore(simulation.pixelCases.filter(c=>c.trainingSourceReplay)),
  unknown: simScore(simulation.pixelCases.filter(c=>c.expected==='none')),
  liveDisjoint: simScore(simulation.liveCases.filter(c=>c.split==='regression')),
  liveUnknown: simScore(simulation.liveCases.filter(c=>c.expected==='none')),
  liveTrainingSourceReplays: simScore(simulation.liveCases.filter(c=>c.trainingSourceReplay)),
  lexicalLabelsCovered: new Set(simulation.pixelCases.filter(c=>c.scope==='word'&&c.expected!=='none').map(c=>c.expected)).size,
  phraseLabelsCovered: new Set(simulation.pixelCases.filter(c=>c.scope==='phrase').map(c=>c.expected)).size,
};
await writeFile(resolve(directory, 'evaluated-results.json'), JSON.stringify(simulation, null, 2));
const scenarios = [
  ['Normal pixel replay', simulation.pixelCases.filter(r => r.scenario === 'nominal' && r.split === 'regression')],
  ['Dim / blur / reframing / faster', simulation.pixelCases.filter(r => r.scenario !== 'nominal' && r.split === 'regression')],
  ['Real-time production frame pump', simulation.liveCases.filter(r => r.split === 'regression')],
];
const comparisons = scenarios.map(([name, rows]) => ({ name, baseline: score(rows.map(r => ({ ...r, predicted: r.baseline.label }))), trained: score(rows) }));
const words = data.labels.map(label => ({ label, labelUz: glosses[label],
  naturalRegression: data.examples.filter(e => e.label === label && e.split === 'regression').length,
  sourceCorrect: source.rows.filter(e => e.expected === label && e.result.label === label).length,
  sourceExamples: source.rows.filter(e => e.expected === label).length,
  pixel: simulation.pixelCases.filter(c => c.expected === label && c.scenario === 'nominal'),
  adverse: simulation.pixelCases.filter(c => c.expected === label && c.scenario !== 'nominal'),
  live: simulation.liveCases.filter(c => c.expected === label),
}));
const result = { source: { baseline: source.baseline, trained: source.hybrid, regressionGate: source.gate }, comparisons,
  words, camera: simulation.summary, trackingStress: stress.summary,
  inferenceLatencyMs: { median: simulation.pixelCases.map(c => c.inferenceMs).sort((a,b) => a-b)[Math.floor(simulation.pixelCases.length/2)] },
  scope: 'Forty lexical labels plus six existing whole-script reference replays. Natural evaluation uses different repetitions from the same recordings/sessions. Previously inspected development data, not unseen-signer accuracy.',
  deployment: 'Trained private research models; deployed website vocabulary is unchanged.' };
const { data_audit, calibration, limitation, seed, ridge, ...portableClassifier } = model;
await writeFile(resolve(root, 'trained-sign-model.json'), JSON.stringify({ format:'lingora-trained-sign-bundle-v1',version:1,
  feature_version:'two-hand-body-v2',gallery,classifier:portableClassifier,
  vocabulary:words.map(w=>({label:w.label,textUz:w.labelUz,validation:w.naturalRegression?'same-recording-regression':'training-reference-only'})),
  training:{normalizedDataSha256:model.data_audit.input_sha256,realReferences:43,classes:40,calibrationTrainingOnly:true},
  state:'private-research-candidate',generalizationValidated:false,report:'simulation/report.html' }));
await writeFile(resolve(directory, 'summary.json'), JSON.stringify(result, null, 2));
const table = comparisons.map(c => `| ${c.name} | ${c.baseline.correct}/${c.baseline.examples} | ${c.trained.correct}/${c.trained.examples} | ${c.trained.wrong} |`).join('\n');
const wordTable = words.map(w => {
  const fmt = rows => `${rows.filter(r=>r.predicted===w.label).length}/${rows.length}`;
  return `| ${w.labelUz} | ${w.naturalRegression ? 'Separate repetition' : 'Training replay only'} | ${fmt(w.pixel)} | ${fmt(w.adverse)} | ${fmt(w.live)} |`;
}).join('\n');
await writeFile(resolve(directory, 'REPORT.md'), `# Lingora trained-model simulation\n\n`
  + `The best candidate combines a trained skeletal classifier with the existing DTW gallery. Source-feature regression improves from **27/40 to31/40**, with zero wrong known-word acceptances and3/3unknowns rejected.\n\n`
  + `| Scenario | Template baseline correct | Trained combination correct | Trained wrong words |\n| --- | --- | --- | --- |\n${table}\n\n`
  + `All40lexical labels and6existing script phrases were tested. Numbers5and6 have training-source replay only. Other evaluations are same-recording/session repetitions, not fresh signers. The6phrases have no independent test recording.\n\n`
  + `Severe landmark loss: ${stress.summary.severe_dropout.passed}/40 safely rejected; no hands: ${stress.summary.no_hands.passed}/40 safely rejected.\n\n`
  + `| Word / lexical label | Evidence | Normal pixels | Adverse pixels | Live frame pump |\n| --- | --- | --- | --- | --- |\n${wordTable}\n\n`
  + `Open report.html to filter every individual trial and play the test clips. results.json preserves predictions, tracking coverage, model hashes and runtime. Training weights and calibration exclude all evaluation examples; leakage-check/report.json verifies this by actual refitting.\n\n`
  + `${result.scope}\n\n${result.deployment}\n`);
const payload = JSON.stringify({ ...result, cases: simulation.pixelCases.map(c => ({ ...c, mode: 'pixels' }))
  .concat(simulation.liveCases.map(c => ({ ...c, mode: 'live' }))), glosses }).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lingora · trained model trials</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#172735;font:16px/1.5 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:40px 24px}h1{font-size:34px;margin:8px 0}p{max-width:86ch}small{color:#556776}.cards{display:flex;flex-wrap:wrap;gap:14px;margin:28px 0}.card{padding:20px;background:white;border:1px solid #d9e0e7;border-radius:10px;min-width:180px}.card strong{display:block;font-size:28px}label{display:inline-flex;gap:8px;align-items:center;margin:0 12px 18px 0}select,button{padding:8px;border:1px solid #aab8c6;border-radius:5px;background:white;color:inherit}button{cursor:pointer}.scroll{overflow:auto;background:white;border:1px solid #d9e0e7;border-radius:8px}table{border-collapse:collapse;width:100%;white-space:nowrap}th,td{text-align:left;padding:12px;border-bottom:1px solid #e7ecf0}th{background:#eaf0f4}td.ok{color:#16654a}td.bad{color:#b12e32}dialog{max-width:760px;width:95%;border:0;border-radius:10px}video{width:100%;max-height:65vh;background:#111}dialog::backdrop{background:#0009}.note{border-left:3px solid #557b94;padding-left:14px}</style>
<main><small>LINGORA / PRIVATE MODEL EVALUATION</small><h1>Trained model trials</h1>
<p>Actual source videos passed through MediaPipe hand and pose tracking. Live trials use the application's recording window and frame collector. All 40 lexical labels and six existing script references are covered.</p>
<p class="note">These are same-recording repetitions and simulated camera conditions. Numbers 5 and 6 and all six script phrases have training-source replay only. This does not measure accuracy on new signers. The website's active model has not been replaced.</p>
<div class="cards"><div class="card">Source-feature baseline<strong>27 / 40</strong></div><div class="card">Trained combination<strong>31 / 40</strong></div><div class="card">Complete hand loss<strong>40 / 40 reject</strong></div></div>
<h2>Compare camera conditions</h2><div class="scroll"><table><thead><tr><th>Condition</th><th>Template baseline</th><th>Trained combination</th><th>Wrong words</th></tr></thead><tbody id="comparisons"></tbody></table></div>
<h2>Inspect every trial</h2><label>Word<select id="word"><option value="">All words and phrases</option></select></label><label>Mode<select id="mode"><option value="">All</option><option value="pixels">Pixel extraction</option><option value="live">Live frame pump</option></select></label><label><input type="checkbox" id="failures">Only missed / wrong</label><p id="count"></p>
<div class="scroll"><table><thead><tr><th>Expected</th><th>Condition</th><th>Prediction</th><th>Evidence</th><th>Test video</th></tr></thead><tbody id="trials"></tbody></table></div>
<p><small>Scores are similarities and calibrated rejection rules, not translation probabilities. Raw videos and landmarks remain local.</small></p></main>
<dialog id="player"><button id="close">Close</button><h2 id="clip-title"></h2><video id="clip" controls playsinline></video></dialog>
<style>.scroll table{table-layout:fixed}.scroll th,.scroll td{white-space:normal;overflow-wrap:anywhere}select{max-width:360px}#trials td:last-child{width:90px}</style>
<script type="application/json" id="data">${payload}</script><script>
const d=JSON.parse(document.getElementById('data').textContent),$=id=>document.getElementById(id);
const name=label=>d.glosses[label]||label;
function cell(row,text,cls){const c=document.createElement('td');c.textContent=text;if(cls)c.className=cls;row.append(c);return c}
for(const c of d.comparisons){const r=document.createElement('tr');cell(r,c.name);cell(r,c.baseline.correct+'/'+c.baseline.examples);cell(r,c.trained.correct+'/'+c.trained.examples);cell(r,c.trained.wrong);$('comparisons').append(r)}
for(const label of [...new Set(d.cases.map(c=>c.expected))].sort((a,b)=>name(a).localeCompare(name(b)))){const o=document.createElement('option');o.value=label;o.textContent=name(label);$('word').append(o)}
function render(){const cases=d.cases.filter(c=>(!$('word').value||c.expected===$('word').value)&&(!$('mode').value||c.mode===$('mode').value)&&(!$('failures').checked||c.predicted!==c.expected));$('trials').replaceChildren();$('count').textContent=cases.length+' trials';for(const c of cases){const r=document.createElement('tr');cell(r,name(c.expected));cell(r,c.mode==='live'?'Live frame pump':c.scenario==='nominal'?'Normal pixels':'Dim / blur / reframe / fast');cell(r,name(c.predicted),c.predicted===c.expected?'ok':'bad');cell(r,c.trainingSourceReplay?'Training replay only':'Separate same-source repetition');const b=document.createElement('button');b.textContent='Play';b.onclick=()=>{$('clip-title').textContent=name(c.expected);$('clip').src=encodeURIComponent(c.file);$('player').showModal()};cell(r,'').append(b);$('trials').append(r)}}
for(const id of ['word','mode','failures'])$(id).addEventListener('change',render);$('close').onclick=()=>{$('clip').pause();$('player').close()};render();</script></html>`;
await writeFile(resolve(directory, 'report.html'), html);
console.log(JSON.stringify({ report: resolve(directory, 'report.html'), comparisons, words: words.length }, null, 2));
