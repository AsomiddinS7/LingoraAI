// Provider registry: picks Mock or Real implementations from the config (brief sections 2 and 6).
// The UI only sees the interfaces in ../types.
import { createApiClient } from '../api/client';
import { createMockServer } from '../api/mockServer';
import { isHealth, isSentenceResponse, isSimplifyResponse, isSpeechToken, isUsage } from '../api/validate';
import type { AppConfig } from '../config';
import type { MessageKey } from '../i18n';
import { runtime } from '../runtime';
import type { FaceHintProvider, SentenceService, SignClassifier, SttProvider, TtsProvider } from '../types';
import { MediaPipeSignClassifier, MockSignClassifier, ModelSignClassifier } from './classifier';
import { BrowserSpeechStt, MockStt } from './stt';
import { BrowserSynthesisTts } from './tts';

// ---------- Team plug-in points ----------
// The team registers real providers at startup (e.g. in src/team/index.ts) without touching the UI:
//   registerProvider('tts', () => new AzureSpeechTts(...))
//   registerProvider('stt', () => new AzureSpeechStt(...))
type Factories = { stt?: () => SttProvider; tts?: () => TtsProvider };
const registered: Factories = {};
export function registerProvider<K extends keyof Factories>(kind: K, factory: NonNullable<Factories[K]>): void {
  registered[kind] = factory;
}

// ---------- API (mock server or team backend) ----------
export const mockServer = createMockServer({
  getSettings: () => {
    const { config, demo } = runtime.get();
    return {
      fixture: demo.fixture,
      speechTokenEnabled: config.sttProvider === 'azure-speech' || config.ttsProvider === 'azure-speech',
    };
  },
});

export function usesMockApi(c: AppConfig): boolean {
  return c.mockAzure || c.llmProvider === 'mock';
}

export const api = createApiClient({
  transport: () => (usesMockApi(runtime.get().config) ? mockServer.fetch : (url, init) => fetch(url, init)),
  baseUrl: () => (usesMockApi(runtime.get().config) ? '' : runtime.get().config.apiBase),
  isOffline: runtime.isOffline,
});

export const sentenceService: SentenceService = {
  compose: (req) => api.post('/api/sentence', req, isSentenceResponse),
  simplify: (req) => api.post('/api/simplify', req, isSimplifyResponse),
};

export const backend = {
  usage: () => api.get('/api/usage', isUsage),
  health: () => api.get('/api/health', isHealth),
  // Plan A only. The team's Azure provider should call this and cache below expires_in_s.
  speechToken: () => api.get('/api/speech-token', isSpeechToken),
};

// ---------- Sign classifier ----------
let classifierCache: { key: string; instance: SignClassifier } | null = null;
export function getClassifier(c: AppConfig): SignClassifier {
  const key = c.signClassifier;
  if (classifierCache?.key !== key) {
    classifierCache?.instance.detach();
    classifierCache = {
      key,
      instance:
        key === 'model'
          ? new ModelSignClassifier()
          : key === 'mediapipe'
            ? new MediaPipeSignClassifier()
            : new MockSignClassifier({
              shouldFail: () => runtime.get().demo.simClassifierFail,
              intervalMs: () => runtime.get().demo.mockCadenceMs,
            }),
    };
  }
  return classifierCache.instance;
}

// ---------- Text to speech ----------
const browserTts = new BrowserSynthesisTts();
export function getTts(c: AppConfig): { provider: TtsProvider; notice: MessageKey | null } {
  if (c.ttsProvider === 'azure-speech') {
    if (registered.tts) return { provider: registered.tts(), notice: null };
    return { provider: browserTts, notice: c.mockAzure ? null : 'tts.azureMissing' };
  }
  return { provider: browserTts, notice: null };
}

// ---------- Speech to text ----------
export type SttChoice =
  | { kind: 'typed'; notice: MessageKey }
  | { kind: 'ptt'; provider: SttProvider; notice: MessageKey | null };

const mockStt = new MockStt();
let browserStt: BrowserSpeechStt | null = null;

export function getStt(c: AppConfig): SttChoice {
  if (c.sttProvider === 'azure-speech') {
    if (registered.stt) return { kind: 'ptt', provider: registered.stt(), notice: null };
    if (c.mockAzure) return { kind: 'ptt', provider: mockStt, notice: null };
    return { kind: 'typed', notice: 'listener.sttMissing' };
  }
  if (c.sttProvider === 'browser-speech') {
    if (!BrowserSpeechStt.isSupported()) return { kind: 'typed', notice: 'listener.sttFailed' };
    browserStt ??= new BrowserSpeechStt();
    return { kind: 'ptt', provider: browserStt, notice: 'listener.sttExperimental' };
  }
  return { kind: 'typed', notice: 'listener.typedOnly' };
}

// ---------- Face hints (F11, Plan A, display only) ----------
export const mockFaceHints: FaceHintProvider = {
  subscribe(onHint) {
    let last = runtime.get().demo.faceHint;
    onHint(last);
    return runtime.subscribe(() => {
      const h = runtime.get().demo.faceHint;
      if (h !== last) {
        last = h;
        onHint(h);
      }
    });
  },
};
