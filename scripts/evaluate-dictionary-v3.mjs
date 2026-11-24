// Paired development comparison. Source replays do not establish new-signer accuracy.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadMatcher} from './evaluate-motion.mjs';
import {createHybridClassifier} from './hybrid-sign-inference.mjs';
import {parseSkeletalCandidate,inferSkeletalCandidate} from './skeletal-inference.mjs';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const matcher=await loadMatcher(),root='private-video-work/training-expanded-v3';
const old=await read(`${root}/previous-public-model.json`);
const gallery=matcher.parseMotionModel(await readFile(`${root}/baseline-model.json`,'utf8'));
const weights=await readFile(`${root}/skeletal/candidate-model.json`,'utf8');
const candidate=createHybridClassifier(matcher,gallery,parseSkeletalCandidate(weights),inferSkeletalCandidate);
const previous=createHybridClassifier(matcher,old.gallery,old.classifier,inferSkeletalCandidate);
const oldCapture=await read('private-video-work/tracking-v2/recovery/tracked-pixels.json');
const newCapture=await read('private-video-work/dataset-v3/features/tracked-pixels.json');
const rows=[...oldCapture.cases.filter(r=>r.scope==='word'),...newCapture.cases.filter(r=>r.split==='regression')]
 .map(r=>({id:r.id,expected:r.expected,split:r.split,scenario:r.scenario,source:r.sourceRecordingId,
  cohort:r.id.startsWith('uzsl-')&&newCapture.cases.some(n=>n.id===r.id)?'added':'existing',
  trainingSourceReplay:r.trainingSourceReplay,previous:previous(r.frames).result,candidate:candidate(r.frames).result}));
const summarize=(selected,key)=>({examples:selected.length,correct:selected.filter(r=>r[key].label===r.expected).length,
 wrong:selected.filter(r=>r[key].label!=='none'&&r[key].label!==r.expected).length,
 rejected:selected.filter(r=>r.expected!=='none'&&r[key].label==='none').length});
const groups={existingNominal:rows.filter(r=>r.cohort==='existing'&&r.split==='regression'&&r.scenario==='nominal'),
 existingAdverse:rows.filter(r=>r.cohort==='existing'&&r.split==='regression'&&r.scenario!=='nominal'),
 unknown:rows.filter(r=>r.expected==='none'),
 addedNominal:rows.filter(r=>r.cohort==='added'&&r.scenario==='nominal'),
 addedAdverse:rows.filter(r=>r.cohort==='added'&&r.scenario!=='nominal')};
const summary=Object.fromEntries(Object.entries(groups).map(([k,r])=>[k,{previous:summarize(r,'previous'),candidate:summarize(r,'candidate')}]));
const gate={existingRecognitionPreserved:['existingNominal','existingAdverse'].every(k=>summary[k].candidate.correct>=summary[k].previous.correct),
 noAdditionalWrongWords:Object.values(summary).every(g=>g.candidate.wrong<=g.previous.wrong),
 unknownRejected:summary.unknown.candidate.correct===summary.unknown.candidate.examples,
 addedWordsNominal:summary.addedNominal.candidate.correct>=6&&summary.addedNominal.candidate.wrong===0,
 addedWordsAdverse:summary.addedAdverse.candidate.correct>=5&&summary.addedAdverse.candidate.wrong===0};
await writeFile(`${root}/pixel-comparison.json`,JSON.stringify({format:'lingora-dictionary-v3-evaluation',
 classifierSha256:createHash('sha256').update(weights).digest('hex'),summary,gate,pixelGatePassed:Object.values(gate).every(Boolean),
 requiresLiveReplay:true,newSignerValidated:false,rows},null,2));
console.log(JSON.stringify({summary,gate,pixelGatePassed:Object.values(gate).every(Boolean)},null,2));
