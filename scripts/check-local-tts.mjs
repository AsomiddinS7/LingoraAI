// Real local synthesis and native browser playback. No speech/audio mocks.
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.LINGORA_TEST_URL??'http://127.0.0.1:5174';
const uz=JSON.parse(await readFile('src/i18n/uz.json','utf8'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();const errors=[];const responses=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/synthesize'))responses.push({status:r.status(),type:r.headers()['content-type']});});
 await page.addInitScript(()=>{
  window.__voicePlayback=[];
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){
   if(this instanceof HTMLAudioElement){const entry={ended:false,duration:0};window.__voicePlayback.push(entry);
    this.addEventListener('loadedmetadata',()=>{entry.duration=this.duration;},{once:true});
    this.addEventListener('ended',()=>{entry.ended=true;},{once:true});}
   return play.call(this);
  };
 });
 await page.goto(base+'/#/console',{waitUntil:'networkidle'});
 await page.locator('#lang-select').selectOption('uz');await page.locator('#sw-ttsProvider').selectOption('local-tts');
 await page.evaluate(()=>{location.hash='/conversation';});
 await page.getByText(uz['message.writeInstead'],{exact:true}).click();
 await page.locator('#signer-message').fill('Assalomu alaykum. Menga yordam kerak.');
 await page.getByRole('button',{name:uz['message.review'],exact:true}).click();
 assert.equal(responses.length,0,'Voice must wait for confirmation');
 await page.getByRole('button',{name:uz['sentence.speak'],exact:true}).click();
 await page.waitForFunction(()=>window.__voicePlayback.some(x=>x.ended&&x.duration>1),undefined,{timeout:30000});
 assert.deepEqual(responses,[{status:200,type:'audio/wav'}]);assert.deepEqual(errors,[]);
 const result={realSynthesis:true,realNativeAudioPlayback:true,confirmationRequired:true,
  playback:await page.evaluate(()=>window.__voicePlayback),responses,errors};
 await mkdir('tmp/voice-v3',{recursive:true});await page.screenshot({path:'tmp/voice-v3/local-tts.png',fullPage:true});
 await writeFile('tmp/voice-v3/local-tts.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
