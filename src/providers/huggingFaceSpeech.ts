import { LocalWhisperStt, type LocalSttOptions } from './localStt';
import { LocalNeuralTts } from './localTts';
import { SignAudioTts } from './signAudio';

const MAX_AUDIO=10*1024*1024;
function base64(bytes: Uint8Array): string {
  let text='';
  for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
}
function decode(text: string): Uint8Array {
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||text.length>3_000_000)throw Error('Invalid voice response');
  return Uint8Array.from(atob(text),c=>c.charCodeAt(0));
}

export function speechSpaceUrl(value: string): string {
  const url=new URL(value);
  const local=['127.0.0.1','localhost'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.search||url.hash
    ||!['','/'].includes(url.pathname))throw Error('Use the public Space app URL');
  return url.origin;
}

export async function callSpeechSpace(base: string, name: string, payload: unknown,
  signal?: AbortSignal, fetcher: typeof fetch=fetch): Promise<Record<string, unknown>> {
  const url=speechSpaceUrl(base);
  if(!['health','transcribe','synthesize'].includes(name))throw Error('Unsupported speech endpoint');
  signal?.throwIfAborted();
  const job=await fetcher(`${url}/gradio_api/call/${name}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:name==='health'?[]:[payload]}),
    credentials:'omit',cache:'no-store',signal,
  });
  const jobText=await job.text();
  if(!job.ok||jobText.length>16384)throw Error('Speech server is unavailable or busy');
  const event: unknown=JSON.parse(jobText);
  if(!event||typeof event!=='object'||!('event_id'in event)||typeof event.event_id!=='string'
    ||!/^[A-Za-z0-9_-]{1,128}$/.test(event.event_id))throw Error('Invalid speech job');
  const response=await fetcher(`${url}/gradio_api/call/${name}/${event.event_id}`,{credentials:'omit',cache:'no-store',signal});
  if(!response.ok||!response.body)throw Error('Speech job is unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(value){size+=value.length;if(size>4_500_000)throw Error('Speech result exceeds size limit');buffer+=decoder.decode(value,{stream:true}).replace(/\r/g,'');}
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const kind=block.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();
        const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
        if(kind==='error')throw Error('Speech quota exceeded or processing failed');
        if(kind==='complete'){
          const result: unknown=JSON.parse(data);
          if(!Array.isArray(result)||result.length!==1||!result[0]||typeof result[0]!=='object'||Array.isArray(result[0]))throw Error('Invalid speech response');
          return result[0] as Record<string,unknown>;
        }
      }
      if(done)throw Error('Speech job ended without a result');
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Adapts official Gradio jobs to the existing capture/playback lifecycle. */
export function createSpaceFetch(url: string, fetcher: typeof fetch=fetch): typeof fetch {
  return async(input,init)=>{
    const endpoint=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(endpoint.pathname==='/api/transcribe'){
      const audio=init?.body;
      if(!(audio instanceof Blob)||audio.size>MAX_AUDIO)throw Error('Invalid recording upload');
      const bytes=new Uint8Array(await audio.arrayBuffer());init?.signal?.throwIfAborted();
      const result=await callSpeechSpace(url,'transcribe',{audio_base64:base64(bytes),
        mime_type:audio.type.split(';')[0],language:endpoint.searchParams.get('language')??'uz'},init?.signal??undefined,fetcher);
      return Response.json(result,{status:typeof result.status==='number'?result.status:200});
    }
    if(endpoint.pathname==='/api/synthesize'){
      if(typeof init?.body!=='string'||init.body.length>5000)throw Error('Invalid voice request');
      const result=await callSpeechSpace(url,'synthesize',JSON.parse(init.body),init.signal??undefined,fetcher);
      if(typeof result.audio_base64!=='string'||result.mime_type!=='audio/wav')return Response.json(result,{status:400});
      const bytes=decode(result.audio_base64);
      return new Response(new Blob([bytes.buffer as ArrayBuffer],{type:'audio/wav'}),{headers:{'Content-Type':'audio/wav'}});
    }
    throw Error('Unsupported speech operation');
  };
}

export function createHuggingFaceSpeech(url: string, options: {
  onStatus?: LocalSttOptions['onStatus'];
  onError?: (error: Error)=>void;
}={}) {
  const base=speechSpaceUrl(url),fetcher=createSpaceFetch(base);
  return {stt:new LocalWhisperStt({url:base,fetcher,...options,serviceKind:'hosted',timeoutMs:180000}),
    tts:new SignAudioTts(new LocalNeuralTts({url:base,fetcher,timeoutMs:180000}))};
}
