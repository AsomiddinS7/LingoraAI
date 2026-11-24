// Real Gradio jobs and browser audio. Model/microphone responses are not stubbed.
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const space=process.env.LINGORA_SPEECH_SPACE_URL??'http://127.0.0.1:7860';
const site=process.env.LINGORA_TEST_URL??'http://127.0.0.1:5174';
const bundle=await build({entryPoints:['src/providers/huggingFaceSpeech.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const controller=new AbortController(),guard=setTimeout(()=>controller.abort(),90000);
const health=await api.callSpeechSpace(space,'health',null,controller.signal);clearTimeout(guard);
assert(health.ready,'Both speech models must be loaded');
const wav=resolve('tmp/stt/lesson-uzbek-0-18.wav');
const uz=JSON.parse(await readFile('src/i18n/uz.json','utf8'));
const browser=await chromium.launch({channel:'msedge',headless:true,args:[
 '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wav}%noloop`,
]});
try{
 const context=await browser.newContext({permissions:['microphone']});
 await context.addInitScript(()=>{
  window.__hostedAudio=[];const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){if(this instanceof HTMLAudioElement){const row={ended:false,duration:0};window.__hostedAudio.push(row);
   this.addEventListener('loadedmetadata',()=>{row.duration=this.duration;},{once:true});this.addEventListener('ended',()=>{row.ended=true;},{once:true});}
   return play.call(this);};
 });
 const page=await context.newPage(),errors=[],jobs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/gradio_api/call/'))jobs.push(r.url().split('/').at(-1));});
 await page.goto(site+'/#/conversation',{waitUntil:'networkidle'});
 await page.locator('#lang-select').selectOption('uz');
 await page.evaluate(async space=>{
  const{runtime}=await import('/src/runtime.ts');runtime.setConfig({sttProvider:'huggingface',ttsProvider:'huggingface',speechSpaceUrl:space});
 },space);
 await page.getByText(uz['message.writeInstead'],{exact:true}).click();
 await page.locator('#signer-message').fill('Assalomu alaykum. Menga yordam kerak.');
 await page.getByRole('button',{name:uz['message.review'],exact:true}).click();
 assert(!jobs.includes('synthesize'),'Text must be confirmed before synthesis');
 await page.getByRole('button',{name:uz['sentence.speak'],exact:true}).click();
 await page.waitForFunction(()=>window.__hostedAudio.some(r=>r.ended&&r.duration>1),undefined,{timeout:90000});
 const mic=page.locator('.composer .mic');await mic.click();
 const consent=page.getByRole('button',{name:'Tushundim',exact:true});if(await consent.isVisible())await consent.click();
 await page.waitForFunction(()=>document.querySelector('.composer .mic')?.getAttribute('aria-pressed')==='true');
 await page.waitForTimeout(12000);if(await mic.getAttribute('aria-pressed')==='true')await mic.click();
 await page.waitForFunction(()=>document.querySelectorAll('.msg-listener:not(.msg-live) .msg-text').length>0,undefined,{timeout:90000});
 const messages=await page.locator('.msg-listener:not(.msg-live) .msg-text').allTextContents();
 assert(messages.some(t=>t.trim()));assert(jobs.includes('transcribe'));assert(jobs.includes('synthesize'));assert.deepEqual(errors,[]);
 await mkdir('tmp/huggingface-check',{recursive:true});
 const report={url:space,realModelRequests:true,realAudioPlayback:true,input:'Existing WAV through virtual microphone; physical microphone untested',
  playback:await page.evaluate(()=>window.__hostedAudio),jobs,transcript:messages,errors};
 await writeFile('tmp/huggingface-check/results.json',JSON.stringify(report,null,2));
 await page.screenshot({path:'tmp/huggingface-check/conversation.png',fullPage:true});
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
