// Provider registry: picks Mock or Real implementations from the config (brief sections 2 and 6).
// The UI only sees the interfaces in ../types.
import { createApiClient } from '../api/client';
import { createMockServer } from '../api/mockServer';
import { isActiveModel, isAnyObject, isProviders, isConsentsPage, isFeedbackAck, isOk, isHealth, isMe, isPhrasesPage, isSentenceResponse, isSignsPage, isSimplifyResponse, isSpeechToken, isUsage } from '../api/validate';
import { catalog } from '../data';
import { loadSequenceRecognizer, MockRecognizer, StaticRecognizer } from '../recognition/recognizers';
import type { ModelManifest, SequenceRecognizer } from '../recognition/types';
import type { AppConfig } from '../config';
import type { MessageKey } from '../i18n';
import { runtime } from '../runtime';
import type { FaceHintProvider, FeedbackRequest, SentenceService, SttProvider, TtsProvider } from '../types';
import { BrowserSpeechStt, MockStt } from './stt';
import { BrowserSynthesisTts } from './tts';
import { AzureSpeechStt, AzureSpeechTts, createSpeechTokenSource } from './azureSpeech';
import { composeLocally } from './localSentence';
import { MotionRecognizer } from '../recognition/motionRecognizer';
import { LocalWhisperStt, type LocalSttStatus } from './localStt';
import { useSyncExternalStore } from 'react';

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
  compose: (req) => runtime.get().config.llmProvider === 'local'
    ? Promise.resolve(composeLocally(req)) : api.post('/api/sentence', req, isSentenceResponse),
  simplify: (req) => runtime.get().config.llmProvider === 'local'
    ? Promise.reject(new Error('Simplification is not enabled in the local MVP'))
    : api.post('/api/simplify', req, isSimplifyResponse),
};

export const backend = {
  usage: () => api.get('/api/usage', isUsage),
  health: () => api.get('/api/health', isHealth),
  // Plan A only. The team's Azure provider should call this and cache below expires_in_s.
  speechToken: () => api.get('/api/speech-token', isSpeechToken),
  // v1 platform
  signs: (scenario = 'greeting') => api.get(`/api/signs?scenario=${encodeURIComponent(scenario)}`, isSignsPage),
  phrasebook: () => api.get('/api/phrasebook', isPhrasesPage),
  activeModel: () => api.get('/api/model/active', isActiveModel),
  feedback: (req: FeedbackRequest) => api.post('/api/feedback', req, isFeedbackAck),
  me: () => api.get('/api/auth/me', isMe),
  login: (email: string, password: string) => api.post('/api/auth/login', { email, password }, isMe),
  register: (body: { email: string; password: string; display_name: string; language: string; consent_ids: string[] }) =>
    api.post('/api/auth/register', body, isMe),
  logout: () => api.post('/api/auth/logout', {}, isOk),
  providers: () => api.get('/api/auth/providers', isProviders),
  telegram: (body: Record<string, unknown>) => api.post('/api/auth/telegram', body, isMe),
  consents: (language: string) => api.get(`/api/consents/current?language=${language}`, isConsentsPage),
  exportMe: () => api.get('/api/me/export', isAnyObject),
  deleteMe: () => api.del('/api/me', isOk),
};

/** Loads signs and phrases from the API; keeps the bundled seed if the API is unreachable. */
export async function refreshCatalog(): Promise<'api' | 'seed'> {
  const [s, p] = await Promise.allSettled([backend.signs(), backend.phrasebook()]);
  if (s.status === 'fulfilled' || p.status === 'fulfilled') {
    catalog.set({
      signs: s.status === 'fulfilled' ? (s.value.items as never) : undefined,
      phrases: p.status === 'fulfilled' ? (p.value.items as never) : undefined,
    });
    return 'api';
  }
  return 'seed';
}

// ---------- Sign recognizer (v1 spec section 8): sequence | static | mock ----------
/** Creates and loads the configured recognizer. The caller owns attach/detach. */
export async function createRecognizer(c: AppConfig): Promise<SequenceRecognizer> {
  if (c.recognizer === 'motion') {
    const r = new MotionRecognizer();
    await r.load();
    return r;
  }
  if (c.recognizer === 'sequence') {
    // The ML team's model from the registry. If none is active this throws and the UI falls back.
    return loadSequenceRecognizer(() => backend.activeModel());
  }
  const r = c.recognizer === 'static' ? new StaticRecognizer() : new MockRecognizer();
  await (r as SequenceRecognizer).load({} as ModelManifest);
  return r;
}

// ---------- Text to speech ----------
const browserTts = new BrowserSynthesisTts();
let speech: { url: string; stt: AzureSpeechStt; tts: AzureSpeechTts } | null = null;
let speechErrorHandler: ((error?: unknown) => void) | undefined;
export function setSpeechErrorHandler(handler?: (error?: unknown) => void): void { speechErrorHandler = handler; }
function azure(c: AppConfig) {
  if (!speech || speech.url !== c.speechTokenUrl) {
    speech?.tts.cancel();
    if (speech) void speech.stt.stop().catch(() => {});
    const getToken = createSpeechTokenSource({ tokenUrl: c.speechTokenUrl });
    speech = { url: c.speechTokenUrl,
      stt: new AzureSpeechStt({ getToken, onError: () => speechErrorHandler?.() }),
      tts: new AzureSpeechTts({ getToken }) };
  }
  return speech;
}
export function getTts(c: AppConfig): { provider: TtsProvider; notice: MessageKey | null } {
  if (c.ttsProvider === 'azure-speech') {
    if (registered.tts) return { provider: registered.tts(), notice: null };
    if (c.speechTokenUrl) return { provider: azure(c).tts, notice: null };
    return { provider: browserTts, notice: 'tts.azureMissing' };
  }
  return { provider: browserTts, notice: null };
}

// ---------- Speech to text ----------
export type SttChoice =
  | { kind: 'typed'; notice: MessageKey }
  | { kind: 'ptt'; provider: SttProvider; notice: MessageKey | null };

const mockStt = new MockStt();
let browserStt: BrowserSpeechStt | null = null;
let localStt: { url: string; provider: LocalWhisperStt } | null = null;
let localStatus: LocalSttStatus = 'idle';
const sttListeners = new Set<() => void>();
export function useLocalSttStatus() {
  return useSyncExternalStore((l) => { sttListeners.add(l); return () => { sttListeners.delete(l); }; }, () => localStatus, () => 'idle' as LocalSttStatus);
}

export function getStt(c: AppConfig): SttChoice {
  if (c.sttProvider === 'local-stt' || c.sttProvider === 'local-whisper') {
    if (!localStt || localStt.url !== c.localSttUrl) {
      localStt?.provider.cancel();
      localStt = { url: c.localSttUrl, provider: new LocalWhisperStt({ url: c.localSttUrl,
        onStatus: (status) => { localStatus = status; sttListeners.forEach(l => l()); },
        onError: error => speechErrorHandler?.(error),
      }) };
    }
    return { kind: 'ptt', provider: localStt.provider, notice: null };
  }
  if (c.sttProvider === 'azure-speech') {
    if (registered.stt) return { kind: 'ptt', provider: registered.stt(), notice: null };
    if (c.speechTokenUrl) return { kind: 'ptt', provider: azure(c).stt, notice: 'speech.cloud' };
    if (c.mockAzure && c.recognizer === 'mock') return { kind: 'ptt', provider: mockStt, notice: null };
    return { kind: 'typed', notice: 'listener.sttMissing' };
  }
  if (c.sttProvider === 'browser-speech') {
    if (!BrowserSpeechStt.isSupported()) return { kind: 'typed', notice: 'listener.sttFailed' };
    browserStt ??= new BrowserSpeechStt(error => speechErrorHandler?.(error));
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
