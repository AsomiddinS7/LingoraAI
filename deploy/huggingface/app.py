"""Lingora's Gradio speech Space. Public APIs follow the Gradio queue protocol."""
import os
from pathlib import Path
import sys

# Import Spaces before PyTorch so ZeroGPU can install its device hooks.
import spaces
import gradio as gr

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'runtime'))
from download_tts import download as download_voice
from nvidia_ctc import cached_model_directory
from server import NvidiaCtcEngine, SpeechError
from tiny_tts import TinyVocaEngine
from space_api import SpeechSpaceApi

def build_demo(api):
    def safe_call(fn,payload):
        try:
            return fn(payload)
        except SpeechError as error:
            return {'error':str(error),'code':error.code,'status':error.status}
        except Exception:
            # Model/runtime exception details may include private input paths.
            return {'error':'Speech processing failed. Please retry.','code':'speech_failed','status':500}

    def transcribe(payload):
        return safe_call(api.transcribe,payload)

    @spaces.GPU(duration=15)
    def synthesize(payload):
        return safe_call(api.synthesize,payload)

    with gr.Blocks(analytics_enabled=False) as demo:
        gr.Markdown('# Lingora Uzbek speech\nSpeech backend for the Lingora website. '
                    'Recognition supports Uzbek; the voice is synthetic. '
                    'Free ZeroGPU requests may queue or hit daily quotas. '
                    'Requests/results are temporarily handled by Gradio; do not send sensitive recordings.')
        status=gr.JSON(label='Model readiness')
        demo.load(api.health,outputs=status,api_name='health')
        with gr.Tab('Speech to text API'):
            recording=gr.JSON(label='Encoded recording request')
            transcript=gr.JSON(label='Transcript response')
            gr.Button('Transcribe').click(transcribe,inputs=recording,outputs=transcript,api_name='transcribe',
                                          concurrency_limit=1,concurrency_id='stt')
        with gr.Tab('Text to speech API'):
            text=gr.JSON(value={'text':'Assalomu alaykum.','language':'uz'},label='Confirmed text request')
            voice=gr.JSON(label='Encoded WAV response')
            gr.Button('Synthesize').click(synthesize,inputs=text,outputs=voice,api_name='synthesize',
                                          concurrency_limit=1,concurrency_id='tts')
    return demo.queue(max_size=8,default_concurrency_limit=1)

def main():
    voice_directory=Path(os.getenv('LINGORA_VOICE_DIR',str(Path.home()/'.cache/lingora/tiny-voca')))
    download_voice(voice_directory)
    stt=NvidiaCtcEngine(cached_model_directory())
    zero=os.getenv('SPACES_ZERO_GPU','').lower() in {'1','true','t'}
    tts=TinyVocaEngine(voice_directory,device='cuda' if zero else 'cpu')
    # Place CUDA weights at module startup, as required by ZeroGPU.
    stt.load();tts.load()
    demo=build_demo(SpeechSpaceApi(stt,tts))
    demo.launch(server_name='0.0.0.0',server_port=int(os.getenv('PORT','7860')),
                show_error=False,max_file_size='10mb')

if __name__=='__main__':main()
