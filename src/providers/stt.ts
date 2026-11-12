// SttProvider implementations. Typed input is the real Plan B path and needs no provider.
// The team plugs the Azure Speech provider in through registerProvider('stt', ...).
import type { Lang, SttProvider } from '../types';

/** Canned transcript for the mock (brief section 9). */
export const CANNED_TRANSCRIPT: Record<Lang, string> = {
  uz: '[PLACEHOLDER] Kelganingiz uchun rahmat. Oldingi ishingiz haqida gapirib bera olasizmi?',
  ru: '[PLACEHOLDER] Спасибо, что пришли. Расскажите, пожалуйста, о вашей прошлой работе?',
  en: '[PLACEHOLDER] Thank you for coming. Can you tell me about your last job?',
};

/** Mock push-to-talk: shows the canned transcript word by word. Never touches the microphone. */
export class MockStt implements SttProvider {
  private timer: ReturnType<typeof setInterval> | null = null;
  private onText: ((t: string, final: boolean) => void) | null = null;
  private words: string[] = [];
  private shown = 0;

  constructor(private wordMs = 220) {}

  async start(lang: Lang, onText: (t: string, final: boolean) => void): Promise<void> {
    await this.stop(true);
    this.onText = onText;
    this.words = CANNED_TRANSCRIPT[lang].split(' ');
    this.shown = 0;
    this.timer = setInterval(() => {
      if (this.shown < this.words.length) {
        this.shown++;
        onText(this.words.slice(0, this.shown).join(' '), false);
      }
    }, this.wordMs);
  }

  async stop(silent = false): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const cb = this.onText;
    this.onText = null;
    // Mock: releasing the button finalises the whole canned sentence.
    if (!silent && cb && this.words.length) cb(this.words.join(' '), true);
  }
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const LOCALES: Record<Lang, string> = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };

/**
 * Experimental (Plan B option): the browser's Web Speech API. Some browsers send audio to their
 * vendor's speech service, so the UI shows a warning whenever this provider is active.
 */
export class BrowserSpeechStt implements SttProvider {
  private rec: SpeechRecognitionLike | null = null;
  private text = '';
  private onText: ((t: string, final: boolean) => void) | null = null;

  static isSupported(): boolean {
    return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }

  async start(lang: Lang, onText: (t: string, final: boolean) => void): Promise<void> {
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) throw new Error('SpeechRecognition not supported');
    this.text = '';
    this.onText = onText;
    const rec = new Ctor();
    rec.lang = LOCALES[lang];
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.text = (finalText + interim).trim();
      onText(this.text, false);
    };
    rec.onerror = () => {
      /* surfaced through an empty final on stop */
    };
    this.rec = rec;
    rec.start();
  }

  async stop(): Promise<void> {
    const rec = this.rec;
    const cb = this.onText;
    this.rec = null;
    this.onText = null;
    if (!rec) return;
    await new Promise<void>((resolve) => {
      rec.onend = () => resolve();
      rec.stop();
      setTimeout(resolve, 1500);
    });
    cb?.(this.text, true);
  }
}
