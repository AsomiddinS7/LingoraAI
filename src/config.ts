// One config object (brief section 2). Set by environment at build time,
// overridable at runtime from the Console screen for demos (in memory only).

export type SttProviderName = 'azure-speech' | 'typed-input' | 'browser-speech';
export type TtsProviderName = 'azure-speech' | 'browser-synthesis';
export type LlmProviderName = 'azure-openai' | 'mock';
/** v1 spec section 8: sequence (ML team's model via manifest), static (v0 held shapes), mock. */
export type RecognizerName = 'sequence' | 'static' | 'mock';
export type DataCollectionPolicy = 'consenting-teammates' | 'tutor-confirmed';

export interface AppConfig {
  sttProvider: SttProviderName;
  ttsProvider: TtsProviderName;
  faceHints: boolean;
  llmProvider: LlmProviderName;
  mockAzure: boolean;
  recognizer: RecognizerName;
  /** Sign window timings (v1 spec section 8). Starting values; the ML team tunes them. */
  signWindow: SignWindowConfig;
  dataCollection: DataCollectionPolicy;
  confidenceThreshold: number;
  apiBase: string;
}

export interface SignWindowConfig {
  countdownMs: number;
  /** Recording ends when the hands rest this long... */
  restMs: number;
  /** ...but not before this... */
  minRecordingMs: number;
  /** ...and at the latest after this. */
  maxRecordingMs: number;
  /** Give up waiting for a result after this (shows an error, never hangs). */
  processingTimeoutMs: number;
  /** Confidence at or above this reads "Sure"; between threshold and this reads "Maybe". */
  sureAt: number;
}

export const DEFAULT_SIGN_WINDOW: SignWindowConfig = {
  countdownMs: 1000,
  restMs: 500,
  minRecordingMs: 400,
  maxRecordingMs: 3500,
  processingTimeoutMs: 2500,
  sureAt: 0.9,
};

type Env = Record<string, string | undefined>;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readEnv(): Env {
  try {
    return (import.meta as unknown as { env?: Env }).env ?? {};
  } catch {
    return {};
  }
}

/** Plan B values are the defaults whenever a switch is missing (brief: silence counts as no). */
export function configFromEnv(env: Env = readEnv()): AppConfig {
  const threshold = Number(env.VITE_CONFIDENCE_THRESHOLD);
  return {
    sttProvider: pick(env.VITE_STT_PROVIDER, ['azure-speech', 'typed-input', 'browser-speech'] as const, 'typed-input'),
    ttsProvider: pick(env.VITE_TTS_PROVIDER, ['azure-speech', 'browser-synthesis'] as const, 'browser-synthesis'),
    faceHints: env.VITE_FACE_HINTS === 'on',
    llmProvider: pick(env.VITE_LLM_PROVIDER, ['azure-openai', 'mock'] as const, 'azure-openai'),
    // Mock stays on unless explicitly turned off, so a fresh checkout runs with no keys.
    mockAzure: env.VITE_MOCK_AZURE !== 'false',
    recognizer: pick(
      env.VITE_RECOGNIZER ?? ({ mediapipe: 'static', model: 'sequence', mock: 'mock' } as Record<string, string>)[env.VITE_SIGN_CLASSIFIER ?? ''],
      ['sequence', 'static', 'mock'] as const,
      'mock',
    ),
    signWindow: { ...DEFAULT_SIGN_WINDOW },
    dataCollection: pick(
      env.VITE_DATA_COLLECTION,
      ['consenting-teammates', 'tutor-confirmed'] as const,
      'consenting-teammates',
    ),
    confidenceThreshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : 0.8,
    apiBase: (env.VITE_API_BASE ?? '').replace(/\/$/, ''),
  };
}

export const PLAN_A: Partial<AppConfig> = {
  sttProvider: 'azure-speech',
  ttsProvider: 'azure-speech',
  faceHints: true,
  llmProvider: 'azure-openai',
};

export const PLAN_B: Partial<AppConfig> = {
  sttProvider: 'typed-input',
  ttsProvider: 'browser-synthesis',
  faceHints: false,
  llmProvider: 'azure-openai',
};

export function whichPlan(c: AppConfig): 'A' | 'B' | 'custom' {
  const matches = (p: Partial<AppConfig>) =>
    (Object.keys(p) as (keyof AppConfig)[]).every((k) => c[k] === p[k]);
  if (matches(PLAN_A)) return 'A';
  if (matches(PLAN_B)) return 'B';
  return 'custom';
}
