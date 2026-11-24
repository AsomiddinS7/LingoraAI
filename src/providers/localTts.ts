import type { Lang, TtsProvider } from '../types';
import { TtsError } from './tts';

interface Options { url?: string; fetcher?: typeof fetch; createAudio?: () => HTMLAudioElement; timeoutMs?: number }
/** Optional local neural Uzbek voice. Cancelling releases both inference and playback. */
export class LocalNeuralTts implements TtsProvider {
  private finish?: (error?: Error) => void;
  constructor(private options: Options = {}) {}

  speak(text: string, lang: Lang): Promise<void> {
    this.cancel();
    if (lang !== 'uz') return Promise.reject(new TtsError('no_voice'));
    if (!text.trim() || text.length > 300) return Promise.reject(new TtsError('failed'));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let closed = false, audio: HTMLAudioElement | undefined, objectUrl: string | undefined;
      const timer = setTimeout(() => finish(new TtsError('failed')), this.options.timeoutMs ?? 90000);
      const finish = (error?: Error) => {
        if (closed) return;
        closed = true; clearTimeout(timer); controller.abort();
        if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (this.finish === finish) this.finish = undefined;
        if (error) reject(error); else resolve();
      };
      this.finish = finish;
      void (async () => {
        try {
          const base = new URL(this.options.url ?? 'http://127.0.0.1:8792');
          if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
            throw new TtsError('failed');
          const response = await (this.options.fetcher ?? fetch)(new URL('/api/synthesize', base), {
            method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language: lang }),
          });
          if (closed) return;
          if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/wav')
            || Number(response.headers.get('content-length') ?? 0) > 2_200_000) throw new TtsError('failed');
          const blob = await response.blob();
          if (closed) return;
          if (blob.size < 44 || blob.size > 2_200_000) throw new TtsError('failed');
          audio = this.options.createAudio?.() ?? new Audio();
          objectUrl = URL.createObjectURL(blob); audio.src = objectUrl;
          audio.onended = () => finish(); audio.onerror = () => finish(new TtsError('failed'));
          await audio.play();
        } catch { if (!closed) finish(new TtsError('failed')); }
      })();
    });
  }
  cancel(): void { this.finish?.(); }
}
