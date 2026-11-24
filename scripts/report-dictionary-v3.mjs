import {readFile,writeFile} from 'node:fs/promises';
import {loadMatcher} from './evaluate-motion.mjs';
import {createHybridClassifier} from './hybrid-sign-inference.mjs';
import {parseSkeletalCandidate,inferSkeletalCandidate} from './skeletal-inference.mjs';
const root='private-video-work/training-expanded-v3';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const matcher=await loadMatcher();
const previousPath=`${root}/previous-public-model.json`;
let previousText;
try{previousText=await readFile(previousPath,'utf8');}catch(error){
 if(error.code!=='ENOENT')throw error;
 previousText=await readFile('public/model/trained-sign-model.json','utf8');
 if(JSON.parse(previousText).classifier.classes.length!==40)throw Error('Missing original 40-word comparison baseline');
 await writeFile(previousPath,previousText);
}
const previousBundle=JSON.parse(previousText);
const gallery=matcher.parseMotionModel(await readFile(`${root}/baseline-model.json`,'utf8'));
const classifier=parseSkeletalCandidate(await readFile(`${root}/skeletal/candidate-model.json`,'utf8'));
const previous=createHybridClassifier(matcher,previousBundle.gallery,previousBundle.classifier,inferSkeletalCandidate);
const candidate=createHybridClassifier(matcher,gallery,classifier,inferSkeletalCandidate);
const captured=await read(`${root}/live/tracked-live.json`),live=await read(`${root}/live/live-results.json`);
if(!live.finishedAt)throw Error('Incomplete live capture');
// Older live-only harnesses set their aggregate flag only in the pixel loop.
// Validate every completed per-case assertion and saved frame count directly.
const capturedById=new Map(captured.cases.map(c=>[c.id,c]));
const verified=live.liveCases.length===captured.cases.length&&live.liveCases.every(c=>{
 const saved=capturedById.get(c.id),d=c.trackingDiagnostics;
 return saved&&saved.frames.length===c.capturedFrames&&d?.mode==='recovery'&&d.frames>=c.capturedFrames;
});
if(!verified)throw Error('Unverified per-case live tracker');
const known=new Set(previousBundle.vocabulary.map(v=>v.label));
const rows=captured.cases.filter(c=>c.scope==='word').map(c=>({id:c.id,expected:c.expected,split:c.split,
 cohort:c.expected==='none'?'unknown':known.has(c.expected)?'existing':'added',
 previous:previous(c.frames).result,candidate:candidate(c.frames).result}));
const summarize=(rows,key)=>({examples:rows.length,correct:rows.filter(r=>r.expected===r[key].label).length,
 wrong:rows.filter(r=>r[key].label!=='none'&&r[key].label!==r.expected).length,
 rejected:rows.filter(r=>r.expected!=='none'&&r[key].label==='none').length});
const summary=Object.fromEntries(['existing','added','unknown'].map(cohort=>{
 const selected=rows.filter(r=>r.cohort===cohort&&(r.split==='regression'||r.expected==='none'));
 return[cohort,{previous:summarize(selected,'previous'),candidate:summarize(selected,'candidate')}];
}));
const pixels=await read(`${root}/pixel-comparison.json`),leakage=await read(`${root}/leakage-check/report.json`);
const gate={pixelsPassed:pixels.pixelGatePassed,actualRefitLeakagePassed:leakage.passed,
 expectedCohortCoverage:summary.existing.candidate.examples===38&&summary.added.candidate.examples===8&&summary.unknown.candidate.examples>=1,
 liveExistingPreserved:summary.existing.candidate.correct>=summary.existing.previous.correct,
 liveExistingWrongNotIncreased:summary.existing.candidate.wrong<=summary.existing.previous.wrong,
 liveAddedAtLeastSix:summary.added.candidate.correct>=6&&summary.added.candidate.wrong===0,
 liveUnknownRejected:summary.unknown.candidate.correct===summary.unknown.candidate.examples};
const result={summary,gate,passed:Object.values(gate).every(Boolean),pairedIdenticalFrames:true,perCaseTrackerVerified:verified,
 scope:'Previously inspected same-session development source replays. Not unseen-signer accuracy.',rows};
await writeFile(`${root}/release-comparison.json`,JSON.stringify(result,null,2));
if(result.passed){
 const sources=await read('private-video-work/dataset-v3/sources.json');
 const vocabulary=new Map([...previousBundle.vocabulary.map(v=>[v.label,v.textUz]),...sources.entries.map(s=>[s.label,s.labelUz])]);
 const bundle={format:'lingora-trained-sign-bundle-v1',version:1,feature_version:'two-hand-body-v2',
  tracking_profile:'hands-pose-recovery-video-v2',gallery,classifier,
  vocabulary:classifier.classes.map(label=>({label,textUz:vocabulary.get(label)}))};
 if(bundle.vocabulary.some(v=>!v.textUz))throw Error('Missing exact Uzbek word');
 await writeFile(`${root}/trained-sign-model.json`,JSON.stringify(bundle));
}
console.log(JSON.stringify({summary,gate,passed:result.passed},null,2));
