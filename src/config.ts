// One config object (brief section 2). Set by environment at build time,
// overridable at runtime from the Console screen for demos (in memory only).

export type SttProviderName = 'azure-speech' | 'typed-input' | 'browser-speech';
export type TtsProviderName = 'azure-speech' | 'browser-synthesis';
export type LlmProviderName = 'azure-openai' | 'mock';
export type ClassifierName = 'mock' | 'model';
export type DataCollectionPolicy = 'consenting-teammates' | 'tutor-confirmed';

export interface AppConfig {
  sttProvider: SttProviderName;
  ttsProvider: TtsProviderName;
  faceHints: boolean;
  llmProvider: LlmProviderName;
  mockAzure: boolean;
  /** Not in the brief's switch table; needed so the app runs without the team's model (F12). */
  signClassifier: ClassifierName;
  dataCollection: DataCollectionPolicy;
  confidenceThreshold: number;
  apiBase: string;
}

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
    signClassifier: pick(env.VITE_SIGN_CLASSIFIER, ['mock', 'model'] as const, 'mock'),
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
