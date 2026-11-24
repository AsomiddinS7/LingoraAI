// Paired model comparisons reuse each tracker's actual observations, never labels as predictions.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadMatcher} from './evaluate-motion.mjs';
import {parseSkeletalCandidate,inferSkeletalCandidate} from './skeletal-inference.mjs';
import {createHybridClassifier} from './hybrid-sign-inference.mjs';

const root='private-video-work/tracking-v2';
await mkdir(root,{recursive:true});
const matcher=await loadMatcher();
const gallery=matcher.parseMotionModel(await readFile('private-video-work/training-expanded-v1/baseline-model.json','utf8'));
const classifiers=[];
for(const [name,path] of [
  ['previous','private-video-work/training-expanded-v1/skeletal/candidate-model.json'],
  ['activity','private-video-work/training-expanded-v2/skeletal/candidate-model.json'],
  ['ensemble','private-video-work/training-expanded-v2/ensemble/candidate-model.json'],
]){
  const bytes=await readFile(path),model=parseSkeletalCandidate(bytes.toString('utf8'));
  classifiers.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),classify:createHybridClassifier(matcher,gallery,model,inferSkeletalCandidate)});
}
const summarize=rows=>({examples:rows.length,correct:rows.filter(r=>r.predicted===r.expected).length,
  wrong:rows.filter(r=>r.predicted!=='none'&&r.predicted!==r.expected).length,
  rejected:rows.filter(r=>r.predicted==='none'&&r.expected!=='none').length});
const profiles=[];
for(const mode of ['legacy','stable','recovery']){
  let report,pixels;
  try{
    report=JSON.parse(await readFile(`${root}/${mode}/results.json`,'utf8'));
    if(!report.finishedAt)continue;
    if(!report.runtime.sharedTrackerVerified)continue;
    pixels=JSON.parse(await readFile(`${root}/${mode}/tracked-pixels.json`,'utf8')).cases;
  }catch(error){if(error.code==='ENOENT')continue;throw error;}
  let frameCount=0,both=0,any=0,processingMs=0,attempts=0,recovered=0,errors=0;
  for(const clip of pixels){
    frameCount+=clip.frames.length;both+=clip.frames.filter(f=>f.left&&f.right).length;any+=clip.frames.filter(f=>f.left||f.right).length;
    const stats=report.pixelCases.find(c=>c.id===clip.id).trackingDiagnostics;
    processingMs+=stats.processingMs;attempts+=stats.recoveryAttempts;recovered+=stats.recoveredHands;errors+=stats.recoveryErrors;
  }
  const models=[];
  for(const model of classifiers){
    const rows=pixels.filter(c=>c.scope==='word').map(c=>{
      const result=model.classify(c.frames);return{id:c.id,expected:c.expected,scenario:c.scenario,split:c.split,
        predicted:result.result.label,reason:result.result.reason,neural:result.neural};
    });
    models.push({name:model.name,sha256:model.sha256,
      nominal:summarize(rows.filter(c=>c.scenario==='nominal'&&c.split==='regression')),
      adverse:summarize(rows.filter(c=>c.scenario!=='nominal'&&c.split==='regression')),
      unknown:summarize(rows.filter(c=>c.split==='unknown_regression')),
      trainingReplay:summarize(rows.filter(c=>c.split==='train')),rows});
  }
  profiles.push({mode,runtime:report.runtime,
    quality:{frames:frameCount,anyHandPercent:100*any/frameCount,bothHandsPercent:100*both/frameCount,
      meanProcessingMs:processingMs/frameCount,recoveryAttempts:attempts,recoveredHands:recovered,recoveryErrors:errors},models});
}
const result={scope:'Development comparisons on identical existing-recording video scenarios. Different GPU runs may have small detector variance; tracking coverage is not annotated detection accuracy.',
  completedProfiles:profiles.map(p=>p.mode),profiles};
await writeFile(`${root}/comparison.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(profiles.map(({mode,quality,models})=>({mode,quality,models:models.map(({name,nominal,adverse,unknown})=>({name,nominal,adverse,unknown}))})),null,2));
