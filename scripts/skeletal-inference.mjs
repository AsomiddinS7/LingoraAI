// Browser-portable learned classifier; real unseen-signer accuracy is unestablished.
import { motionSpan } from '../src/ml/motionGate.mjs';
const finite = x => typeof x === 'number' && Number.isFinite(x);
export function skeletalMotionSpan(input) {
  return motionSpan(input);
}
export function activityVectors(input) {
  const vectors = input.vectors, energy = new Array(32).fill(0);
  for (const offset of [0,64]) {
    const observed=vectors.map((v,i)=>v[offset]?i:-1).filter(i=>i>=0);
    if(observed.length<2)continue;
    const first=vectors[observed[0]],last=vectors[observed.at(-1)];
    for(let t=0;t<32;t++)if(vectors[t][offset]){
      let sum=0;
      for(let j=0;j<21;j++)for(let k=0;k<2;k++){
        const index=offset+1+3*j+k,d=vectors[t][index]-(first[index]+last[index])/2;sum+=d*d;
      }
      energy[t]=Math.max(energy[t],Math.sqrt(sum/42));
    }
  }
  const peak=Math.max(...energy),indices=energy.map((e,i)=>e>=peak*.2?i:-1).filter(i=>i>=0);
  const start=peak>1e-8?Math.min(8,Math.max(0,indices[0]-1)):0;
  const end=peak>1e-8?Math.max(23,Math.min(31,indices.at(-1)+1)):31;
  return Array.from({length:32},(_,i)=>{
    const time=start+(end-start)*i/31,low=Math.floor(time),high=Math.min(31,low+1),alpha=time-low,out=[];
    for(const offset of [0,64]){
      const a=vectors[low].slice(offset,offset+64),b=vectors[high].slice(offset,offset+64);
      out.push(...(a[0]&&b[0]?a.map((v,k)=>k?v*(1-alpha)+b[k]*alpha:1):alpha<.5?a:b));
    }
    return out;
  });
}
export function skeletalDescriptor(input, active = false) {
  const vectors = input.vectors;
  if (!Array.isArray(vectors) || vectors.length !== 32 || vectors.some(v => !Array.isArray(v) || v.length !== 128 || v.some(x => !finite(x))))
    throw new Error('Invalid skeletal input');
  const frames = vectors.map(v => {
    const f = new Array(128).fill(0);
    for (const offset of [0, 64]) {
      if (![0, 1].includes(v[offset])) throw new Error('Invalid hand presence');
      if (!v[offset]) continue;
      const wrist = v.slice(offset + 1, offset + 4);
      const palm = Math.max(.04, [5, 9, 17].map(j => Math.hypot(...wrist.map((w, k) => v[offset + 1 + j * 3 + k] - w))).sort((a,b) => a-b)[1]);
      f[offset] = 1;
      for (let k = 0; k < 3; k++) f[offset + 1 + k] = wrist[k];
      for (let j = 1; j < 21; j++) for (let k = 0; k < 3; k++)
        f[offset + 4 + (j - 1) * 3 + k] = (v[offset + 1 + j * 3 + k] - wrist[k]) / palm;
    }
    return f;
  });
  const out = [];
  for (const [start, end, variance] of [[0,32,false],[0,32,true],[0,8,false],[8,16,false],[16,24,false],[24,32,false]]) {
    for (const offset of [0, 64]) {
      const count = frames.slice(start, end).reduce((sum, f) => sum + f[offset], 0);
      const ratio = count / (end - start);
      out.push(variance ? Math.sqrt(ratio * (1-ratio)) : ratio);
      for (let k = 1; k < 64; k++) {
        let sum = 0, squared = 0;
        for (let t = start; t < end; t++) { const value = frames[t][offset + k]; sum += value; squared += value * value; }
        const mean = sum / Math.max(count, 1);
        out.push(variance ? Math.sqrt(Math.max(0, squared / Math.max(count, 1) - mean * mean)) : mean);
      }
    }
  }
  return active ? out.concat(skeletalDescriptor({...input,vectors:activityVectors(input)})) : out;
}

export function parseSkeletalCandidate(text) {
  if (typeof text !== 'string' || text.length > 3_000_000) throw new Error('Skeletal model too large');
  const m = JSON.parse(text);
  if (m.format !== 'lingora-skeletal-ridge-v1' || m.feature_version !== 'two-hand-body-v2'
    || !['palm-local-shape-body-wrist-six-pools-v1','palm-local-shape-body-wrist-activity-v2'].includes(m.descriptor)
    || !Array.isArray(m.classes) || m.classes.length < 2 || m.classes.length > 128 || new Set(m.classes).size !== m.classes.length
    || m.classes.some(s => typeof s !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(s) || s === 'none')) throw new Error('Invalid skeletal model');
  const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(x => finite(x) && Math.abs(x) <= 10000);
  const dimensions = m.descriptor.endsWith('activity-v2') ? 1536 : 768;
  if (!vector(m.mean, dimensions) || !vector(m.scale, dimensions) || m.scale.some(x => x < .1)
    || !vector(m.bias, m.classes.length) || !Array.isArray(m.weight) || m.weight.length !== dimensions
    || m.weight.some(row => !vector(row, m.classes.length)) || !finite(m.minimum_score) || m.minimum_score < 0
    || !finite(m.minimum_margin) || m.minimum_margin < 0) throw new Error('Invalid skeletal weights/calibration');
  if (m.motion_gate !== undefined && (m.motion_gate.profile !== 'body-centroid-q10-q90-v1'
    || !finite(m.motion_gate.minimum_span) || m.motion_gate.minimum_span < 0 || m.motion_gate.minimum_span > 10))
    throw new Error('Invalid motion calibration');
  return m;
}

export function inferSkeletalCandidate(input, model) {
  if (!finite(input.handCoverage) || input.handCoverage < 0 || input.handCoverage > 1) throw new Error('Invalid tracking coverage');
  const features = skeletalDescriptor(input,model.descriptor.endsWith('activity-v2'));
  const presence = input.vectors.filter(v => v[0] || v[64]).length / 32;
  if (input.reference !== 'body' || !finite(input.handCoverage) || input.handCoverage < .65 || presence < .65)
    return { label: 'none', nearest_label: null, accepted: false, score: 0, margin: 0, reason: 'insufficient_tracking' };
  const scores = model.bias.slice();
  for (let j = 0; j < features.length; j++) {
    const value = (features[j] - model.mean[j]) / model.scale[j];
    for (let k = 0; k < scores.length; k++) scores[k] += value * model.weight[j][k];
  }
  const ranked = scores.map((score, index) => ({ score, index })).sort((a,b) => b.score - a.score);
  const score = ranked[0].score, margin = score - ranked[1].score;
  const motionSpan = skeletalMotionSpan(input);
  const moving = !model.motion_gate || motionSpan >= model.motion_gate.minimum_span;
  const accepted = moving && score >= model.minimum_score && margin >= model.minimum_margin;
  return { label: accepted ? model.classes[ranked[0].index] : 'none', nearest_label: model.classes[ranked[0].index],
    accepted, score, margin, motionSpan, distance: Math.max(0, 1-score), reason: !moving ? 'insufficient_motion' : accepted ? 'matched' : 'rejected' };
}
