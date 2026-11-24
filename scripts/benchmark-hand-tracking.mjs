import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const run=(args,env)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,...env}});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Benchmark exited ${code}`)));
});
for(const mode of ['legacy','stable','recovery']){
  console.log(`Verifying ${mode} tracker on all91source video scenarios`);
  await run(['scripts/simulate-sign-camera.mjs','--skeletal','--pixels-only',`--tracking-mode=${mode}`],{
    LINGORA_SIMULATION_OUTPUT:resolve(`private-video-work/tracking-v2/${mode}`),LINGORA_QUIET_SIMULATION:'1',
    LINGORA_CLASSIFIER_PATH:resolve('private-video-work/training-expanded-v1/skeletal/candidate-model.json'),
    LINGORA_GALLERY_PATH:resolve('private-video-work/training-expanded-v1/baseline-model.json'),
    LINGORA_SIMULATION_MEDIA:resolve('private-video-work/training-expanded-v1/simulation'),
  });
}
await run(['scripts/evaluate-tracking-upgrade.mjs'],{});
