import {readFile,writeFile} from 'node:fs/promises';
import {loadMatcher} from './evaluate-motion.mjs';
import {parseSkeletalCandidate,inferSkeletalCandidate} from './skeletal-inference.mjs';
import {createHybridClassifier} from './hybrid-sign-inference.mjs';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const matcher=await loadMatcher(),old='private-video-work/training-expanded-v1',root='private-video-work/training-expanded-v2/camera';
const previous=createHybridClassifier(matcher,matcher.parseMotionModel(await readFile(`${old}/baseline-model.json`,'utf8')),
  parseSkeletalCandidate(await readFile(`${old}/skeletal/candidate-model.json`,'utf8')),inferSkeletalCandidate);
const candidate=createHybridClassifier(matcher,matcher.parseMotionModel(await readFile(`${root}/baseline-model.json`,'utf8')),
  parseSkeletalCandidate(await readFile(`${root}/skeletal/candidate-model.json`,'utf8')),inferSkeletalCandidate);
const summary=(rows,key)=>({examples:rows.length,correct:rows.filter(r=>r[key].label===r.expected).length,
  wrong:rows.filter(r=>r[key].label!=='none'&&r[key].label!==r.expected).length,
  rejected:rows.filter(r=>r[key].label==='none'&&r.expected!=='none').length});
const profiles=[];
for(const mode of ['legacy','stable','recovery']){
  const pixels=await read(`private-video-work/tracking-v2/${mode}/tracked-pixels.json`);
  const capture=await read(`private-video-work/tracking-v2/${mode}/results.json`);
  if(!capture.runtime.sharedTrackerVerified)throw new Error('Invalid tracker capture');
  const rows=pixels.cases.filter(c=>c.scope==='word').map(c=>({...c,frames:undefined,previous:previous(c.frames).result,candidate:candidate(c.frames).result}));
  const groups={nominal:rows.filter(r=>r.split==='regression'&&r.scenario==='nominal'),
    adverse:rows.filter(r=>r.split==='regression'&&r.scenario!=='nominal'),unknown:rows.filter(r=>r.expected==='none')};
  profiles.push({mode,groups:Object.fromEntries(Object.entries(groups).map(([name,selected])=>[name,{previous:summary(selected,'previous'),candidate:summary(selected,'candidate')}])),rows});
}
await writeFile(`${root}/camera-comparison.json`,JSON.stringify({scope:'Paired development comparison; camera training uses first performances only; second takes remain excluded from fitting.',profiles},null,2));
console.log(JSON.stringify(profiles.map(({mode,groups})=>({mode,groups})),null,2));
