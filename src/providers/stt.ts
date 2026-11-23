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
  onstart?: (() => void) | null;
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
}

const LOCALES: Record<Lang, string> = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };

/**
 * Experimental (Plan B option): the browser's Web Speech API. Some browsers send audio to their
 * vendor's speech service, so the UI shows a warning whenever this provider is active.
 */
export class BrowserSpeechStt implements SttProvider {
  private epoch = 0;
  private session: {
    rec: SpeechRecognitionLike;
    text: string;
    close: (emitFinal: boolean) => void;
    stop: () => Promise<void>;
  } | null = null;
  /** Most recent native failure, retained for diagnostics without transcript logging. */
  lastError: BrowserSpeechError | null = null;
  constructor(private onFailure?: (error: BrowserSpeechError) => void) {}

  static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as Record<string, unknown>;
    return typeof w.SpeechRecognition === 'function' || typeof w.webkitSpeechRecognition === 'function';
  }

  async start(lang: Lang, onText: (t: string, final: boolean) => void): Promise<void> {
    const epoch = ++this.epoch;
    // A superseded turn must not emit its transcript into the newly opened turn.
    this.session?.close(false);
    this.lastError = null;
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (typeof Ctor !== 'function') throw new BrowserSpeechError('unsupported');
    const rec = new Ctor();
    rec.lang = LOCALES[lang];
    rec.interimResults = true;
    rec.continuous = true;
    let closed = false;
    let finished = false;
    let stopping: Promise<void> | null = null;
    let endStop: (() => void) | null = null;
    let audioStream: MediaStream | null = null;
    const isCurrent = () => !closed && this.session === session;
    const startTimer = setTimeout(() => fail('timeout'), 10000);
    const close = (emitFinal: boolean) => {
      if (closed) return;
      closed = true;
      clearTimeout(startTimer);
      rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
      audioStream?.getTracks().forEach((track) => track.stop());
      audioStream = null;
      if (this.session === session) this.session = null;
      try { rec.stop(); } catch { /* Native service may already have ended. */ }
      if (emitFinal && !finished) { finished = true; onText(session.text, true); }
      endStop?.();
    };
    const fail = (code: string) => {
      if (!isCurrent()) return;
      this.lastError = new BrowserSpeechError(code);
      close(false);
      this.onFailure?.(this.lastError);
    };
    const session = {
      rec, text: '', close,
      stop: () => {
        if (stopping) return stopping;
        stopping = new Promise<void>((resolve) => {
          const timer = setTimeout(() => close(true), 1500);
          endStop = () => { clearTimeout(timer); resolve(); };
          try { rec.stop(); } catch { close(true); }
        });
        return stopping;
      },
    };
    this.session = session;
    rec.onstart = () => clearTimeout(startTimer);
    rec.onresult = (e) => {
      if (!isCurrent()) return;
      clearTimeout(startTimer);
      const chunks: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript?.trim();
        if (text) chunks.push(text);
      }
      session.text = chunks.join(' ');
      onText(session.text, false);
    };
    rec.onerror = (event) => fail(event.error);
    rec.onend = () => {
      if (isCurrent()) close(true);
    };
    try {
      // Chromium 135+ accepts a captured audio track. Owning that stream makes
      // microphone selection and release explicit, including on navigation.
      const chromiumVersion = typeof navigator !== 'undefined'
        ? Number(/(?:Chrome|Edg)\/(\d+)/.exec(navigator.userAgent)?.[1] ?? 0) : 0;
      if (chromiumVersion >= 135 && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (epoch !== this.epoch || !isCurrent()) {
          stream.getTracks().forEach((track) => track.stop());
          close(false);
          return;
        }
        audioStream = stream;
      }
      if (epoch === this.epoch && isCurrent()) rec.start(audioStream?.getAudioTracks()[0]);
      else close(false);
    }
    catch (error) {
      close(false);
      const name = error instanceof Error ? error.name : '';
      this.lastError = new BrowserSpeechError(name === 'NotAllowedError' ? 'not-allowed' : 'failed');
      throw this.lastError;
    }
  }

  async stop(): Promise<void> {
    ++this.epoch;
    await this.session?.stop();
  }

  async cancel(): Promise<void> {
    ++this.epoch;
    this.session?.close(false);
  }
}

export class BrowserSpeechError extends Error {
  readonly code: string;
  constructor(code: string) {
    const known = ['unsupported', 'not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'no-speech', 'language-not-supported', 'aborted', 'timeout', 'failed'];
    const safe = known.includes(code) ? code : 'failed';
    super(`Browser speech recognition: ${safe}`);
    this.name = 'BrowserSpeechError';
    this.code = safe;
  }
}
