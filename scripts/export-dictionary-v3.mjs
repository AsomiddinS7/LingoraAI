// Only first repetitions and their camera views enter training.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {loadMatcher} from './evaluate-motion.mjs';
import {auditSplits} from './export-training-data.mjs';
const root='private-video-work/training-expanded-v3';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const matcher=await loadMatcher();
const data=await read('private-video-work/training-expanded-v2/camera/normalized-words.json');
const previous=matcher.parseMotionModel(await readFile('private-video-work/training-expanded-v2/camera/baseline-model.json','utf8'));
const captured=await read('private-video-work/dataset-v3/features/tracked-pixels.json');
const runtime=await read('private-video-work/dataset-v3/features/results.json');
const review=await read('private-video-work/dataset-v3/reviewed-windows.json');
if(!runtime.finishedAt||!runtime.runtime.sharedTrackerVerified||runtime.runtime.trackingProfile!=='hands-pose-recovery-video-v2')throw Error('Unverified tracker capture');
const examples=[...data.examples],templates=[...previous.templates];
const seen=new Set(examples.map(e=>e.source_sha256));
const windows=new Map(review.examples.map(e=>[e.id,e]));
for(const clip of captured.cases){
 if(clip.split!=='train'&&clip.scenario!=='nominal')continue; // one record per reserved performance
 const source=windows.get(clip.sampleId);
 if(!source||source.label!==clip.expected||source.role!==clip.split||seen.has(source.source_sha256))throw Error('New source/label contract mismatch');
 const normalized=matcher.normalizeSequence(clip.frames);
 if(!normalized||normalized.reference!=='body'||normalized.handCoverage<.65)throw Error(`Insufficient new tracking: ${clip.id}`);
 examples.push({id:clip.id,label:source.label,label_uz:source.labelUz,split:source.role,
  source_key:source.recordingId,source_sha256:source.source_sha256,session_key:source.sessionId,
  source_start_ms:source.source_start_s*1000,source_end_ms:source.source_end_s*1000,
  base_reference_id:source.id,augmentation_kind:clip.scenario,
  geometry_sha256:hash(JSON.stringify(clip.frames.map(({t:_t,...points})=>points))),...normalized});
 if(source.role==='train')templates.push({id:clip.id,label:source.label,normalized});
}
const labels=[...new Set(templates.map(t=>t.label))].sort();
if(labels.length!==48||templates.length!==101)throw Error('Incomplete expanded dictionary');
const audit=auditSplits(examples);
if(audit.retained_window_overlaps.length||audit.cross_split_geometry_duplicates.length)throw Error('Dataset split leakage');
const out={...data,labels,examples,split_audit:audit,provenance:{...data.provenance,
 base_real_training_performances:51,training_camera_views:101,added_source_recordings:8,
 scope:'First takes only in fitting. Second takes and their camera views remain correlated development evaluation. Semantic specialist/new-signer validation pending.'}};
await mkdir(root,{recursive:true});
try{await readFile(`${root}/previous-public-model.json`);}catch(error){
 if(error.code!=='ENOENT')throw error;
 const baseline=execFileSync('git',['show','1b7d88ef25a326b15ef5011af50d3e91e29a1f39:public/model/trained-sign-model.json'],{maxBuffer:20_000_000});
 if(JSON.parse(baseline).classifier.classes.length!==40)throw Error('Wrong prior release baseline');
 await writeFile(`${root}/previous-public-model.json`,baseline,{flag:'wx'});
}
await writeFile(`${root}/normalized-words.json`,JSON.stringify(out));
await writeFile(`${root}/baseline-model.json`,JSON.stringify({...previous,templates,
 matching:{profile:'visibility-aware-dtw-v1',labels,templateIds:templates.map(t=>t.id).sort()}}));
await writeFile(`${root}/capture-audit.json`,JSON.stringify({labels:48,trainingViews:101,realTrainingPerformances:51,
 newSources:8,newReservedRepetitions:8,splitAudit:audit},null,2));
console.log(JSON.stringify({labels:labels.length,templates:templates.length,examples:examples.length,splitAudit:audit}));
