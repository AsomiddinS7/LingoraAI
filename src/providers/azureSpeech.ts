// Azure Speech uses short-lived authorization tokens. Subscription keys stay on the server.
import type { Lang, SpeechTokenResponse, SttProvider, TtsProvider } from '../types';
import { TtsError } from './tts';

type SpeechSdk = typeof import('microsoft-cognitiveservices-speech-sdk');
type Recognizer = import('microsoft-cognitiveservices-speech-sdk').SpeechRecognizer;
type Synthesizer = import('microsoft-cognitiveservices-speech-sdk').SpeechSynthesizer;
type Speaker = import('microsoft-cognitiveservices-speech-sdk').SpeakerAudioDestination;

export interface SpeechTokenOptions {
  tokenUrl?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

export class AzureSpeechError extends Error {
  constructor(public code: 'unavailable' | 'token' | 'microphone' | 'recognition') {
    super(`Speech service: ${code}`);
    this.name = 'AzureSpeechError';
  }
}

/** Independent of the app's mock API; concurrent STT/TTS requests share one token refresh. */
export function createSpeechTokenSource(options: SpeechTokenOptions = {}): () => Promise<SpeechTokenResponse> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { value: SpeechTokenResponse; expiresAt: number } | null = null;
  let pending: Promise<SpeechTokenResponse> | null = null;
  return async () => {
    if (cached && now() < cached.expiresAt) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetcher(options.tokenUrl ?? '/api/speech-token', {
          signal: controller.signal, cache: 'no-store', credentials: 'omit',
        });
        if (!response.ok) throw new AzureSpeechError(response.status === 503 || response.status === 404 ? 'unavailable' : 'token');
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object') throw new AzureSpeechError('token');
        const t = value as SpeechTokenResponse;
        if (typeof t.token !== 'string' || t.token.length < 16 || t.token.startsWith('mock') ||
          typeof t.region !== 'string' || !/^[a-z0-9-]{2,50}$/.test(t.region) ||
          !Number.isFinite(t.expires_in_s) || t.expires_in_s < 60 || t.expires_in_s > 600) {
          throw new AzureSpeechError('token');
        }
        cached = { value: t, expiresAt: now() + Math.max(0, t.expires_in_s - 30) * 1000 };
        return t;
      } catch (error) {
        throw error instanceof AzureSpeechError ? error : new AzureSpeechError('token');
      } finally {
        clearTimeout(timer);
      }
    })();
    try { return await pending; } finally { pending = null; }
  };
}

export interface AzureSpeechOptions extends SpeechTokenOptions {
  getToken?: () => Promise<SpeechTokenResponse>;
  /** Asynchronous recognition errors happen after start() has resolved. */
  onError?: (error: AzureSpeechError) => void;
  loadSdk?: () => Promise<SpeechSdk>;
}

export const SPEECH_LOCALES: Record<Lang, string> = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };
export const SPEECH_VOICES: Record<Lang, string> = {
  uz: 'uz-UZ-MadinaNeural', ru: 'ru-RU-SvetlanaNeural', en: 'en-US-JennyNeural',
};

const loadSdk = () => import('microsoft-cognitiveservices-speech-sdk');

export class AzureSpeechStt implements SttProvider {
  private epoch = 0;
  private session: { recognizer: Recognizer; finalize: () => void; close: () => void } | null = null;
  private fault: AzureSpeechError | null = null;
  private getToken: () => Promise<SpeechTokenResponse>;
  constructor(private options: AzureSpeechOptions = {}) {
    this.getToken = options.getToken ?? createSpeechTokenSource(options);
  }

  async start(lang: Lang, onText: (text: string, final: boolean) => void): Promise<void> {
    const epoch = ++this.epoch;
    // Stop an earlier turn before opening the microphone for the next one.
    await this.stopSession().catch(() => {});
    if (epoch !== this.epoch) return;
    this.fault = null;
    const [sdk, token] = await Promise.all([(this.options.loadSdk ?? loadSdk)(), this.getToken()]);
    if (epoch !== this.epoch) return;
    sdk.SpeechRecognizer.enableTelemetry(false);
    const config = sdk.SpeechConfig.fromAuthorizationToken(token.token, token.region);
    config.speechRecognitionLanguage = SPEECH_LOCALES[lang];
    const audio = sdk.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new sdk.SpeechRecognizer(config, audio);
    let finalText = '';
    let interim = '';
    let finished = false;
    let closed = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      // Keep the last partial transcript when the service stops without a final segment.
      onText([finalText, interim].filter(Boolean).join(' ').trim(), true);
    };
    const close = () => {
      if (closed) return;
      closed = true;
      recognizer.close();
      audio.close();
      if (this.session?.recognizer === recognizer) this.session = null;
    };
    // Drain final recognition results during stop(), before closing this microphone.
    const current = () => !closed;
    recognizer.recognizing = (_, event) => {
      if (!current()) return;
      interim = event.result.text.trim();
      onText([finalText, interim].filter(Boolean).join(' '), false);
    };
    recognizer.recognized = (_, event) => {
      if (!current() || event.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
      finalText = [finalText, event.result.text.trim()].filter(Boolean).join(' ');
      interim = '';
      onText(finalText, false);
    };
    recognizer.canceled = (_, event) => {
      if (!current()) return;
      if (event.reason === sdk.CancellationReason.Error) {
        this.fault = new AzureSpeechError('recognition');
        this.options.onError?.(this.fault);
      }
      finalize();
      close();
    };
    recognizer.sessionStopped = () => {
      if (!current()) return;
      finalize();
      close();
    };
    this.session = { recognizer, finalize, close };
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new AzureSpeechError('microphone')), 12000);
        recognizer.startContinuousRecognitionAsync(
          () => { clearTimeout(timeout); resolve(); },
          () => { clearTimeout(timeout); reject(new AzureSpeechError('microphone')); },
        );
      });
      if (epoch !== this.epoch) close();
      if (this.fault) throw this.fault;
    } catch (error) {
      close();
      throw error instanceof AzureSpeechError ? error : new AzureSpeechError('microphone');
    }
  }

  async stop(): Promise<void> {
    // Invalidates token/SDK loading as well as a running microphone session.
    ++this.epoch;
    await this.stopSession();
  }

  private async stopSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) {
      try {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          const done = () => { clearTimeout(timer); resolve(); };
          session.recognizer.stopContinuousRecognitionAsync(done, done);
        });
      } finally {
        session.finalize();
        session.close();
      }
    }
    const fault = this.fault;
    this.fault = null;
    if (fault) throw fault;
  }
}

export class AzureSpeechTts implements TtsProvider {
  private epoch = 0;
  private active: { synthesizer: Synthesizer; speaker: Speaker; finish: (error?: Error) => void } | null = null;
  private getToken: () => Promise<SpeechTokenResponse>;
  constructor(private options: AzureSpeechOptions = {}) {
    this.getToken = options.getToken ?? createSpeechTokenSource(options);
  }

  async speak(text: string, lang: Lang): Promise<void> {
    this.cancel();
    const epoch = this.epoch;
    if (!text.trim()) return;
    try {
      const [sdk, token] = await Promise.all([(this.options.loadSdk ?? loadSdk)(), this.getToken()]);
      if (epoch !== this.epoch) return;
      const config = sdk.SpeechConfig.fromAuthorizationToken(token.token, token.region);
      config.speechSynthesisLanguage = SPEECH_LOCALES[lang];
      config.speechSynthesisVoiceName = SPEECH_VOICES[lang];
      const speaker = new sdk.SpeakerAudioDestination();
      const audio = sdk.AudioConfig.fromSpeakerOutput(speaker);
      const synthesizer = new sdk.SpeechSynthesizer(config, audio);
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const timer = setTimeout(() => finish(new TtsError('failed')), Math.min(120000, 15000 + text.length * 180));
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (this.active?.synthesizer === synthesizer) this.active = null;
          speaker.pause();
          speaker.close();
          synthesizer.close();
          audio.close();
          if (error) reject(error); else resolve();
        };
        this.active = { synthesizer, speaker, finish };
        // Completion means playback ended, not merely that Azure finished generating audio.
        speaker.onAudioEnd = () => finish();
        synthesizer.speakTextAsync(text, (result) => {
          if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) finish(new TtsError('failed'));
        }, () => finish(new TtsError('failed')));
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      throw error instanceof TtsError ? error : new TtsError('failed');
    }
  }

  cancel(): void {
    ++this.epoch;
    this.active?.finish();
    this.active = null;
  }
}
