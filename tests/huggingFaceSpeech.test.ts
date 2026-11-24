import {describe,expect,it,vi} from 'vitest';
import {callSpeechSpace,createSpaceFetch,speechSpaceUrl} from '../src/providers/huggingFaceSpeech';
import {configFromEnv} from '../src/config';
import {getStt,getTts} from '../src/providers';
const base='https://asomiddinsaidov07-lingora-speech.hf.space';
function result(data:unknown){
 const text=`event: heartbeat\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([data])}\n\n`;
 const bytes=new TextEncoder().encode(text);
 return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
}
describe('Hugging Face queued speech transport',()=>{
 it('keeps the application usable when a Space has not been configured',()=>{
  const config={...configFromEnv({}),sttProvider:'huggingface' as const,ttsProvider:'huggingface' as const,speechSpaceUrl:''};
  expect(getStt(config)).toEqual({kind:'typed',notice:'speech.huggingFaceMissing'});
  expect(getTts(config).notice).toBe('speech.huggingFaceMissing');
 });
 it('handles split stream frames and heartbeats without credentials or transcript substitution',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({event_id:'job_1'}))
   .mockResolvedValueOnce(result({text:'Menga yordam kerak.',language:'uz'}));
  const controller=new AbortController();
  expect(await callSpeechSpace(base,'transcribe',{audio_base64:'aA=='},controller.signal,fetcher)).toMatchObject({text:'Menga yordam kerak.'});
  expect(fetcher.mock.calls[1][0]).toBe(base+'/gradio_api/call/transcribe/job_1');
  for(const call of fetcher.mock.calls)expect(call[1]).toMatchObject({credentials:'omit',cache:'no-store',signal:controller.signal});
 });
 it('rejects unsafe URLs, invalid job IDs and missing completion',async()=>{
  for(const url of ['http://speech.example','https://user:secret@speech.example','https://speech.example/?token=x'])expect(()=>speechSpaceUrl(url)).toThrow();
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({event_id:'../../secret'}));
  await expect(callSpeechSpace(base,'health',null,undefined,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockResolvedValueOnce(Response.json({event_id:'ok'})).mockResolvedValueOnce(new Response('event: heartbeat\ndata: null\n\n'));
  await expect(callSpeechSpace(base,'health',null,undefined,fetcher)).rejects.toThrow('without a result');
 });
 it('surfaces quota errors and prevents submissions after cancellation',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({event_id:'ok'}))
   .mockResolvedValueOnce(new Response('event: error\ndata: "quota"\n\n'));
  await expect(callSpeechSpace(base,'synthesize',{},undefined,fetcher)).rejects.toThrow('quota');
  const controller=new AbortController();controller.abort();fetcher.mockClear();
  await expect(callSpeechSpace(base,'transcribe',{},controller.signal,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
 it('encodes actual capture bytes and returns the model transcript',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({event_id:'audio'}))
   .mockResolvedValueOnce(result({text:'Salom.',language:'uz'}));
  const adapted=createSpaceFetch(base,fetcher);
  const response=await adapted(base+'/api/transcribe?language=uz',{body:new Blob(['real bytes'],{type:'audio/webm;codecs=opus'})});
  expect(await response.json()).toMatchObject({text:'Salom.'});
  const submitted=JSON.parse(fetcher.mock.calls[0][1]?.body as string).data[0];
  expect(atob(submitted.audio_base64)).toBe('real bytes');expect(submitted.mime_type).toBe('audio/webm');
 });
 it('decodes returned WAV data without fetching arbitrary output URLs',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({event_id:'voice'}))
   .mockResolvedValueOnce(result({audio_base64:btoa('RIFF'+'x'.repeat(50)),mime_type:'audio/wav'}));
  const response=await createSpaceFetch(base,fetcher)(base+'/api/synthesize',{body:JSON.stringify({text:'Salom.',language:'uz'})});
  expect(response.headers.get('Content-Type')).toBe('audio/wav');expect(await response.text()).toBe('RIFF'+'x'.repeat(50));
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
