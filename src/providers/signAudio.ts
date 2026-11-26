import type { Lang, TtsProvider } from '../types';
import { TtsError } from './tts';

const clips: Record<string, string> = { salom: 'hello', xayr: 'goodbye', iltimos: 'please' };

/** Exact Uzbek trial words can be spoken even when the hosted quota is exhausted. */
export class SignAudioTts implements TtsProvider {
  private finish?: (error?: Error) => void;
  constructor(private readonly fallback: TtsProvider) {}

  speak(text: string, language: Lang): Promise<void> {
    this.cancel();
    const clip = language === 'uz' ? clips[text.trim().toLocaleLowerCase('uz').replace(/[.!?]+$/u, '')] : undefined;
    if (!clip) return this.fallback.speak(text, language);
    return new Promise((resolve, reject) => {
      const audio = new Audio(`${import.meta.env.BASE_URL}audio/signs/${clip}.wav`);
      let closed = false;
      const finish = (error?: Error) => {
        if (closed) return;
        closed = true; audio.onended = audio.onerror = null; audio.pause();
        if (this.finish === finish) this.finish = undefined;
        if (error) reject(error); else resolve();
      };
      this.finish = finish;
      audio.onended = () => finish();
      audio.onerror = () => finish(new TtsError('failed'));
      void audio.play().catch(() => finish(new TtsError('failed')));
    });
  }
  cancel(): void { this.finish?.(); this.fallback.cancel(); }
}
