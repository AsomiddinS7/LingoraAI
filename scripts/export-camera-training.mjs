// Camera augmentation views remain grouped with their original TRAIN performance.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadMatcher} from './evaluate-motion.mjs';
import {auditSplits} from './export-training-data.mjs';
import {motionSpan} from '../src/ml/motionGate.mjs';
import {createHybridClassifier} from './hybrid-sign-inference.mjs';
import {parseSkeletalCandidate,inferSkeletalCandidate} from './skeletal-inference.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const root='private-video-work/training-expanded-v2/camera';
const prior='private-video-work/training-expanded-v1';
const matcher=await loadMatcher();
const oldData=await read(`${prior}/normalized-words.json`),raw=await read(`${prior}/experiment-raw.json`);
const originals=new Map(raw.samples.map(s=>[s.id,s]));
const captured=await read('private-video-work/tracking-v2/training-features/tracked-pixels.json');
const captureReport=await read('private-video-work/tracking-v2/training-features/results.json');
if(!captureReport.finishedAt||!captureReport.runtime.sharedTrackerVerified)throw new Error('Training capture is incomplete/unverified');
const oldGallery=matcher.parseMotionModel(await readFile(`${prior}/baseline-model.json`,'utf8'));
const oldClassifier=parseSkeletalCandidate(await readFile(`${prior}/skeletal/candidate-model.json`,'utf8'));
const previous=createHybridClassifier(matcher,oldGallery,oldClassifier,inferSkeletalCandidate);
const templates=[],examples=[],rawSamples=[],quarantine=[];
function add(clip,split){
  const original=originals.get(clip.sampleId);
  if(!original||original.label!==clip.expected)throw new Error(`Missing reviewed label: ${clip.id}`);
  if(split==='train'&&original.split!=='train')throw new Error('Evaluation performance entered training');
  const normalized=matcher.normalizeSequence(clip.frames);
  if(split==='train'){
    const base=oldData.examples.find(e=>e.id===original.id);
    if(!normalized||normalized.reference!=='body'||motionSpan(normalized)<motionSpan(base)*.5){
      quarantine.push({id:clip.id,reason:'insufficient_tracking_or_movement',baseReferenceId:original.id});return;
    }
  }
  const shape=normalized??{vectors:Array.from({length:32},()=>new Array(128).fill(0)),reference:'body',durationMs:clip.durationSeconds*1000,handCoverage:0};
  const template={id:clip.id,label:original.label,frames:clip.frames,source:{kind:'other',name:clip.file,permission:'Existing reviewed source; private camera-augmentation training only'}};
  if(split==='train')templates.push(template);
  const m=original.metadata;
  examples.push({id:clip.id,label:original.label,label_uz:m.labelUz,split,source_key:m.recordingId,source_sha256:m.recordingSha256,
    session_key:m.sessionId,source_start_ms:clip.sourceWindowSeconds[0]*1000,source_end_ms:clip.sourceWindowSeconds[1]*1000,
    base_reference_id:original.id,augmentation_kind:clip.scenario,geometry_sha256:hash(JSON.stringify(clip.frames.map(({t:_t,...points})=>points))),
    ...shape,normalizationFailed:!normalized,baseline:previous(clip.frames).result});
  rawSamples.push({...template,split,metadata:m});
}
for(const clip of captured.cases)add(clip,'train');
const testCapture=await read('private-video-work/tracking-v2/stable/tracked-pixels.json');
for(const clip of testCapture.cases.filter(c=>c.scope==='word'&&c.scenario==='nominal'&&['regression','unknown_regression'].includes(c.split)))add(clip,clip.split);
const labels=[...new Set(templates.map(t=>t.label))].sort();
const realPerformances=new Set(examples.filter(e=>e.split==='train').map(e=>e.base_reference_id)).size;
if(JSON.stringify(labels)!==JSON.stringify(oldData.labels))throw new Error('Camera capture lacks at least one of the40labels');
const audit=auditSplits(examples);
if(audit.retained_window_overlaps.length||audit.cross_split_geometry_duplicates.length)throw new Error('Camera experiment split leakage');
const result={format:'lingora-normalized-training-v1',feature_version:'two-hand-body-v2',frames:32,features:128,labels,
  provenance:{base_real_training_performances:realPerformances,supplied_real_training_performances:43,training_camera_views:templates.length,
    tracker_profile:captureReport.runtime.trackingProfile,training_and_test_tracking_differ:true,
    scope:'Camera views of original TRAIN performances only. Same-recording second takes remain evaluation, never training. Development regression, not independent-signer testing.',
    source_policy:'Synthetic camera views share base_reference_id and source intervals; they are not extra real performances. No heldout pixels or landmarks are fitted.'},split_audit:audit,examples};
const matching={profile:'visibility-aware-dtw-v1',labels,templateIds:templates.map(t=>t.id).sort()};
await mkdir(root,{recursive:true});
await writeFile(`${root}/normalized-words.json`,JSON.stringify(result));
await writeFile(`${root}/experiment-raw.json`,JSON.stringify({format:'lingora-experiment-raw-v1',samples:rawSamples}));
await writeFile(`${root}/baseline-model.json`,JSON.stringify(matcher.compileTemplateDataset(templates,matching)));
await writeFile(`${root}/capture-audit.json`,JSON.stringify({quarantine,trainingViews:templates.length,realPerformances,regression:examples.filter(e=>e.split==='regression').length,unknown:examples.filter(e=>e.split==='unknown_regression').length,audit},null,2));
console.log(JSON.stringify({root,labels:labels.length,trainingViews:templates.length,quarantine:quarantine.length,examples:examples.length}));
