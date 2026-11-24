import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='private-video-work/tracking-v2',modelRoot='private-video-work/training-expanded-v2';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const comparison=await read(`${modelRoot}/camera/camera-comparison.json`);
const tracking=await read(`${root}/comparison.json`);
const live=await read(`${root}/selected-live/live-results.json`);
const classifierBytes=await readFile(`${modelRoot}/camera/skeletal/candidate-model.json`);
const classifierHash=createHash('sha256').update(classifierBytes).digest('hex');
if(!live.finishedAt||live.liveCases.length<47||live.neuralSha256!==classifierHash)throw new Error('Final live verification is incomplete or stale');
if(live.liveCases.some(c=>!c.trackingDiagnostics||c.trackingDiagnostics.frames<c.capturedFrames||c.trackingDiagnostics.mode!=='recovery'))throw new Error('Live tracker instance was not verified');
if(tracking.completedProfiles.length!==3)throw new Error('Tracking comparison incomplete');
const data=await read(`${modelRoot}/camera/normalized-words.json`);
const words=Object.fromEntries(data.examples.map(e=>[e.label,e.label_uz]));words.none='Not recognized';
const baseline=comparison.profiles.find(p=>p.mode==='legacy'),selected=comparison.profiles.find(p=>p.mode==='recovery');
const score=rows=>({examples:rows.length,correct:rows.filter(r=>r.predicted===r.expected).length,
  wrong:rows.filter(r=>r.predicted!=='none'&&r.predicted!==r.expected).length});
const liveSummary={known:score(live.liveCases.filter(c=>c.split==='regression')),
  unknown:score(live.liveCases.filter(c=>c.expected==='none')),
  trainingReplays:score(live.liveCases.filter(c=>c.trainingSourceReplay))};
const summary={baseline:baseline.groups,selected:selected.groups,live:liveSummary,
  tracking:tracking.profiles.map(p=>({mode:p.mode,...p.quality})),training:data.provenance,
  scope:'Previously inspected, same-recording development tests; no fresh-signer or expert semantic accuracy claim. Numbers5/6 and all6phrases have training-source replay only.'};
await writeFile(`${root}/summary.json`,JSON.stringify(summary,null,2));
const gallery=await read(`${modelRoot}/camera/baseline-model.json`),model=JSON.parse(classifierBytes);
const {data_audit,calibration,limitation,seed,ridge,...portable}=model;
await writeFile(`${modelRoot}/trained-sign-model.json`,JSON.stringify({format:'lingora-trained-sign-bundle-v1',version:1,
  feature_version:'two-hand-body-v2',tracking_profile:'hands-pose-recovery-video-v2',gallery,classifier:portable,
  vocabulary:data.labels.map(label=>({label,textUz:words[label]})),training:data.provenance,
  decision:'Use createHybridClassifier with the bundled gallery and classifier; classifier alone is not the evaluated decision rule.',
  state:'local-research-model',generalizationValidated:false,report:'../tracking-v2/report.html'}));
const table=['nominal','adverse','unknown'].map(k=>`| ${k} | ${baseline.groups[k].previous.correct}/${baseline.groups[k].previous.examples} | ${selected.groups[k].candidate.correct}/${selected.groups[k].candidate.examples} | ${selected.groups[k].candidate.wrong} |`).join('\n');
await writeFile(`${root}/REPORT.md`,`# Model and tracking upgrade\n\n`
 +`Selected: stable anatomical hand identity with bounded wrist-region recovery, plus a camera-adapted trained classifier.\n\n`
 +`| Scenario | Previous tracker/model | Updated tracker/model | Wrong outputs after update |\n| --- | --- | --- | --- |\n${table}\n\n`
 +`Live reserved-take replay: ${liveSummary.known.correct}/${liveSummary.known.examples}; wrong words: ${liveSummary.known.wrong}. Live idle rejected: ${liveSummary.unknown.correct}/${liveSummary.unknown.examples}.\n\n`
 +`Two-hand frame coverage: ${summary.tracking[0].bothHandsPercent.toFixed(1)}% to ${summary.tracking[2].bothHandsPercent.toFixed(1)}%. These are detection coverage counts, not annotated detection accuracy.\n\n`
 +`Training:85camera views of43real training performances;40labels. One failed view was quarantined. Reserved second takes are excluded from all fitting and calibration.\n\n`
 +`${summary.scope}\n\nSee report.html for per-word results, camera/camera-comparison.json for full paired results, and training-expanded-v2/camera/leakage-check/report.json for actual refit leakage verification.\n`);
const cases=selected.rows.filter(c=>c.split==='regression'||c.expected==='none').map(c=>({
  expected:c.expected,predicted:c.candidate.label,condition:c.scenario,file:c.file,kind:'pixel',training:false,
})).concat(live.liveCases.map(c=>({expected:c.expected,predicted:c.predicted,condition:'live',file:c.file,kind:'live',training:c.trainingSourceReplay})));
const payload=JSON.stringify({summary,words,cases}).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lingora model and tracking upgrade</title>
<style>*{box-sizing:border-box}body{margin:0;color:#182a37;background:#f2f5f7;font:16px/1.5 system-ui}main{max-width:1160px;margin:auto;padding:36px 22px}h1{font-size:32px}small{color:#526571}.cards{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.card{padding:20px;background:white;border:1px solid #d8e2e7;border-radius:8px}.card strong{display:block;font-size:27px}select,button{padding:8px;border:1px solid #a9bac7;border-radius:5px;background:white;color:inherit}select{max-width:330px}label{display:inline-flex;gap:8px;margin:0 12px 18px 0}button{cursor:pointer}.scroll{overflow:auto;border:1px solid #d8e2e7;border-radius:8px}table{border-collapse:collapse;width:100%;table-layout:fixed;background:white}th,td{text-align:left;padding:11px;border-bottom:1px solid #e6ebef;overflow-wrap:anywhere}th{background:#e8eff4}.ok{color:#166348}.bad{color:#b22f34}dialog{max-width:760px;width:94%;border:0;border-radius:10px}dialog::backdrop{background:#0009}video{width:100%;max-height:70vh}</style>
<main><small>LINGORA / MODEL AND HAND TRACKING</small><h1>Camera-tested model upgrade</h1><p>The tracker keeps anatomical hand identity through brief losses and uses current-frame wrist crops to recover missed hands. No past hand coordinates are emitted as new detections.</p>
<div class="cards"><div class="card">Normal replay<strong>${baseline.groups.nominal.previous.correct}/40 → ${selected.groups.nominal.candidate.correct}/40</strong></div><div class="card">Difficult replay<strong>${baseline.groups.adverse.previous.correct}/38 → ${selected.groups.adverse.candidate.correct}/38</strong></div><div class="card">Two-hand coverage<strong>${summary.tracking[0].bothHandsPercent.toFixed(1)}% → ${summary.tracking[2].bothHandsPercent.toFixed(1)}%</strong></div></div>
<p>These are development tests using existing recordings. Numbers5/6 and all six phrases have training-source replays only. Coverage is not annotated hand-detection accuracy. The trained40-label bundle is local research; app tracking and inactivity rejection were updated in source.</p>
<p id="live"></p><h2>Inspect each trial</h2><label>Word <select id="word"><option value="">All</option></select></label><label><input type="checkbox" id="failures">Missed or wrong only</label><p id="count"></p>
<div class="scroll"><table><thead><tr><th>Expected</th><th>Condition</th><th>Prediction</th><th>Evidence</th><th>Video</th></tr></thead><tbody id="trials"></tbody></table></div></main>
<dialog id="player"><button id="close">Close</button><video id="clip" controls playsinline></video></dialog>
<script type="application/json" id="data">${payload}</script><script>
const d=JSON.parse(document.getElementById('data').textContent),$=id=>document.getElementById(id),name=l=>d.words[l]||l;
$('live').textContent='Live recording-window replay: '+d.summary.live.known.correct+'/'+d.summary.live.known.examples+' correct; '+d.summary.live.known.wrong+' wrong words.';
for(const label of [...new Set(d.cases.map(c=>c.expected))].sort((a,b)=>name(a).localeCompare(name(b)))){const o=document.createElement('option');o.value=label;o.textContent=name(label);$('word').append(o)}
function render(){const rows=d.cases.filter(c=>(!$('word').value||c.expected===$('word').value)&&(!$('failures').checked||c.expected!==c.predicted));$('count').textContent=rows.length+' trials';$('trials').replaceChildren();for(const c of rows){const row=document.createElement('tr');for(const text of [name(c.expected),c.condition,name(c.predicted),c.training?'Training replay':'Separate repetition']){const td=document.createElement('td');td.textContent=text;row.append(td)}row.children[2].className=c.expected===c.predicted?'ok':'bad';const td=document.createElement('td'),button=document.createElement('button');button.textContent='Play';button.onclick=()=>{$('clip').src='../training-expanded-v1/simulation/'+encodeURIComponent(c.file);$('player').showModal()};td.append(button);row.append(td);$('trials').append(row)}}
$('word').onchange=render;$('failures').onchange=render;$('close').onclick=()=>{$('clip').pause();$('player').close()};render();</script></html>`;
await writeFile(`${root}/report.html`,html);
console.log(JSON.stringify({report:`${root}/report.html`,live:liveSummary,selected:selected.groups},null,2));
